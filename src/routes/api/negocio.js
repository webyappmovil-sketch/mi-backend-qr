/**
 * API del dueño del negocio
 * GET/PUT /api/negocio/config-qr
 * GET     /api/negocio/contactos
 * GET     /api/negocio/metricas
 */

import { Router } from 'express';
import { Op } from 'sequelize';
import { requireAuth, requireNegocio } from '../../middleware/auth.js';
import { Negocio, ConfiguracionQR, ClienteCapturado, Escaneo, Participacion } from '../../models/index.js';
import { reglasPlan, tipoPermitido, estadoPrueba, TIPOS_QR, DIAS_PRUEBA } from '../../services/planes.js';
import {
  validarUrlDestino, validarDatosRuleta, validarDatosEnlaces, validarDatosTexto,
  datosRuletaPorDefecto, estadoPremio
} from '../../services/ruleta.js';

const router = Router();

async function bloquearSuspendido(req, res, next) {
  try {
    if (req.user?.role !== 'negocio') return next();
    const negocio = await Negocio.findByPk(req.user.id, {
      attributes: ['estado_suscripcion']
    });
    if (negocio?.estado_suscripcion === 'Suspendido') {
      return res.status(403).json({
        error: 'Tu cuenta está suspendida. Contacta con soporte para reactivarla.'
      });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

router.use(requireAuth, requireNegocio, bloquearSuspendido);

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


/* ═════════════ Plan, QR y participantes ═════════════ */

function infoPlan(negocio, usados) {
  const reglas = reglasPlan(negocio.plan_actual);
  const prueba = estadoPrueba(negocio);
  return {
    plan: negocio.plan_actual,
    nombre_plan: reglas.nombre,
    max_qr: reglas.maxQR,
    qr_usados: usados,
    tipos_permitidos: reglas.tipos,
    ruleta: reglas.ruleta,
    metricas_completas: reglas.metricas,
    prueba: {
      estado: prueba.estado,
      dias_restantes: prueba.diasRestantes,
      fin: prueba.fin || null,
      cortesia_hasta: prueba.cortesiaHasta || null,
      dias_totales: DIAS_PRUEBA
    }
  };
}

function qrPublico(q) {
  return {
    id: q.id,
    nombre: q.nombre_interno,
    tipo_destino: q.tipo_destino,
    url_destino: q.url_destino,
    mensaje: (() => { try { return decodeURIComponent(q.mensaje_opciones_encoded || ''); } catch { return q.mensaje_opciones_encoded || ''; } })(),
    datos: q.datos || null,
    escaneos: q.contador_escaneos,
    creado: q.created_at
  };
}

/** Lo que cada tipo necesita guardar. Devuelve { campos } o { error } */
function camposSegunTipo(tipo, body) {
  if (tipo === 'WhatsApp') {
    const mensaje = String(body.mensaje || '').trim().slice(0, 1000);
    return { campos: { mensaje_opciones_encoded: encodeURIComponent(mensaje), url_destino: null, datos: null } };
  }
  if (tipo === 'Enlace') {
    const url = validarUrlDestino(body.url_destino);
    if (!url) return { error: 'Escribe una dirección web válida que empiece por https://' };
    return { campos: { mensaje_opciones_encoded: '', url_destino: url, datos: null } };
  }
  if (tipo === 'Enlaces') {
    const r = validarDatosEnlaces(body.datos);
    return r.error ? r : { campos: { mensaje_opciones_encoded: '', url_destino: null, datos: r.datos } };
  }
  if (tipo === 'Texto') {
    const r = validarDatosTexto(body.datos);
    return r.error ? r : { campos: { mensaje_opciones_encoded: '', url_destino: null, datos: r.datos } };
  }
  if (tipo === 'Ruleta') {
    const r = validarDatosRuleta(body.datos || datosRuletaPorDefecto());
    return r.error ? r : { campos: { mensaje_opciones_encoded: '', url_destino: null, datos: r.datos } };
  }
  return { error: 'Tipo de QR no válido' };
}

async function bloquearSiPruebaTerminada(req, res, next) {
  const negocio = await Negocio.findByPk(req.user.id);
  if (estadoPrueba(negocio).pausado) {
    return res.status(403).json({ error: 'Tu prueba gratuita terminó. Mejora tu plan para volver a editar tus QR.' });
  }
  req.negocio = negocio;
  next();
}

/** GET /api/negocio/qrs → lista de QR + información del plan */
router.get('/qrs', async (req, res) => {
  try {
    const negocio = await Negocio.findByPk(req.user.id);
    const qrs = await ConfiguracionQR.findAll({
      where: { negocio_id: req.user.id, activo: true },
      order: [['created_at', 'ASC']]
    });
    res.json({ qrs: qrs.map(qrPublico), plan: infoPlan(negocio, qrs.length), estado: negocio.estado_suscripcion, telefono_whatsapp: negocio.telefono_whatsapp });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/negocio/qrs → crear QR (respeta tipo y límite del plan) */
router.post('/qrs', bloquearSiPruebaTerminada, async (req, res) => {
  try {
    const negocio = req.negocio;
    const tipo = String(req.body.tipo_destino || '');
    if (!TIPOS_QR.includes(tipo)) return res.status(400).json({ error: 'Tipo de QR no válido' });

    if (!tipoPermitido(negocio.plan_actual, tipo)) {
      return res.status(403).json({ error: 'Este tipo de QR está disponible desde el plan Pro.', codigo: 'plan' });
    }
    const reglas = reglasPlan(negocio.plan_actual);
    const usados = await ConfiguracionQR.count({ where: { negocio_id: negocio.id, activo: true } });
    if (usados >= reglas.maxQR) {
      return res.status(403).json({
        error: `Has llegado al límite de tu plan (${reglas.maxQR} ${reglas.maxQR === 1 ? 'QR' : 'QR'}). Mejora tu plan para crear más.`,
        codigo: 'limite'
      });
    }

    const r = camposSegunTipo(tipo, req.body);
    if (r.error) return res.status(400).json({ error: r.error });

    const qr = await ConfiguracionQR.create({
      negocio_id: negocio.id,
      tipo: negocio.plan_actual === 'Starter' ? 'Estatico' : 'Dinamico',
      tipo_destino: tipo,
      nombre_interno: String(req.body.nombre || '').trim().slice(0, 100) || `QR ${usados + 1}`,
      mapeo_respuestas: {},
      ...r.campos
    });
    res.status(201).json({ ok: true, qr: qrPublico(qr) });
  } catch (error) {
    console.error('[QR crear]', error);
    res.status(500).json({ error: 'No se pudo crear el QR' });
  }
});

/** PUT /api/negocio/qrs/:id → editar (el tipo no cambia) */
router.put('/qrs/:id', bloquearSiPruebaTerminada, async (req, res) => {
  try {
    const qr = await ConfiguracionQR.findOne({ where: { id: req.params.id, negocio_id: req.user.id, activo: true } });
    if (!qr) return res.status(404).json({ error: 'QR no encontrado' });

    const r = camposSegunTipo(qr.tipo_destino, req.body);
    if (r.error) return res.status(400).json({ error: r.error });

    if (qr.tipo_destino === 'WhatsApp' && req.body.telefono_whatsapp) {
      const tel = String(req.body.telefono_whatsapp).replace(/\D/g, '');
      if (tel.length < 9) return res.status(400).json({ error: 'Teléfono de WhatsApp inválido' });
      await req.negocio.update({ telefono_whatsapp: tel });
    }
    await qr.update({
      nombre_interno: String(req.body.nombre || '').trim().slice(0, 100) || qr.nombre_interno,
      ...r.campos
    });
    res.json({ ok: true, qr: qrPublico(qr) });
  } catch (error) {
    console.error('[QR editar]', error);
    res.status(500).json({ error: 'No se pudo guardar' });
  }
});

/** DELETE /api/negocio/qrs/:id → desactiva (no borra datos ni participantes) */
router.delete('/qrs/:id', bloquearSiPruebaTerminada, async (req, res) => {
  try {
    const qr = await ConfiguracionQR.findOne({ where: { id: req.params.id, negocio_id: req.user.id, activo: true } });
    if (!qr) return res.status(404).json({ error: 'QR no encontrado' });
    await qr.update({ activo: false });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});

/** GET /api/negocio/participaciones → clientes captados por la ruleta */
router.get('/participaciones', async (req, res) => {
  try {
    const filas = await Participacion.findAll({
      where: { negocio_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 1000
    });
    const ahora = new Date();
    res.json({
      participaciones: filas.map(p => ({
        id: p.id, origen: p.origen, nombre: p.nombre, apellido: p.apellido, telefono: p.telefono,
        premio: p.es_premio ? p.premio_texto : (p.origen === 'Ruleta' ? 'Sin premio' : null),
        codigo: p.codigo, estado: estadoPremio(p, ahora), valido_hasta: p.valido_hasta,
        acepta_promos: p.consentimiento, fecha: p.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** PUT /api/negocio/participaciones/:id/canjear → marca el premio como canjeado */
router.put('/participaciones/:id/canjear', async (req, res) => {
  try {
    const p = await Participacion.findOne({ where: { id: req.params.id, negocio_id: req.user.id } });
    if (!p || !p.es_premio) return res.status(404).json({ error: 'Premio no encontrado' });
    const estado = estadoPremio(p);
    if (estado === 'Canjeado') return res.status(409).json({ error: 'Este premio ya estaba canjeado' });
    if (estado === 'Caducado') return res.status(409).json({ error: 'Este premio caducó: solo era válido el día en que se ganó' });
    await p.update({ canjeado_en: new Date() });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo canjear' });
  }
});

export default router;
