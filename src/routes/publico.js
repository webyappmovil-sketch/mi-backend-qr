/**
 * API pública (sin login) para las páginas que se abren al escanear un QR.
 *   GET  /api/publico/qr/:id          datos de la página (ruleta, enlaces o texto)
 *   POST /api/publico/qr/:id/jugar    gira la ruleta (el servidor decide el premio)
 *   POST /api/publico/qr/:id/avisame  "avísame de la próxima promoción"
 */
import { Router } from 'express';
import { cargarQR, MENSAJES_BLOQUEO } from '../services/qrAcceso.js';
import { vistaPublicaRuleta, jugar, registrarAviso, textoConsentimiento, ErrorJuego } from '../services/ruleta.js';

const router = Router();

// Límite sencillo por IP (en memoria): frena el envío automático de formularios
function limitar(max, ventanaMs) {
  const hits = new Map();
  setInterval(() => {
    const ahora = Date.now();
    for (const [k, v] of hits) if (ahora - v.t > ventanaMs) hits.delete(k);
  }, ventanaMs).unref();
  return (req, res, next) => {
    const k = req.ip;
    const ahora = Date.now();
    const h = hits.get(k);
    if (!h || ahora - h.t > ventanaMs) { hits.set(k, { t: ahora, n: 1 }); return next(); }
    h.n++;
    if (h.n > max) return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto.' });
    next();
  };
}
const limitarEscritura = limitar(Number(process.env.PUBLICO_MAX_POR_MINUTO) || 15, 60_000);

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/qr/:id', async (req, res) => {
  try {
    const r = await cargarQR(req.params.id);
    if (r.error) return res.status(404).json({ error: 'Este código no existe o ha sido desactivado.' });
    const { qr, negocio, bloqueo } = r;

    if (bloqueo) {
      const [titulo, mensaje] = MENSAJES_BLOQUEO[bloqueo];
      return res.json({ estado: bloqueo, titulo, mensaje: mensaje.replace(/<br>/g, ' ') });
    }

    const base = { estado: 'ok', tipo: qr.tipo_destino, negocio: negocio.nombre_empresa };
    if (qr.tipo_destino === 'Ruleta') {
      return res.json({
        ...base,
        ruleta: await vistaPublicaRuleta(qr),
        texto_consentimiento: textoConsentimiento(negocio.nombre_empresa)
      });
    }
    if (qr.tipo_destino === 'Enlaces') return res.json({ ...base, titulo: qr.datos?.titulo, enlaces: qr.datos?.enlaces || [] });
    if (qr.tipo_destino === 'Texto') return res.json({ ...base, titulo: qr.datos?.titulo, items: qr.datos?.items || [], nota: qr.datos?.nota || '' });
    return res.status(400).json({ error: 'Este QR redirige directamente.' });
  } catch (error) {
    console.error('[Público] GET qr:', error);
    res.status(500).json({ error: 'No se pudo cargar. Inténtalo de nuevo.' });
  }
});

async function cargarRuleta(req, res) {
  const r = await cargarQR(req.params.id);
  if (r.error) { res.status(404).json({ error: 'Este código no existe o ha sido desactivado.' }); return null; }
  if (r.bloqueo || r.qr.tipo_destino !== 'Ruleta') { res.status(409).json({ error: 'Esta ruleta no está disponible ahora.' }); return null; }
  return r;
}

function responderError(res, error, ctx) {
  if (error instanceof ErrorJuego) return res.status(error.status).json({ error: error.message });
  console.error(`[Público] ${ctx}:`, error);
  res.status(500).json({ error: 'No se pudo completar. Inténtalo de nuevo.' });
}

router.post('/qr/:id/jugar', limitarEscritura, async (req, res) => {
  try {
    const r = await cargarRuleta(req, res);
    if (!r) return;
    res.json(await jugar({ qr: r.qr, negocio: r.negocio, body: req.body }));
  } catch (error) { responderError(res, error, 'jugar'); }
});

router.post('/qr/:id/avisame', limitarEscritura, async (req, res) => {
  try {
    const r = await cargarRuleta(req, res);
    if (!r) return;
    res.json(await registrarAviso({ qr: r.qr, negocio: r.negocio, body: req.body }));
  } catch (error) { responderError(res, error, 'avisame'); }
});

export default router;
