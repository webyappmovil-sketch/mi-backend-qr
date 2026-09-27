/**
 * Middleware de autenticación JWT
 */

import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'qr-saas-dev-secret-change-in-production';

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
