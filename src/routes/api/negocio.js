/**
 * API del dueño del negocio
 * GET/PUT /api/negocio/config-qr
 * GET     /api/negocio/contactos
 * GET     /api/negocio/metricas
 */

import { Router } from 'express';
import { Op } from 'sequelize';
import { requireAuth, requireNegocio } from '../../middleware/auth.js';
import { Negocio, ConfiguracionQR, ClienteCapturado, Escaneo } from '../../models/index.js';

const router = Router();

router.use(requireAuth, requireNegocio);

/**
 * GET /api/negocio/config-qr
 */
router.get('/config-qr', async (req, res) => {
  try {
    const qr = await ConfiguracionQR.findOne({
      where: { negocio_id: req.user.id, activo: true },
      order: [['created_at', 'ASC']]
    });

    const negocio = await Negocio.findByPk(req.user.id, {
      attributes: ['id', 'nombre_empresa', 'telefono_whatsapp', 'plan_actual', 'estado_suscripcion']
    });

    if (!qr) {
      return res.json({ qr: null, negocio });
    }

    // Decodificar mensaje para el frontend
    let mensajeDecoded = '';
    try {
      mensajeDecoded = decodeURIComponent(qr.mensaje_opciones_encoded);
    } catch {
      mensajeDecoded = qr.mensaje_opciones_encoded;
    }

    res.json({
      qr: {
        id: qr.id,
        tipo: qr.tipo,
        mensaje: mensajeDecoded,
        mensaje_encoded: qr.mensaje_opciones_encoded,
        mapeo_respuestas: qr.mapeo_respuestas || {},
        contador_escaneos: qr.contador_escaneos,
        nombre_interno: qr.nombre_interno
      },
      negocio
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/negocio/config-qr
 * Body: { telefono_whatsapp?, mensaje, mapeo_respuestas, nombre_interno? }
 */
router.put('/config-qr', async (req, res) => {
  try {
    const { telefono_whatsapp, mensaje, mapeo_respuestas, nombre_interno } = req.body;

    const negocio = await Negocio.findByPk(req.user.id);
    if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

    if (telefono_whatsapp) {
      const phoneClean = String(telefono_whatsapp).replace(/\D/g, '');
      await negocio.update({ telefono_whatsapp: phoneClean });
    }

    let qr = await ConfiguracionQR.findOne({
      where: { negocio_id: req.user.id, activo: true },
      order: [['created_at', 'ASC']]
    });

    const mensajeEncoded = mensaje
      ? encodeURIComponent(mensaje)
      : (qr?.mensaje_opciones_encoded || '');

    if (!qr) {
      qr = await ConfiguracionQR.create({
        negocio_id: req.user.id,
        tipo: negocio.plan_actual === 'Starter' ? 'Estatico' : 'Dinamico',
        mensaje_opciones_encoded: mensajeEncoded,
        mapeo_respuestas: mapeo_respuestas || {},
        nombre_interno: nombre_interno || 'QR Principal'
      });
    } else {
      await qr.update({
        mensaje_opciones_encoded: mensajeEncoded,
        mapeo_respuestas: mapeo_respuestas || qr.mapeo_respuestas,
        nombre_interno: nombre_interno || qr.nombre_interno
      });
    }

    res.json({
      ok: true,
      qr: {
        id: qr.id,
        mensaje_encoded: qr.mensaje_opciones_encoded,
        mapeo_respuestas: qr.mapeo_respuestas,
        contador_escaneos: qr.contador_escaneos
      },
      telefono: negocio.telefono_whatsapp,
      estado: negocio.estado_suscripcion
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** Fecha/hora en Europe/Madrid (España) a partir de un Date o string ISO */
function madridParts(date) {
  const s = new Date(date).toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' });
  // "2026-10-05 08:15:00"
  const [fecha, time] = s.split(' ');
  const hora = parseInt((time || '00').slice(0, 2), 10);
  return { fecha, hora };
}

function madridHoyFecha() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10);
}

/**
 * GET /api/negocio/contactos  (alias /api/contactos)
 */
router.get('/contactos', async (req, res) => {
  try {
    const contactos = await ClienteCapturado.findAll({
      where: { negocio_id: req.user.id },
      order: [['ultima_interaccion', 'DESC']],
      attributes: ['id', 'telefono_cliente', 'nombre_perfil_whatsapp', 'ultima_interaccion', 'veces_interactuado']
    });
    res.json({ contactos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/negocio/contactos/prueba
 * Crea 1–3 clientes de demostración para ver la pestaña Clientes.
 */
router.post('/contactos/prueba', async (req, res) => {
  try {
    const muestras = [
      { telefono_cliente: '34600111222', nombre_perfil_whatsapp: 'Cliente Demo 1' },
      { telefono_cliente: '34600333444', nombre_perfil_whatsapp: 'María Prueba' },
      { telefono_cliente: '34600555666', nombre_perfil_whatsapp: 'Carlos Test' }
    ];
    const creados = [];
    for (const m of muestras) {
      const [row, created] = await ClienteCapturado.findOrCreate({
        where: { negocio_id: req.user.id, telefono_cliente: m.telefono_cliente },
        defaults: {
          negocio_id: req.user.id,
          telefono_cliente: m.telefono_cliente,
          nombre_perfil_whatsapp: m.nombre_perfil_whatsapp,
          ultima_interaccion: new Date(),
          veces_interactuado: 1
        }
      });
      if (!created) {
        await row.update({
          ultima_interaccion: new Date(),
          veces_interactuado: (row.veces_interactuado || 1) + 1
        });
      }
      creados.push(row);
    }
    res.json({ ok: true, contactos: creados.length, mensaje: 'Clientes de prueba añadidos' });
  } catch (error) {
    console.error('[Contactos prueba]', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/negocio/metricas
 * Horarios en zona Europe/Madrid
 */
router.get('/metricas', async (req, res) => {
  try {
    const negocioId = req.user.id;
    const dias = req.query.periodo === '30d' ? 30 : 7;

    const qr = await ConfiguracionQR.findOne({
      where: { negocio_id: negocioId, activo: true }
    });
    const totalClientes = await ClienteCapturado.count({
      where: { negocio_id: negocioId }
    });

    // Desde medianoche de hace (dias-1) en Madrid → aprox. UTC
    const hoyMadrid = madridHoyFecha();
    const desde = new Date();
    desde.setUTCDate(desde.getUTCDate() - (dias + 1)); // margen amplio; filtramos por clave Madrid

    const escaneos = await Escaneo.findAll({
      where: {
        negocio_id: negocioId,
        scanned_at: { [Op.gte]: desde }
      },
      attributes: ['scanned_at'],
      raw: true
    });

    // Etiquetas de los últimos N días en Madrid
    const porDiaMap = {};
    const labelsDia = [];
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10);
      porDiaMap[key] = 0;
      labelsDia.push(key);
    }
    for (const e of escaneos) {
      const { fecha } = madridParts(e.scanned_at);
      if (porDiaMap[fecha] !== undefined) porDiaMap[fecha]++;
    }

    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const por_dia = labelsDia.map(fecha => {
      const d = new Date(fecha + 'T12:00:00');
      return {
        fecha,
        label: diasSemana[d.getDay()] + ' ' + fecha.slice(8, 10),
        total: porDiaMap[fecha] || 0
      };
    });

    // Horas 0-23 en horario de España
    const porHoraArr = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
    for (const e of escaneos) {
      const { fecha, hora } = madridParts(e.scanned_at);
      if (labelsDia.includes(fecha) && hora >= 0 && hora < 24) {
        porHoraArr[hora].total++;
      }
    }

    const totalPeriodo = labelsDia.reduce((s, f) => s + (porDiaMap[f] || 0), 0);
    const escaneos_semana = por_dia.slice(-7).map(d => d.total);

    res.json({
      total_escaneos: qr?.contador_escaneos || 0,
      total_clientes: totalClientes,
      total_periodo: totalPeriodo,
      periodo_dias: dias,
      zona: 'Europe/Madrid',
      por_dia,
      por_hora: porHoraArr,
      escaneos_semana
    });
  } catch (error) {
    console.error('[Metricas]', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
