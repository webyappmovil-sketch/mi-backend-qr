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
 * GET /api/negocio/metricas
 * Query: ?periodo=7d|30d (default 7d)
 *
 * Devuelve:
 * - total_escaneos, total_clientes
 * - por_dia: [{ fecha, label, total }] últimos N días
 * - por_hora: [{ hora, total }] 0-23 (últimas 24h o del periodo)
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

    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    desde.setDate(desde.getDate() - (dias - 1));

    // Escaneos del periodo
    const escaneos = await Escaneo.findAll({
      where: {
        negocio_id: negocioId,
        scanned_at: { [Op.gte]: desde }
      },
      attributes: ['scanned_at'],
      raw: true
    });

    // Agregar por día
    const porDiaMap = {};
    const labelsDia = [];
    for (let i = 0; i < dias; i++) {
      const d = new Date(desde);
      d.setDate(desde.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      porDiaMap[key] = 0;
      labelsDia.push(key);
    }
    for (const e of escaneos) {
      const key = new Date(e.scanned_at).toISOString().slice(0, 10);
      if (porDiaMap[key] !== undefined) porDiaMap[key]++;
    }

    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const por_dia = labelsDia.map(fecha => {
      const d = new Date(fecha + 'T12:00:00');
      return {
        fecha,
        label: diasSemana[d.getDay()] + ' ' + fecha.slice(8, 10),
        total: porDiaMap[fecha]
      };
    });

    // Agregar por hora (0-23) sobre los escaneos del periodo
    const porHoraArr = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
    for (const e of escaneos) {
      const h = new Date(e.scanned_at).getHours();
      porHoraArr[h].total++;
    }

    // También últimos 7 días como array simple (compatibilidad frontend)
    const escaneos_semana = por_dia.slice(-7).map(d => d.total);

    res.json({
      total_escaneos: qr?.contador_escaneos || 0,
      total_clientes: totalClientes,
      total_periodo: escaneos.length,
      periodo_dias: dias,
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
