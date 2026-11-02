/**
 * Lógica de negocio compartida para activar / suspender negocios
 * tras eventos de Stripe o Revolut.
 */

import { Negocio, Pago, Vendedor, PedidoImpresion } from '../models/index.js';
import { Op } from 'sequelize';
import { notificarAdmin, formatoEuros } from './notificaciones.js';

/**
 * Activa un negocio y registra la renovación por 30 días.
 * @param {string} negocioId - UUID del negocio
 * @param {Object} [meta] - Datos extra del pago (opcional)
 */
export async function activarNegocio(negocioId, meta = {}) {
  const negocio = await Negocio.findByPk(negocioId);
  if (!negocio) {
    console.warn(`[Pagos] Negocio no encontrado: ${negocioId}`);
    return null;
  }

  const ahora = new Date();
  const proximoPago = new Date(ahora);
  proximoPago.setDate(proximoPago.getDate() + 30);

  await negocio.update({
    estado_suscripcion: 'Activo',
    fecha_activacion: negocio.fecha_activacion || ahora,
    fecha_proximo_pago: proximoPago
  });

  console.log(`[Pagos] Negocio ${negocio.nombre_empresa} → ACTIVO (próximo pago: ${proximoPago.toISOString().slice(0, 10)})`);
  return negocio;
}

/**
 * Suspende un negocio de forma inmediata (bloquea el QR).
 * @param {string} negocioId
 */
export async function suspenderNegocio(negocioId) {
  const negocio = await Negocio.findByPk(negocioId);
  if (!negocio) {
    console.warn(`[Pagos] Negocio no encontrado: ${negocioId}`);
    return null;
  }

  await negocio.update({
    estado_suscripcion: 'Suspendido'
  });

  console.log(`[Pagos] Negocio ${negocio.nombre_empresa} → SUSPENDIDO`);
  return negocio;
}

/**
 * Busca un negocio por el customer_id de Stripe (guardado en el futuro)
 * o por email / metadata.
 * Por ahora usamos metadata.negocio_id que enviamos al crear la suscripción.
 */
export async function encontrarNegocioPorMetadata(metadata = {}) {
  if (metadata.negocio_id) {
    return Negocio.findByPk(metadata.negocio_id);
  }
  if (metadata.email) {
    return Negocio.findOne({ where: { email: metadata.email } });
  }
  return null;
}


/* ═════════ Registro de pagos y aviso al administrador ═════════ */

export const PRECIOS_CENTIMOS = { Pro: 1999, Business: 2999, Papel: 1000, Vinilo: 2000 };

const idDe = v => (v && typeof v === 'object' ? v.id : v) || null;

/** Guarda el pago una sola vez. `nuevo` es false si ya estaba registrado. */
export async function registrarPago(datos) {
  const [pago, nuevo] = await Pago.findOrCreate({ where: { referencia: datos.referencia }, defaults: datos });
  return { pago, nuevo };
}

/** Avisa al admin (WhatsApp + email) con los datos del pago */
export async function avisarPago({ negocio, pago }) {
  let vendedor = 'Directo (sin vendedor)';
  if (negocio.vendedor_id) {
    const v = await Vendedor.findByPk(negocio.vendedor_id);
    if (v) vendedor = `${v.nombre} (${v.codigo})`;
  }
  const concepto = pago.tipo === 'Impresion'
    ? `Impresión ${pago.material || ''}`.trim()
    : `${pago.tipo === 'Renovacion' ? 'Renovación' : 'Suscripción'} plan ${pago.plan || ''}`.trim();
  const fecha = new Date(pago.created_at || Date.now()).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });

  const lineas = [
    '💰 PAGO RECIBIDO',
    `Negocio: ${negocio.nombre_empresa}`,
    `Concepto: ${concepto}`,
    `Importe: ${formatoEuros(pago.importe_centimos, pago.moneda)}`,
    `Email: ${pago.pagador_email || negocio.email}`,
    `WhatsApp del negocio: ${negocio.telefono_whatsapp}`
  ];
  if (pago.pagador_nombre) lineas.push(`Contacto: ${pago.pagador_nombre}`);
  if (pago.pagador_telefono) lineas.push(`Teléfono contacto: ${pago.pagador_telefono}`);
  lineas.push(`Vendedor: ${vendedor}`, `Fecha: ${fecha}`);

  return notificarAdmin({ asunto: `Pago recibido: ${negocio.nombre_empresa} · ${formatoEuros(pago.importe_centimos, pago.moneda)}`, texto: lineas.join('\n') });
}

/**
 * Suscripción Pro/Business pagada (sesión de Stripe Checkout).
 * Idempotente: se puede llamar desde el webhook Y desde la página de éxito sin duplicar nada.
 */
