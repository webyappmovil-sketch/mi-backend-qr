import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfiguracionQR, Escaneo } from '../models/index.js';
import { cargarQR, MENSAJES_BLOQUEO } from '../services/qrAcceso.js';
import { validarUrlDestino } from '../services/ruleta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

/**
 * GET /r/:id_qr
 * Motor de redirección. Según el tipo de QR:
 *  - WhatsApp / Enlace → redirección 302 (NO 301: el dueño puede cambiar el destino
 *    o pausarse el QR, y un 301 lo guardan los navegadores para siempre).
 *  - Ruleta / Enlaces / Texto → página pública (frontend/q.html).
 * Cada escaneo válido incrementa el contador.
 */
router.get('/:id_qr', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  try {
    const r = await cargarQR(req.params.id_qr);
    if (r.error === 'invalido') {
      return res.status(400).send(htmlPage('Código QR inválido', 'El identificador del QR no es válido.', '#64748b'));
    }
    if (r.error) {
      return res.status(404).send(htmlPage('Código QR no encontrado', 'Este código no existe o ha sido desactivado.', '#64748b'));
    }

    const { qr, negocio, bloqueo } = r;
    if (bloqueo) {
      const [titulo, msg] = MENSAJES_BLOQUEO[bloqueo];
      const color = bloqueo === 'suspendido' ? '#ef4444' : '#f59e0b';
      const fondo = bloqueo === 'suspendido' ? '#fef2f2' : '#fffbeb';
      return res.status(bloqueo === 'pendiente' ? 403 : 503).send(htmlPage(titulo, msg, color, fondo));
    }

    // Contador atómico + registro de escaneo (analíticas; no bloquea la respuesta)
    await ConfiguracionQR.increment('contador_escaneos', { by: 1, where: { id: qr.id } });
    const planActual = negocio.plan_actual;
    Escaneo.create({
      qr_id: qr.id,
      negocio_id: negocio.id,
      user_agent: (req.headers['user-agent'] || '').slice(0, 255),
      scanned_at: new Date()
    })
      .then(() => {
        if (planActual === 'Pro' || planActual === 'Business') {
          import('../services/alertasEscaneo.js')
            .then(m => m.evaluarPicoEscaneos(negocio.id, planActual))
            .catch(() => {});
        }
      })
      .catch(err => console.error('[Escaneo] Error guardando:', err.message));

    switch (qr.tipo_destino) {
      case 'Enlace': {
        const url = validarUrlDestino(qr.url_destino);
        if (!url) {
          return res.status(200).send(htmlPage('Este QR aún no tiene destino', 'El negocio todavía no ha elegido a dónde lleva este código.', '#64748b'));
        }
        return res.redirect(302, url);
      }
      case 'Ruleta':
      case 'Enlaces':
      case 'Texto':
        return res.sendFile(path.join(__dirname, '../../frontend/q.html'));
      default: // 'WhatsApp'
        return res.redirect(302, `https://wa.me/${negocio.telefono_whatsapp}?text=${qr.mensaje_opciones_encoded}`);
    }
  } catch (error) {
    console.error('[REDIRECT ERROR]', error);
    return res.status(500).send(htmlPage('Error interno', 'Ha ocurrido un error. Por favor, inténtalo más tarde.', '#ef4444'));
  }
});

/**
 * Helper para generar páginas HTML limpias y estéticas
 */
function htmlPage(title, message, accentColor = '#64748b', bgColor = '#f8fafc') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: ${bgColor};
      color: #1e293b;
      padding: 1rem;
    }
    .card {
      background: white;
      padding: 2.5rem 2rem;
      border-radius: 1rem;
      box-shadow: 0 10px 25px rgba(0,0,0,0.08);
      text-align: center;
      max-width: 420px;
      width: 100%;
      border-top: 4px solid ${accentColor};
    }
    h1 {
      font-size: 1.35rem;
      margin-bottom: 0.85rem;
      color: ${accentColor};
      line-height: 1.3;
    }
    p {
      color: #64748b;
      line-height: 1.6;
      font-size: 0.95rem;
    }
    .footer {
      margin-top: 1.75rem;
      font-size: 0.75rem;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="footer">QR SaaS · España</div>
  </div>
</body>
</html>`;
}

export default router;
