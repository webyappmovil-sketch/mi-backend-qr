/**
 * API Super Admin
 * GET   /api/admin/negocios
 * PATCH /api/admin/negocios/:id/estado
 * GET   /api/admin/pedidos
 * PATCH /api/admin/pedidos/:id/estado
 * GET   /api/admin/metricas
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { Negocio, PedidoImpresion, ConfiguracionQR, ClienteCapturado } from '../../models/index.js';
import { Op } from 'sequelize';

const router = Router();

router.use(requireAuth, requireAdmin);

/**
 * GET /api/admin/negocios
 */
router.get('/negocios', async (req, res) => {
  try {
    const negocios = await Negocio.findAll({
      attributes: [
        'id', 'nombre_empresa', 'email', 'telefono_whatsapp',
        'plan_actual', 'estado_suscripcion', 'fecha_activacion',
        'fecha_proximo_pago', 'created_at'
      ],
      order: [['created_at', 'DESC']]
    });
    res.json({ negocios });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/admin/negocios/:id/estado
 * Body: { estado: 'Activo' | 'Suspendido' | 'Pendiente_Impresion' }
 */
router.patch('/negocios/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    const validos = ['Activo', 'Suspendido', 'Pendiente_Impresion'];
    if (!validos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const negocio = await Negocio.findByPk(req.params.id);
    if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

    const updates = { estado_suscripcion: estado };
    if (estado === 'Activo' && !negocio.fecha_activacion) {
      updates.fecha_activacion = new Date();
    }
    await negocio.update(updates);

    res.json({
      ok: true,
      negocio: {
        id: negocio.id,
        nombre_empresa: negocio.nombre_empresa,
        estado_suscripcion: negocio.estado_suscripcion
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/pedidos
 * Query: ?estado=Pendiente (default)
 */
router.get('/pedidos', async (req, res) => {
  try {
    const estado = req.query.estado || 'Pendiente';
    const where = estado === 'todos' ? {} : { estado };

    const pedidos = await PedidoImpresion.findAll({
      where,
      include: [{
        model: Negocio,
        as: 'negocio',
        attributes: ['id', 'nombre_empresa', 'email', 'telefono_whatsapp']
      }],
      order: [['created_at', 'DESC']]
    });

    // Enriquecer con qr_id si falta
    const result = await Promise.all(pedidos.map(async (p) => {
      const plain = p.toJSON();
      if (!plain.archivo_qr_url && plain.negocio_id) {
        const qr = await ConfiguracionQR.findOne({
          where: { negocio_id: plain.negocio_id, activo: true }
        });
        if (qr) {
          plain.qr_id = qr.id;
          plain.archivo_qr_url = `${process.env.APP_BASE_URL || ''}/r/${qr.id}`;
        }
      } else if (plain.archivo_qr_url) {
        const match = plain.archivo_qr_url.match(/\/r\/([a-f0-9-]+)/i);
        plain.qr_id = match ? match[1] : null;
      }
      return plain;
    }));

    res.json({ pedidos: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/admin/pedidos/:id/estado
 * Body: { estado: 'Enviado' | 'Entregado' | 'Pendiente' }
 */
router.patch('/pedidos/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    const validos = ['Pendiente', 'Enviado', 'Entregado'];
    if (!validos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const pedido = await PedidoImpresion.findByPk(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    await pedido.update({ estado });
    res.json({ ok: true, pedido: { id: pedido.id, estado: pedido.estado } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/metricas
 */
router.get('/metricas', async (req, res) => {
  try {
    const totalNegocios = await Negocio.count();
    const activos = await Negocio.count({ where: { estado_suscripcion: 'Activo' } });
    const pendientes = await PedidoImpresion.count({ where: { estado: 'Pendiente' } });

    // MRR aproximado
    const proCount = await Negocio.count({
      where: { plan_actual: 'Pro', estado_suscripcion: 'Activo' }
    });
    const businessCount = await Negocio.count({
      where: { plan_actual: 'Business', estado_suscripcion: 'Activo' }
    });
    const mrr = (proCount * 19.99) + (businessCount * 29.99);

    // Registros de hoy
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const registrosHoy = await Negocio.count({
      where: { created_at: { [Op.gte]: hoy } }
    });

    res.json({
      total_negocios: totalNegocios,
      activos,
      pedidos_pendientes: pendientes,
      mrr: Math.round(mrr * 100) / 100,
      registros_hoy: registrosHoy
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
