/**
 * Avisos al administrador cuando entra un pago.
 *
 *  - Email a AVISOS_EMAIL (si no existe, a ADMIN_EMAIL). Necesita las variables SMTP_* en Render.
 *    AVISOS_EMAIL es independiente del correo con el que entras como Super Admin.
 *  - WhatsApp a tu número mediante CallMeBot (servicio gratuito, de uso personal):
 *      CALLMEBOT_PHONE   tu número con prefijo, ej. +34600111222
 *      CALLMEBOT_APIKEY  la clave que te envía el bot al activarlo
 *    Si no están definidas, solo se avisa por email (y se escribe en el log).
 *
 * Un fallo al avisar NUNCA debe impedir que el pago active la cuenta.
 */

import { enviarEmailGenerico } from './email.js';

export function formatoEuros(centimos, moneda = 'eur') {
  const n = (Number(centimos) || 0) / 100;
  const simbolo = String(moneda).toLowerCase() === 'eur' ? '€' : String(moneda).toUpperCase();
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${simbolo}`;
}

async function porWhatsApp(texto) {
  const phone = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return { canal: 'whatsapp', enviado: false, motivo: 'sin configurar' };
  const base = process.env.CALLMEBOT_URL || 'https://api.callmebot.com/whatsapp.php';
  const url = `${base}?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(apikey)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { canal: 'whatsapp', enviado: true };
  } catch (e) {
    console.error('[Aviso] WhatsApp (CallMeBot) falló:', e.message);
    return { canal: 'whatsapp', enviado: false, motivo: e.message };
  }
}

async function porEmail(asunto, texto) {
  const to = process.env.AVISOS_EMAIL || process.env.ADMIN_EMAIL;
  if (!to) return { canal: 'email', enviado: false, motivo: 'sin AVISOS_EMAIL ni ADMIN_EMAIL' };
  try {
    await enviarEmailGenerico({
      to, subject: asunto, text: texto,
      html: `<pre style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">${texto.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`
    });
    return { canal: 'email', enviado: true };
  } catch (e) {
    console.error('[Aviso] Email falló:', e.message);
    return { canal: 'email', enviado: false, motivo: e.message };
  }
}

export async function notificarAdmin({ asunto, texto }) {
  const r = await Promise.all([porWhatsApp(texto), porEmail(asunto, texto)]);
  console.log('[Aviso] ' + asunto + ' → ' + r.map(x => `${x.canal}:${x.enviado ? 'ok' : 'no'}`).join(' '));
  return r;
}
