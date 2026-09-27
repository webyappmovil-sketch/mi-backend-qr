/**
 * Lógica de negocio compartida para activar / suspender negocios
 * tras eventos de Stripe o Revolut.
 */

import { Negocio } from '../models/index.js';

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
