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
import { Negocio, ConfiguracionQR } from '../models/index.js';

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

    // Actualizamos el plan del negocio (el estado se activa vía webhook)
    await negocio.update({ plan_actual: plan });

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

export default router;
