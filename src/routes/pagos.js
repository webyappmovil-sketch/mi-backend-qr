/**
 * Endpoints de creación de sesiones de pago (Stripe Checkout)
 * - Suscripciones mensuales (Pro / Business)
 * - Pago único de impresión física (Starter)
 *
 * POST /pagos/crear-sesion-suscripcion
 * POST /pagos/crear-sesion-impresion
 */

import { Router } from 'express';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { Negocio, ConfiguracionQR, PedidoImpresion } from '../models/index.js';
import { activarNegocio } from '../services/pagos.js';
import { enviarEmailNotificacionAdmin } from '../services/email.js';

dotenv.config();

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// Precios en céntimos (modo Test)
const PRECIOS = {
  Pro: {
    amount: 1999,          // 19,99 €
    interval: 'month',
    name: 'Plan Pro – QR SaaS'
  },
  Business: {
    amount: 2999,          // 29,99 €
    interval: 'month',
    name: 'Plan Business – QR SaaS'
  },
  Vinilo: {
    amount: 2000,          // 20,00 €
    name: 'Impresión QR en Vinilo'
  },
  Papel: {
    amount: 1000,          // 10,00 €
    name: 'Impresión QR en Papel'
  }
};

/**
 * POST /pagos/crear-sesion-suscripcion
 * Body: { negocio_id, plan: 'Pro' | 'Business', success_url?, cancel_url? }
 */
router.post('/crear-sesion-suscripcion', async (req, res) => {
  try {
    const { negocio_id, plan, success_url, cancel_url } = req.body;

    if (!negocio_id || !['Pro', 'Business'].includes(plan)) {
      return res.status(400).json({
        error: 'Se requieren negocio_id y plan (Pro o Business)'
      });
    }

    const negocio = await Negocio.findByPk(negocio_id);
    if (!negocio) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const precio = PRECIOS[plan];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: negocio.email,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: precio.name,
              description: `Suscripción mensual – ${plan}`
            },
            unit_amount: precio.amount,
            recurring: { interval: precio.interval }
          },
          quantity: 1
        }
      ],
      metadata: {
        negocio_id: negocio.id,
        plan,
        tipo: 'suscripcion'
      },
      subscription_data: {
        metadata: {
          negocio_id: negocio.id,
          plan,
          tipo: 'suscripcion'
        }
      },
      success_url: success_url || `${process.env.APP_BASE_URL}/pago-exito.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${process.env.APP_BASE_URL}/pago-cancelado.html`
    });

    // El plan NO se cambia aquí: se actualiza en el webhook de Stripe cuando el pago
    // se completa de verdad. Si se cambiara antes, alguien con cuenta gratuita activa
    // podría quedarse con Pro sin pagar simplemente cerrando la ventana de Stripe.

    res.json({
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('[Pagos] Error creando sesión de suscripción:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /pagos/crear-sesion-impresion
 * Body: {
 *   negocio_id,
 *   tipo_material: 'Vinilo' | 'Papel',
 *   direccion_envio,
 *   nombre_contacto?,
 *   telefono_contacto?,
 *   qr_id?,
 *   success_url?,
 *   cancel_url?
 * }
 */
router.post('/crear-sesion-impresion', async (req, res) => {
  try {
    const {
      negocio_id,
      tipo_material,
      direccion_envio,
      nombre_contacto = '',
      telefono_contacto = '',
      qr_id = null,
      success_url,
      cancel_url
    } = req.body;

    if (!negocio_id || !['Vinilo', 'Papel'].includes(tipo_material)) {
      return res.status(400).json({
        error: 'Se requieren negocio_id y tipo_material (Vinilo o Papel)'
      });
    }

    if (!direccion_envio || direccion_envio.trim().length < 10) {
      return res.status(400).json({
        error: 'Se requiere una dirección de envío completa'
      });
    }

    const negocio = await Negocio.findByPk(negocio_id);
    if (!negocio) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Solo Plan Starter puede pedir impresión por este flujo
    if (negocio.plan_actual !== 'Starter') {
      return res.status(400).json({
        error: 'Solo los negocios del Plan Starter usan el pago de impresión'
      });
    }

    const precio = PRECIOS[tipo_material];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment', // pago único
      payment_method_types: ['card'],
      customer_email: negocio.email,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: precio.name,
              description: `Impresión física del QR – ${tipo_material}`
            },
            unit_amount: precio.amount
          },
          quantity: 1
        }
      ],
      metadata: {
        negocio_id: negocio.id,
        tipo: 'impresion',
        tipo_material,
        direccion_envio,
        nombre_contacto,
        telefono_contacto,
        qr_id: qr_id || ''
      },
      success_url: success_url || `${process.env.APP_BASE_URL}/pago-exito.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${process.env.APP_BASE_URL}/pago-cancelado.html`
    });

    res.json({
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('[Pagos] Error creando sesión de impresión:', error);
    res.status(500).json({ error: error.message });
  }
});
router.post('/confirmar-sesion', async (req, res) => {
  try {
    const sessionId = req.body?.session_id;
    if (!sessionId || !String(sessionId).startsWith('cs_')) {
      return res.status(400).json({ error: 'Sesión de pago no válida' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return res.status(400).json({ error: 'El pago aún no está confirmado' });
    }

    const metadata = session.metadata || {};
    if (metadata.tipo !== 'impresion' || !metadata.negocio_id) {
      return res.status(400).json({ error: 'Este pago no es de impresión' });
    }

    const negocio = await Negocio.findByPk(metadata.negocio_id);
    if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

    const tipo = metadata.tipo_material === 'Vinilo' ? 'Vinilo' : 'Papel';
    let pedido = await PedidoImpresion.findOne({
      where: { negocio_id: negocio.id, tipo_material: tipo },
      order: [['created_at', 'DESC']]
    });
    const yaProcesado = negocio.estado_suscripcion === 'Activo' && pedido;

    if (!pedido) {
      pedido = await PedidoImpresion.create({
        negocio_id: negocio.id,
        tipo_material: tipo,
        direccion_envio_completa: metadata.direccion_envio || 'Sin dirección',
        estado: 'Pendiente',
        nombre_contacto: metadata.nombre_contacto || null,
        telefono_contacto: metadata.telefono_contacto || null,
        archivo_qr_url: metadata.qr_id
          ? `${process.env.APP_BASE_URL || ''}/r/${metadata.qr_id}`
          : null
      });
    }

    await activarNegocio(negocio.id, { sessionId: session.id });

    if (!yaProcesado) {
      await enviarEmailNotificacionAdmin({
        pedidoId: pedido.id,
        nombreEmpresa: negocio.nombre_empresa,
        emailNegocio: negocio.email,
        tipoMaterial: tipo,
        direccionEnvio: metadata.direccion_envio || '',
        nombreContacto: metadata.nombre_contacto || '',
        telefonoContacto: metadata.telefono_contacto || '',
        archivoQrUrl: pedido.archivo_qr_url,
        qrId: metadata.qr_id || null
      });
    }

    res.json({
      ok: true,
      estado: 'Activo',
      tipo_material: tipo,
      pagado_eur: tipo === 'Vinilo' ? 20 : 10
    });
  } catch (error) {
    console.error('[Pagos] confirmar-sesion:', error);
    res.status(500).json({ error: error.message });
  }
});
export default router;
