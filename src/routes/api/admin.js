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
import { Negocio, PedidoImpresion, ConfiguracionQR, ClienteCapturado, Escaneo, Vendedor } from '../../models/index.js';
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
        'fecha_proximo_pago',         'created_at', 'vendedor_id'
      ],
            order: [['created_at', 'DESC']]
    });

    const ids = negocios.map(n => n.id);
    const pedidos = ids.length
      ? await PedidoImpresion.findAll({
          where: { negocio_id: ids },
          order: [['created_at', 'DESC']]
        })
      : [];
    const ultimoPedido = new Map();
    for (const p of pedidos) {
      if (!ultimoPedido.has(p.negocio_id)) ultimoPedido.set(p.negocio_id, p);
    }
    const vids = [...new Set(negocios.map(n => n.vendedor_id).filter(Boolean))];
    const vendedores = vids.length
      ? await Vendedor.findAll({ where: { id: vids }, attributes: ['id', 'nombre'] })
      : [];
    const nombresVend = new Map(vendedores.map(v => [v.id, v.nombre]));
    const lista = negocios.map(n => {
      const plain = n.toJSON();
      const ped = ultimoPedido.get(n.id);
      let pagado_eur = null;
      let pagado_detalle = null;
      if (ped) {
        pagado_eur = ped.tipo_material === 'Vinilo' ? 20 : 10;
        pagado_detalle = ped.tipo_material === 'Vinilo' ? 'Vinilo' : 'Papel';
      } else if (plain.plan_actual === 'Pro') {
        pagado_eur = 19.99;
        pagado_detalle = 'mes';
      } else if (plain.plan_actual === 'Business') {
        pagado_eur = 29.99;
        pagado_detalle = 'mes';
      }
            plain.vendedor_nombre = plain.vendedor_id ? (nombresVend.get(plain.vendedor_id) || 'Vendedor') : 'ECUAWEB';
      plain.pagado_eur = pagado_eur;
      plain.pagado_detalle = pagado_detalle;
      return plain;
    });

    res.json({ negocios: lista });
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
router.delete('/negocios/:id', async (req, res) => {
  try {
    const negocio = await Negocio.findByPk(req.params.id);
    if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

    await Escaneo.destroy({ where: { negocio_id: negocio.id } });
    await ClienteCapturado.destroy({ where: { negocio_id: negocio.id } });
    await PedidoImpresion.destroy({ where: { negocio_id: negocio.id } });
    await ConfiguracionQR.destroy({ where: { negocio_id: negocio.id } });
    await negocio.destroy();

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
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
    const pedidosTodos = await PedidoImpresion.findAll({ attributes: ['tipo_material'] });
    const impresiones = pedidosTodos.reduce((suma, p) => {
      return suma + (p.tipo_material === 'Vinilo' ? 20 : 10);
    }, 0);
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
      impresiones: Math.round(impresiones * 100) / 100,
      registros_hoy: registrosHoy
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
function codigoVendedor() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += letras[Math.floor(Math.random() * letras.length)];
  return s;
}

router.get('/vendedores', async (req, res) => {
  try {
    const lista = await Vendedor.findAll({ order: [['created_at', 'DESC']] });
    const base = process.env.APP_BASE_URL || 'https://plataforma-qr-backend.onrender.com';
    const vendedores = lista.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      email: v.email,
      telefono: v.telefono,
      codigo: v.codigo,
      estado: v.estado,
      tiene_clave: !!v.password_hash,
      enlace: `${base}/login.html?v=${v.codigo}`
    }));
    res.json({
      vendedores,
      codigo_admin: 'DIRECTO',
      enlace_admin: `${base}/login.html?v=DIRECTO`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/vendedores', async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const telefono = String(req.body.telefono || '').trim();
    if (!nombre || !email || !telefono) {
      return res.status(400).json({ error: 'Nombre, email y teléfono son obligatorios' });
    }
    const existe = await Vendedor.findOne({ where: { email } });
    if (existe) return res.status(400).json({ error: 'Ese email ya está registrado' });

    let codigo = codigoVendedor();
    while (await Vendedor.findOne({ where: { codigo } })) codigo = codigoVendedor();

    const vendedor = await Vendedor.create({
      nombre, email, telefono, codigo, estado: 'Activo'
    });
    const base = process.env.APP_BASE_URL || 'https://plataforma-qr-backend.onrender.com';
    res.json({
      ok: true,
      vendedor: {
        id: vendedor.id,
        nombre: vendedor.nombre,
        email: vendedor.email,
        telefono: vendedor.telefono,
        codigo: vendedor.codigo,
        estado: vendedor.estado,
        enlace: `${base}/login.html?v=${vendedor.codigo}`
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/vendedores/:id/estado', async (req, res) => {
  try {
    const estado = req.body.estado;
    if (!['Activo', 'Bloqueado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    const vendedor = await Vendedor.findByPk(req.params.id);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado' });
    await vendedor.update({ estado });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/vendedores/:id', async (req, res) => {
  try {
    const vendedor = await Vendedor.findByPk(req.params.id);
    if (!vendedor) return res.status(404).json({ error: 'Vendedor no encontrado' });
    await Negocio.update({ vendedor_id: null }, { where: { vendedor_id: vendedor.id } });
    await vendedor.destroy();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
export default router;
