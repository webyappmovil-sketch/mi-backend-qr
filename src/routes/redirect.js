import { Router } from 'express';
import { ConfiguracionQR, Negocio, Escaneo } from '../models/index.js';

const router = Router();

/**
 * GET /r/:id_qr
 * Motor crítico de redirección.
 * - Solo redirige a WhatsApp si el negocio está en estado "Activo".
 * - Incrementa contador de forma atómica.
 * - 301 permanente para máxima velocidad.
 */
router.get('/:id_qr', async (req, res) => {
  const { id_qr } = req.params;

  // Validación básica de UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id_qr)) {
    return res.status(400).send(htmlPage(
      'Código QR inválido',
      'El identificador del QR no es válido.',
      '#64748b'
    ));
  }

  try {
    const qr = await ConfiguracionQR.findOne({
      where: { id: id_qr, activo: true },
      attributes: ['id', 'mensaje_opciones_encoded', 'contador_escaneos', 'nombre_interno'],
      include: [{
        model: Negocio,
        as: 'negocio',
        attributes: ['id', 'telefono_whatsapp', 'estado_suscripcion', 'plan_actual', 'nombre_empresa']
      }]
    });

    if (!qr || !qr.negocio) {
      return res.status(404).send(htmlPage(
        'Código QR no encontrado',
        'Este código no existe o ha sido desactivado.',
        '#64748b'
      ));
    }

    const { estado_suscripcion, telefono_whatsapp, nombre_empresa } = qr.negocio;

    // --- Estado SUSPENDIDO ---
    if (estado_suscripcion === 'Suspendido') {
      return res.status(503).send(htmlPage(
        'Este código QR se encuentra temporalmente inactivo',
        `El negocio <strong>${nombre_empresa}</strong> aún no ha reactivado su servicio.<br>Inténtalo de nuevo más tarde.`,
        '#ef4444',
        '#fef2f2'
      ));
    }

    // --- Estado PENDIENTE DE IMPRESIÓN (Plan Starter) ---
    if (estado_suscripcion === 'Pendiente_Impresion') {
      return res.status(403).send(htmlPage(
        'Código QR pendiente de activación',
        `Este QR de <strong>${nombre_empresa}</strong> todavía no está activo.<br>El negocio debe completar el proceso de impresión física.`,
        '#f59e0b',
        '#fffbeb'
      ));
    }

    // --- Estado ACTIVO → Redirección a WhatsApp ---
    // Incremento atómico + registro de escaneo para analíticas
    await ConfiguracionQR.increment('contador_escaneos', {
      by: 1,
      where: { id: id_qr }
    });

    // Analytics + alertas de pico solo Pro/Business (no bloquean el 301)
    const negocioId = qr.negocio.id;
    const planActual = qr.negocio.plan_actual;
    Escaneo.create({
      qr_id: id_qr,
      negocio_id: negocioId,
      user_agent: (req.headers['user-agent'] || '').slice(0, 255),
      scanned_at: new Date()
    })
      .then(() => {
        if (planActual === 'Pro' || planActual === 'Business') {
          import('../services/alertasEscaneo.js')
            .then(m => m.evaluarPicoEscaneos(negocioId, planActual))
            .catch(() => {});
        }
      })
      .catch(err => console.error('[Escaneo] Error guardando:', err.message));

    // Construimos la URL de WhatsApp
    const waUrl = `https://wa.me/${telefono_whatsapp}?text=${qr.mensaje_opciones_encoded}`;

    // 301 permanente
    return res.redirect(301, waUrl);

  } catch (error) {
    console.error('[REDIRECT ERROR]', error);
    return res.status(500).send(htmlPage(
      'Error interno',
      'Ha ocurrido un error. Por favor, inténtalo más tarde.',
      '#ef4444'
    ));
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
