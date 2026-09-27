/**
 * Auth API
 * POST /api/auth/registro
 * POST /api/auth/login
 * GET  /api/auth/me
 */

import { Router } from 'express';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { Negocio, SuperAdmin, ConfiguracionQR } from '../../models/index.js';
import { signToken, requireAuth } from '../../middleware/auth.js';
import { enviarEmailBienvenida } from '../../services/email.js';

dotenv.config();

const router = Router();

/**
 * POST /api/auth/registro
 * Crea un negocio en Plan Starter + Pendiente_Impresion
 * Body: { nombre_empresa, email, password, telefono_whatsapp }
 */
router.post('/registro', async (req, res) => {
  try {
    const { nombre_empresa, email, password, telefono_whatsapp } = req.body;

    if (!nombre_empresa || !email || !password || !telefono_whatsapp) {
      return res.status(400).json({
        error: 'Se requieren nombre_empresa, email, password y telefono_whatsapp'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const phoneClean = String(telefono_whatsapp).replace(/\D/g, '');
    if (phoneClean.length < 9) {
      return res.status(400).json({ error: 'Teléfono de WhatsApp inválido' });
    }

    // ¿Email ya existe?
    const existe = await Negocio.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existe) {
      return res.status(409).json({ error: 'Este email ya está registrado' });
    }

    // ¿Es el email de admin?
    if (email.toLowerCase().trim() === (process.env.ADMIN_EMAIL || '').toLowerCase()) {
      return res.status(400).json({ error: 'Email reservado' });
    }

    const negocio = await Negocio.create({
      nombre_empresa: nombre_empresa.trim(),
      email: email.toLowerCase().trim(),
      password_hash: password, // se hashea en el hook beforeCreate
      telefono_whatsapp: phoneClean,
      plan_actual: 'Starter',
      estado_suscripcion: 'Pendiente_Impresion'
    });

    // Crear QR por defecto vacío
    const mensajeDefault = encodeURIComponent(
      `¡Hola! 👋 Bienvenido a *${negocio.nombre_empresa}*\n\nElige una opción:\n1️⃣ Ver información\n2️⃣ Contactar`
    );

    const qr = await ConfiguracionQR.create({
      negocio_id: negocio.id,
      tipo: 'Estatico',
      mensaje_opciones_encoded: mensajeDefault,
      mapeo_respuestas: { '1': 'Info', '2': 'humano' },
      nombre_interno: 'QR Principal',
      contador_escaneos: 0
    });

    const token = signToken({
      id: negocio.id,
      role: 'negocio',
      email: negocio.email,
      nombre: negocio.nombre_empresa,
      plan: negocio.plan_actual,
      estado: negocio.estado_suscripcion,
      telefono: negocio.telefono_whatsapp,
      qrId: qr.id
    });

    // Email de bienvenida (no bloquea el registro si falla)
    enviarEmailBienvenida({
      nombreEmpresa: negocio.nombre_empresa,
      email: negocio.email,
      telefonoWhatsapp: negocio.telefono_whatsapp
    }).catch(err => console.error('[Auth] Error email bienvenida:', err.message));

    res.status(201).json({
      token,
      user: {
        id: negocio.id,
        role: 'negocio',
        email: negocio.email,
        nombre: negocio.nombre_empresa,
        plan: negocio.plan_actual,
        estado: negocio.estado_suscripcion,
        telefono: negocio.telefono_whatsapp,
        qrId: qr.id
      }
    });
  } catch (error) {
    console.error('[Auth] Registro error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Si email === ADMIN_EMAIL → rol admin
 * Si no → busca en Negocios
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const emailClean = email.toLowerCase().trim();
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@qrsas.es').toLowerCase();

    // ── Super Admin ──
    if (emailClean === adminEmail) {
      const admin = await SuperAdmin.findOne({ where: { email: emailClean } });
      if (!admin) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
      }
      const valid = await bcrypt.compare(password, admin.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
      }

      const token = signToken({
        id: admin.id,
        role: 'admin',
        email: admin.email,
        nombre: admin.nombre
      });

      return res.json({
        token,
        user: {
          id: admin.id,
          role: 'admin',
          email: admin.email,
          nombre: admin.nombre
        }
      });
    }

    // ── Negocio ──
    const negocio = await Negocio.findOne({ where: { email: emailClean } });
    if (!negocio) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const valid = await bcrypt.compare(password, negocio.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const qr = await ConfiguracionQR.findOne({
      where: { negocio_id: negocio.id, activo: true },
      order: [['created_at', 'ASC']]
    });

    const token = signToken({
      id: negocio.id,
      role: 'negocio',
      email: negocio.email,
      nombre: negocio.nombre_empresa,
      plan: negocio.plan_actual,
      estado: negocio.estado_suscripcion,
      telefono: negocio.telefono_whatsapp,
      qrId: qr?.id || null
    });

    res.json({
      token,
      user: {
        id: negocio.id,
        role: 'negocio',
        email: negocio.email,
        nombre: negocio.nombre_empresa,
        plan: negocio.plan_actual,
        estado: negocio.estado_suscripcion,
        telefono: negocio.telefono_whatsapp,
        qrId: qr?.id || null
      }
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/auth/me
 * Devuelve el usuario actual (requiere token)
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.json({ user: req.user });
    }

    const negocio = await Negocio.findByPk(req.user.id);
    if (!negocio) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const qr = await ConfiguracionQR.findOne({
      where: { negocio_id: negocio.id, activo: true },
      order: [['created_at', 'ASC']]
    });

    res.json({
      user: {
        id: negocio.id,
        role: 'negocio',
        email: negocio.email,
        nombre: negocio.nombre_empresa,
        plan: negocio.plan_actual,
        estado: negocio.estado_suscripcion,
        telefono: negocio.telefono_whatsapp,
        qrId: qr?.id || null
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
