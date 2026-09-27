/**
 * Alertas de pico de escaneos – SOLO Plan Pro y Business
 * Plan Starter (0 €): desactivado a propósito (gancho comercial)
 *
 * Si en 15 min hay ≥ UMBRAL escaneos y no se alertó en la última hora
 * → email al dueño del negocio.
 */

import { Op } from 'sequelize';
import { Escaneo, Negocio } from '../models/index.js';
import { enviarEmailGenerico } from './email.js';

const UMBRAL_15_MIN = 20;
const COOLDOWN_MS = 60 * 60 * 1000;

const ultimaAlertaPorNegocio = new Map();

export async function evaluarPicoEscaneos(negocioId, planActual) {
  // Starter: sin alertas
  if (!planActual || planActual === 'Starter') return;

  const ahora = Date.now();
  const ultima = ultimaAlertaPorNegocio.get(negocioId) || 0;
  if (ahora - ultima < COOLDOWN_MS) return;

  const desde = new Date(ahora - 15 * 60 * 1000);
  const count = await Escaneo.count({
    where: {
      negocio_id: negocioId,
      scanned_at: { [Op.gte]: desde }
    }
  });

  if (count < UMBRAL_15_MIN) return;

  ultimaAlertaPorNegocio.set(negocioId, ahora);

  const negocio = await Negocio.findByPk(negocioId, {
    attributes: ['nombre_empresa', 'email', 'plan_actual']
  });
  if (!negocio) return;

  console.log(`[Alerta pico] ${negocio.nombre_empresa}: ${count} escaneos / 15 min`);

  const subject = `[QR SaaS] Pico de escaneos en ${negocio.nombre_empresa}`;
  const html = `
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1e293b;padding:24px;">
  <h2 style="color:#16a34a;">📈 Pico de actividad detectado</h2>
  <p>Hola, <strong>${negocio.nombre_empresa}</strong>.</p>
  <p>En los últimos <strong>15 minutos</strong> hemos registrado <strong>${count} escaneos</strong> de tu código QR (plan ${negocio.plan_actual}).</p>
  <p style="color:#64748b;font-size:14px;">Aviso automático de planes Pro/Business. El plan Starter no incluye estas alertas.</p>
  <p style="font-size:12px;color:#94a3b8;margin-top:24px;">QR SaaS · España</p>
</body></html>`;

  await enviarEmailGenerico({
    to: negocio.email,
    subject,
    html
  });
}
