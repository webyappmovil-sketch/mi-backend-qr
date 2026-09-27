/**
 * Webhook de Stripe – COMPLETO
 * POST /webhooks/stripe
 *
 * Suscripciones (Pro / Business):
 *   invoice.payment_succeeded     → Activo + 30 días
 *   invoice.payment_failed        → Suspendido
 *   customer.subscription.deleted → Suspendido
 *   checkout.session.completed    → si mode=subscription, activa
 *
 * Pago único impresión (Starter):
 *   checkout.session.completed (metadata.tipo=impresion)
 *     → PedidoImpresion Pendiente
 *     → Activa negocio
 *     → Email al SuperAdmin (Brevo)
 */

import { Router } from 'express';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { activarNegocio, suspenderNegocio, encontrarNegocioPorMetadata } from '../../services/pagos.js';
import { PedidoImpresion, Negocio } from '../../models/index.js';
import { enviarEmailNotificacionAdmin } from '../../services/email.js';

dotenv.config();

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  // En desarrollo sin secret real: parsear JSON y continuar (solo local)
  if (!webhookSecret || webhookSecret.includes('xxxx')) {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
      event = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(raw);
      console.log('[Stripe] Modo desarrollo – firma no validada');
    } catch {
      return res.status(400).send('Invalid payload');
    }
  } else {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[Stripe Webhook] Firma inválida:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }

  console.log(`[Stripe] Evento: ${event.type}`);

  try {
    switch (event.type) {
      // ── Suscripción pagada (mensual Pro/Business) ─────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const metadata =
          invoice.subscription_details?.metadata ||
          invoice.lines?.data?.[0]?.metadata ||
          invoice.metadata ||
          {};

        if (metadata.tipo === 'impresion') break; // no aplica

        let negocio = await encontrarNegocioPorMetadata(metadata);

        // Fallback: buscar por email del customer
        if (!negocio && invoice.customer_email) {
          negocio = await Negocio.findOne({
            where: { email: invoice.customer_email.toLowerCase() }
          });
        }

        if (negocio) {
          await activarNegocio(negocio.id, { invoiceId: invoice.id });
          if (metadata.plan && ['Pro', 'Business'].includes(metadata.plan)) {
            await negocio.update({ plan_actual: metadata.plan });
          }
          console.log(`[Stripe] Suscripción OK → ${negocio.nombre_empresa} ACTIVO`);
        } else {
          console.warn('[Stripe] invoice.payment_succeeded sin negocio asociado');
        }
        break;
      }

      // ── Fallo de cobro recurrente ──────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const metadata =
          invoice.subscription_details?.metadata ||
          invoice.metadata ||
          {};
        let negocio = await encontrarNegocioPorMetadata(metadata);
        if (!negocio && invoice.customer_email) {
          negocio = await Negocio.findOne({
            where: { email: invoice.customer_email.toLowerCase() }
          });
        }
        if (negocio) {
          await suspenderNegocio(negocio.id);
          console.log(`[Stripe] Pago fallido → ${negocio.nombre_empresa} SUSPENDIDO`);
        }
        break;
      }

      // ── Suscripción cancelada ──────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const metadata = sub.metadata || {};
        const negocio = await encontrarNegocioPorMetadata(metadata);
        if (negocio) {
          await suspenderNegocio(negocio.id);
          console.log(`[Stripe] Suscripción eliminada → ${negocio.nombre_empresa} SUSPENDIDO`);
        }
        break;
      }

      // ── Checkout completado (impresión O primera suscripción) ─────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};

        if (session.payment_status !== 'paid' && session.status !== 'complete') {
          console.log('[Stripe] Session no pagada, ignorando');
          break;
        }

        // Pago único de impresión (Starter)
        if (metadata.tipo === 'impresion') {
          await procesarPagoImpresion(session, metadata);
          break;
        }

        // Primera suscripción vía Checkout
        if (session.mode === 'subscription' || metadata.tipo === 'suscripcion') {
          let negocio = await encontrarNegocioPorMetadata(metadata);
          if (!negocio && session.customer_email) {
            negocio = await Negocio.findOne({
              where: { email: session.customer_email.toLowerCase() }
            });
          }
          if (negocio) {
            await activarNegocio(negocio.id, { sessionId: session.id });
            if (metadata.plan && ['Pro', 'Business'].includes(metadata.plan)) {
              await negocio.update({ plan_actual: metadata.plan });
            }
            console.log(`[Stripe] Checkout suscripción → ${negocio.nombre_empresa} ACTIVO`);
          }
        }
        break;
      }

      default:
        console.log(`[Stripe] Evento no manejado: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[Stripe Webhook] Error:', error);
    res.status(200).json({ received: true, error: error.message });
  }
});

/**
 * Pago único impresión física (Plan Starter)
 * 1. Crea PedidoImpresion (Pendiente)
 * 2. Activa el negocio (QR digital funciona ya)
 * 3. Envía email al SuperAdmin con datos de envío + URL del QR
 */
async function procesarPagoImpresion(session, metadata) {
  const {
    negocio_id,
    tipo_material = 'Papel',
    direccion_envio = '',
    nombre_contacto = '',
    telefono_contacto = '',
    qr_id = null
  } = metadata;

  if (!negocio_id) {
    console.warn('[Stripe] Impresión sin negocio_id en metadata');
    return;
  }

  const negocio = await Negocio.findByPk(negocio_id);
  if (!negocio) {
    console.warn(`[Stripe] Negocio ${negocio_id} no encontrado`);
    return;
  }

  // Evitar duplicados si Stripe reenvía el evento
  const existente = await PedidoImpresion.findOne({
    where: {
      negocio_id,
      estado: 'Pendiente',
      tipo_material: tipo_material === 'Vinilo' ? 'Vinilo' : 'Papel'
    },
    order: [['created_at', 'DESC']]
  });

  let pedido = existente;
  if (!pedido) {
    pedido = await PedidoImpresion.create({
      negocio_id,
      tipo_material: tipo_material === 'Vinilo' ? 'Vinilo' : 'Papel',
      direccion_envio_completa: direccion_envio || 'Sin dirección',
      estado: 'Pendiente',
      nombre_contacto: nombre_contacto || null,
      telefono_contacto: telefono_contacto || null,
      archivo_qr_url: qr_id
        ? `${process.env.APP_BASE_URL || 'http://localhost:3000'}/r/${qr_id}`
        : null
    });
    console.log(`[Stripe] PedidoImpresion creado: ${pedido.id}`);
  }

  // Activar negocio de inmediato
  await activarNegocio(negocio_id);
  console.log(`[Stripe] Negocio ${negocio.nombre_empresa} → ACTIVO (tras impresión)`);

  // Email al SuperAdmin
  try {
    await enviarEmailNotificacionAdmin({
      pedidoId: pedido.id,
      nombreEmpresa: negocio.nombre_empresa,
      emailNegocio: negocio.email,
      tipoMaterial: pedido.tipo_material,
      direccionEnvio: pedido.direccion_envio_completa,
      nombreContacto: pedido.nombre_contacto,
      telefonoContacto: pedido.telefono_contacto,
      archivoQrUrl: pedido.archivo_qr_url,
      qrId: qr_id
    });
    console.log('[Stripe] Email de notificación enviado al SuperAdmin');
  } catch (emailErr) {
    console.error('[Stripe] Error email (pedido igual creado):', emailErr.message);
  }
}

export default router;
