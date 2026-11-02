/**
 * Decide si una visita a /r/:id cuenta como "escaneo".
 *
 * No cuentan:
 *  - robots y vistas previas de enlaces (WhatsApp, Facebook, Slack, Google…)
 *  - precargas del navegador (prefetch / prerender)
 *  - repeticiones del mismo dispositivo (misma IP + navegador) en menos de 60 s:
 *    recargas, doble clic, etc.
 *
 * La memoria de repeticiones vive solo en el servidor y no se guarda en la base de datos.
 */

const VENTANA_MS = 60_000;
const ROBOTS = /bot\b|bot\/|crawler|spider|facebookexternalhit|facebot|WhatsApp\/|Slackbot|TelegramBot|Discordbot|LinkedInBot|Twitterbot|curl\/|wget\/|python-requests|HeadlessChrome/i;
const vistos = new Map();

setInterval(() => {
  const limite = Date.now() - VENTANA_MS;
  for (const [k, t] of vistos) if (t < limite) vistos.delete(k);
}, VENTANA_MS).unref();

export function esRobot(userAgent) {
  return ROBOTS.test(userAgent || '');
}

export function esPrecarga(headers) {
  const proposito = `${headers['sec-purpose'] || ''} ${headers['purpose'] || ''}`;
  return /prefetch|prerender/i.test(proposito) || headers['x-moz'] === 'prefetch';
}

/** true si esta visita debe sumarse al contador */
export function debeContarEscaneo(req, qrId) {
  const ua = req.headers['user-agent'] || '';
  if (esRobot(ua) || esPrecarga(req.headers)) return false;

  const clave = `${qrId}|${req.ip}|${ua}`;
  const ahora = Date.now();
  const antes = vistos.get(clave);
  vistos.set(clave, ahora);
  return !(antes && ahora - antes < VENTANA_MS);
}
