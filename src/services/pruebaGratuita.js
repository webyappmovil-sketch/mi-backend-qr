/**
 * Avisos de fin de la prueba gratuita (60 días):
 *   día 45 (quedan 15) · día 55 (quedan 5) · día 60 (termina; empieza la semana de cortesía)
 * Cada aviso se envía una sola vez (se guarda en negocios.avisos_prueba).
 * Se ejecuta al arrancar y cada 6 horas. Si Render duerme el servicio, se envía en el siguiente arranque.
 */
import { Op } from 'sequelize';
import { Negocio } from '../models/index.js';
import { estadoPrueba, DIAS_CORTESIA } from './planes.js';
import { enviarEmailGenerico } from './email.js';

const BASE = () => process.env.APP_BASE_URL || 'https://plataforma-qr-backend.onrender.com';

function plantilla(nivel, negocio, est) {
  const url = `${BASE()}/dashboard.html`;
  const fmt = d => new Date(d).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long' });
  const textos = {
    d15: {
      asunto: 'Te quedan 15 días de prueba gratuita',
      cuerpo: `Tu prueba gratuita termina el ${fmt(est.fin)}. Con el plan Pro (19,99 €/mes) tendrás hasta 5 QR, la ruleta de premios y la captación de clientes.`
    },
    d5: {
      asunto: 'Te quedan 5 días de prueba gratuita',
      cuerpo: `Tu prueba termina el ${fmt(est.fin)}. Si ya has imprimido tu QR, mejora tu plan antes de esa fecha para que siga funcionando sin interrupciones.`
    },
    d0: {
      asunto: 'Tu prueba gratuita ha terminado',
      cuerpo: `Tu prueba terminó, pero tu QR seguirá funcionando ${DIAS_CORTESIA} días más, hasta el ${fmt(est.cortesiaHasta)}. Después se pausará (no se borra nada: si mejoras tu plan, el mismo QR impreso vuelve a funcionar).`
    }
  };
  const t = textos[nivel];
  return {
    subject: `${t.asunto} · ${negocio.nombre_empresa}`,
    text: `${t.cuerpo}\n\nMejorar mi plan: ${url}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#1e293b">
      <h2 style="margin:0 0 12px">${t.asunto}</h2>
      <p style="line-height:1.6;color:#475569">${t.cuerpo}</p>
      <p style="margin:24px 0"><a href="${url}" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Mejorar mi plan</a></p>
    </div>`
  };
}

function nivelDe(est) {
  if (est.estado === 'cortesia') return 'd0';
  if (est.estado === 'activa' && est.diasRestantes <= 5) return 'd5';
  if (est.estado === 'activa' && est.diasRestantes <= 15) return 'd15';
  return null;
}

export async function enviarAvisosPrueba(ahora = new Date()) {
  const negocios = await Negocio.findAll({
    where: { plan_actual: 'Starter', estado_suscripcion: 'Activo', prueba_fin: { [Op.ne]: null } }
  });
  let enviados = 0;
  for (const n of negocios) {
    const est = estadoPrueba(n, ahora);
    const nivel = nivelDe(est);
    const previos = n.avisos_prueba || {};
    if (!nivel || previos[nivel]) continue;

    try {
      await enviarEmailGenerico({ to: n.email, ...plantilla(nivel, n, est) });
      // Al enviar un aviso se marcan también los menos urgentes: no se repetirán después
      const marcas = { ...previos, [nivel]: ahora.toISOString() };
      if (nivel === 'd0') { marcas.d5 = marcas.d5 || marcas.d0; marcas.d15 = marcas.d15 || marcas.d0; }
      if (nivel === 'd5') marcas.d15 = marcas.d15 || marcas.d5;
      await n.update({ avisos_prueba: marcas });
      enviados++;
    } catch (err) {
      console.error('[Prueba] Error enviando aviso a', n.email, err.message);
    }
  }
  return enviados;
}

export function iniciarAvisosPrueba() {
  const ciclo = () => enviarAvisosPrueba()
    .then(n => { if (n) console.log(`[Prueba] ${n} aviso(s) de fin de prueba enviados`); })
    .catch(err => console.error('[Prueba] Error en avisos:', err.message));
  setTimeout(ciclo, 60_000).unref();
  setInterval(ciclo, 6 * 60 * 60 * 1000).unref();
}