export async function procesarSesionSuscripcion(session) {
  const metadata = session.metadata || {};
  if (session.payment_status !== 'paid') return { ok: false, motivo: 'no_pagado' };

  let negocio = await encontrarNegocioPorMetadata(metadata);
  if (!negocio && session.customer_email) {
    negocio = await Negocio.findOne({ where: { email: session.customer_email.toLowerCase() } });
  }
  if (!negocio) return { ok: false, motivo: 'sin_negocio' };

  const plan = ['Pro', 'Business'].includes(metadata.plan) ? metadata.plan : null;
  await activarNegocio(negocio.id, { sessionId: session.id });
  if (plan) await negocio.update({ plan_actual: plan, prueba_fin: null });

  const { pago, nuevo } = await registrarPago({
    negocio_id: negocio.id,
    tipo: 'Suscripcion',
    plan: plan || negocio.plan_actual,
    importe_centimos: Number.isInteger(session.amount_total) ? session.amount_total : (PRECIOS_CENTIMOS[plan] || 0),
    moneda: session.currency || 'eur',
    referencia: idDe(session.invoice) || session.id,
    pagador_nombre: session.customer_details?.name || null,
    pagador_email: session.customer_details?.email || session.customer_email || null,
    pagador_telefono: session.customer_details?.phone || null
  });
  if (nuevo) await avisarPago({ negocio, pago }).catch(e => console.error('[Aviso] Error:', e.message));
  return { ok: true, negocio, plan: plan || negocio.plan_actual, nuevo };
}

/** Pago de impresión (Papel/Vinilo): registra y avisa una sola vez por sesión */
export async function registrarPagoImpresion({ session, negocio, material, metadata }) {
  const { pago, nuevo } = await registrarPago({
    negocio_id: negocio.id,
    tipo: 'Impresion',
    material,
    importe_centimos: Number.isInteger(session.amount_total) ? session.amount_total : PRECIOS_CENTIMOS[material],
    moneda: session.currency || 'eur',
    referencia: session.id,
    pagador_nombre: metadata.nombre_contacto || session.customer_details?.name || null,
    pagador_email: session.customer_details?.email || session.customer_email || null,
    pagador_telefono: metadata.telefono_contacto || session.customer_details?.phone || null
  });
  if (nuevo) await avisarPago({ negocio, pago }).catch(e => console.error('[Aviso] Error:', e.message));
  return { pago, nuevo };
}

/** Factura de suscripción cobrada (primer pago o renovación mensual) */
export async function registrarPagoFactura({ invoice, negocio, plan }) {
  const { pago, nuevo } = await registrarPago({
    negocio_id: negocio.id,
    tipo: invoice.billing_reason === 'subscription_cycle' ? 'Renovacion' : 'Suscripcion',
    plan: plan || negocio.plan_actual,
    importe_centimos: Number.isInteger(invoice.amount_paid) ? invoice.amount_paid : (PRECIOS_CENTIMOS[plan] || 0),
    moneda: invoice.currency || 'eur',
    referencia: invoice.id,
    pagador_nombre: invoice.customer_name || null,
    pagador_email: invoice.customer_email || null,
    pagador_telefono: invoice.customer_phone || null
  });
  if (nuevo) await avisarPago({ negocio, pago }).catch(e => console.error('[Aviso] Error:', e.message));
  return { pago, nuevo };
}


/**
 * Importa a la tabla de pagos los pedidos de impresión cobrados ANTES de existir el registro de pagos
 * (los pedidos no guardaban el importe: se toma el precio del material). Es idempotente y no avisa a nadie.
 * Un pedido se salta si ya hay un pago de impresión de ese negocio cerca de su fecha (los nuevos pagos
 * crean el pedido y el pago a la vez).
 */
export async function importarPagosAntiguos() {
  const pedidos = await PedidoImpresion.findAll({ order: [['created_at', 'ASC']] });
  let importados = 0;
  for (const ped of pedidos) {
    const fecha = new Date(ped.created_at);
    const cerca = await Pago.findOne({
      where: {
        negocio_id: ped.negocio_id, tipo: 'Impresion',
        created_at: { [Op.between]: [new Date(fecha.getTime() - 36 * 3600 * 1000), new Date(fecha.getTime() + 36 * 3600 * 1000)] }
      }
    });
    if (cerca) continue;
    const material = ped.tipo_material === 'Vinilo' ? 'Vinilo' : 'Papel';
    const { nuevo } = await registrarPago({
      negocio_id: ped.negocio_id, tipo: 'Impresion', material,
      importe_centimos: PRECIOS_CENTIMOS[material], moneda: 'eur',
      referencia: `pedido-${ped.id}`,
      pagador_nombre: ped.nombre_contacto || null, pagador_telefono: ped.telefono_contacto || null,
      created_at: fecha
    });
    if (nuevo) importados++;
  }
  return importados;
}
