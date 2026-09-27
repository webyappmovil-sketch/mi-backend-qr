/**
 * Webhook de Revolut Merchant API
 * POST /webhooks/revolut
 *
 * ⚠️  PLACEHOLDER – Priorizamos Stripe en esta fase.
 * Cuando quieras activar Revolut, implementa aquí la lógica
 * equivalente a stripe.js (ORDER_COMPLETED → Activo, fallos → Suspendido).
 */

import { Router } from 'express';

const router = Router();

router.post('/', async (req, res) => {
  console.log('[Revolut] Webhook recibido (placeholder – no procesado)');
  console.log('[Revolut] TODO: Implementar Revolut Merchant API');

  // Siempre respondemos 200 para no generar reintentos
  res.status(200).json({
    received: true,
    message: 'Revolut webhook placeholder – not implemented yet'
  });
});

export default router;
