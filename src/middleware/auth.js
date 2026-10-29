/**
 * Middleware de autenticación JWT
 */

import jwt from 'jsonwebtoken';
import { getSecret, isProduction } from '../config/env.js';

const DEV_JWT_SECRET = 'qr-saas-dev-secret-change-in-production';

// En producción es OBLIGATORIO definir JWT_SECRET (si falta, el servidor no arranca)
const JWT_SECRET = getSecret('JWT_SECRET', DEV_JWT_SECRET, { rejectDefault: true });

if (isProduction && JWT_SECRET.length < 32) {
  console.warn('[Config] ⚠️  JWT_SECRET tiene menos de 32 caracteres. Usa uno largo y aleatorio.');
}

/**
 * Firma un token JWT
 */
export function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * Middleware: requiere token válido
 * Adjunta req.user = { id, role, email, ... }
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/**
 * Middleware: solo Super Admin
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso solo para Super Admin' });
  }
  next();
}

/**
 * Middleware: solo dueño de negocio (o admin)
 */
export function requireNegocio(req, res, next) {
  if (!req.user || (req.user.role !== 'negocio' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Acceso solo para negocios' });
  }
  next();
}
