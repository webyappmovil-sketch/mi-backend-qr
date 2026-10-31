/**
 * Ruleta de premios + validación de los datos de cada tipo de QR.
 *
 * Reglas (acordadas con el negocio):
 *  - 6 casillas. Cada una: texto, color, probabilidad, ¿es premio?, tope por día.
 *  - El SERVIDOR decide el resultado (la animación solo lo muestra).
 *  - Una participación por teléfono y día.
 *  - Quien gana no puede volver a ganar hasta pasar `periodo_dias` (7 o 30).
 *  - El premio solo se canjea el día en que se gana (caduca a las 23:59).
 *  - Si un premio agota su tope diario, esa casilla pasa a "Sigue probando".
 *  - Si no queda ningún premio disponible hoy, se avisa ANTES de pedir datos.
 */

import crypto from 'crypto';
import { Op, Transaction, fn, col } from 'sequelize';
import { sequelize, ConfiguracionQR, Participacion } from '../models/index.js';
import { inicioDiaMadrid, inicioDiaSiguienteMadrid, fechaCorta } from './planes.js';

const DIA_MS = 24 * 60 * 60 * 1000;
export const NUM_CASILLAS = 6;
export const MAX_ENLACES = 6;
export const COLORES = ['#7F77DD', '#1D9E75', '#D85A30', '#EF9F27', '#D4537E', '#378ADD', '#888780'];
export const ICONOS = ['whatsapp', 'pdf', 'web', 'video', 'catalogo', 'mapa', 'telefono', 'email', 'otro'];
const TEXTO_SIN_PREMIO = 'Sigue probando';
const COLOR_SIN_PREMIO = '#888780';

export class ErrorJuego extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}

/* ───────────────────── Validaciones ───────────────────── */

const reNombre = /^[\p{L}][\p{L}\s'.-]{1,59}$/u;

export function normalizarMovil(raw) {
  let d = String(raw || '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0034')) d = d.slice(4);
  if (/^34[67]\d{8}$/.test(d)) return d;
  if (/^[67]\d{8}$/.test(d)) return '34' + d;
  return null;
}

function limpiarTexto(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

function urlSegura(raw) {
  const s = String(raw || '').trim();
  if (s.length > 2000) return null;
  try {
    const u = new URL(s);
    return ['http:', 'https:', 'tel:', 'mailto:'].includes(u.protocol) ? u.toString() : null;
  } catch { return null; }
}

/** Valida y normaliza una URL de destino (solo http/https) */
export function validarUrlDestino(raw) {
  const u = urlSegura(raw);
  return u && /^https?:/.test(u) ? u : null;
}

export function validarEnlaces(lista, max = MAX_ENLACES) {
  if (!Array.isArray(lista)) return { error: 'Los enlaces deben ser una lista' };
  if (lista.length > max) return { error: `Máximo ${max} enlaces` };
  const out = [];
  for (const e of lista) {
    const etiqueta = limpiarTexto(e?.etiqueta, 40);
    const url = urlSegura(e?.url);
    if (!etiqueta) return { error: 'Cada enlace necesita un nombre' };
    if (!url) return { error: `El enlace "${etiqueta}" no es una dirección válida (usa https://…)` };
    out.push({ etiqueta, url, icono: ICONOS.includes(e?.icono) ? e.icono : 'otro' });
  }
  return { enlaces: out };
}

export function validarDatosTexto(d) {
  const titulo = limpiarTexto(d?.titulo, 60);
  if (!titulo) return { error: 'Escribe un título' };
  const items = Array.isArray(d?.items) ? d.items : [];
  if (items.length < 1 || items.length > 4) return { error: 'Añade de 1 a 4 datos para mostrar' };
  const out = [];
  for (const it of items) {
    const etiqueta = limpiarTexto(it?.etiqueta, 30);
    const valor = limpiarTexto(it?.valor, 120);
    if (!etiqueta || !valor) return { error: 'Cada dato necesita nombre y valor' };
    out.push({ etiqueta, valor });
  }
  return { datos: { titulo, items: out, nota: limpiarTexto(d?.nota, 160) } };
}

export function validarDatosEnlaces(d) {
  const titulo = limpiarTexto(d?.titulo, 60);
  if (!titulo) return { error: 'Escribe un título' };
  const r = validarEnlaces(d?.enlaces, 12);
  if (r.error) return r;
  if (r.enlaces.length < 1) return { error: 'Añade al menos un enlace' };
  return { datos: { titulo, enlaces: r.enlaces } };
}

export function datosRuletaPorDefecto() {
  return {
    titulo: '¿Quieres jugar a la ruleta y ganar premios?',
    premios: [
      { texto: '10 % dto.',     color: COLORES[0], probabilidad: 15, es_premio: true,  tope_dia: 10 },
      { texto: 'Café gratis',   color: COLORES[1], probabilidad: 10, es_premio: true,  tope_dia: 5 },
      { texto: '5 % dto.',      color: COLORES[2], probabilidad: 20, es_premio: true,  tope_dia: 15 },
      { texto: 'Postre gratis', color: COLORES[3], probabilidad: 5,  es_premio: true,  tope_dia: 3 },
      { texto: '2x1 en café',   color: COLORES[5], probabilidad: 5,  es_premio: true,  tope_dia: 3 },
      { texto: TEXTO_SIN_PREMIO, color: COLOR_SIN_PREMIO, probabilidad: 45, es_premio: false, tope_dia: null }
    ],
    periodo_dias: 7,
    enlaces: []
  };
}

export function validarDatosRuleta(d) {
  const titulo = limpiarTexto(d?.titulo, 80) || datosRuletaPorDefecto().titulo;
  if (!Array.isArray(d?.premios) || d.premios.length !== NUM_CASILLAS) {
    return { error: `La ruleta necesita exactamente ${NUM_CASILLAS} casillas` };
  }
  let suma = 0;
  const premios = [];
  for (const [i, p] of d.premios.entries()) {
    const texto = limpiarTexto(p?.texto, 24);
    if (!texto) return { error: `La casilla ${i + 1} necesita un texto` };
    const prob = Number(p?.probabilidad);
    if (!Number.isFinite(prob) || prob < 0 || prob > 100) return { error: `Probabilidad inválida en "${texto}"` };
    const es_premio = Boolean(p?.es_premio);
    if (es_premio && prob <= 0) return { error: `"${texto}" es un premio: su probabilidad debe ser mayor que 0` };
    let tope = null;
    if (es_premio && p?.tope_dia !== null && p?.tope_dia !== '' && p?.tope_dia !== undefined) {
      tope = Number(p.tope_dia);
      if (!Number.isInteger(tope) || tope < 1 || tope > 9999) return { error: `El tope diario de "${texto}" debe ser un número entero desde 1` };
    }
    suma += prob;
    premios.push({
      texto,
      color: COLORES.includes(p?.color) ? p.color : COLORES[i % COLORES.length],
      probabilidad: Math.round(prob * 100) / 100,
      es_premio,
      tope_dia: es_premio ? tope : null
    });
  }
  if (Math.abs(suma - 100) > 0.01) return { error: `Las probabilidades suman ${Math.round(suma * 100) / 100} %: deben sumar 100 %` };
  if (!premios.some(p => p.es_premio)) return { error: 'Debe haber al menos un premio' };

  const periodo_dias = [7, 30].includes(Number(d?.periodo_dias)) ? Number(d.periodo_dias) : 7;
  const r = validarEnlaces(d?.enlaces || [], MAX_ENLACES);
  if (r.error) return r;
  return { datos: { titulo, premios, periodo_dias, enlaces: r.enlaces } };
}

/* ───────────────────── Estado de los premios hoy ───────────────────── */

async function premiosEntregadosHoy(qrId, ahora, transaction) {
  const filas = await Participacion.findAll({
    attributes: ['premio_indice', [fn('COUNT', col('id')), 'n']],
    where: { qr_id: qrId, origen: 'Ruleta', es_premio: true, created_at: { [Op.gte]: inicioDiaMadrid(ahora) } },
    group: ['premio_indice'],
    raw: true,
    transaction
  });
  const mapa = {};
  for (const f of filas) mapa[f.premio_indice] = Number(f.n);
  return mapa;
}

/** Casillas tal como se ven hoy: un premio sin stock se muestra como "Sigue probando" */
function casillasDeHoy(datos, entregados) {
  return datos.premios.map((p, i) => {
    const agotado = p.es_premio && p.tope_dia !== null && (entregados[i] || 0) >= p.tope_dia;
    return agotado
      ? { texto: TEXTO_SIN_PREMIO, color: COLOR_SIN_PREMIO, es_premio: false, prob: p.probabilidad, agotado: true }
      : { texto: p.texto, color: p.color, es_premio: p.es_premio, prob: p.probabilidad, agotado: false };
  });
}

/** Lo que ve el cliente: nunca incluye probabilidades ni topes */
export async function vistaPublicaRuleta(qr, ahora = new Date()) {
  const datos = qr.datos || datosRuletaPorDefecto();
  const casillas = casillasDeHoy(datos, await premiosEntregadosHoy(qr.id, ahora));
  return {
    titulo: datos.titulo,
    casillas: casillas.map(c => ({ texto: c.texto, color: c.color })),
    premios_agotados: !casillas.some(c => c.es_premio),
    periodo_dias: datos.periodo_dias,
    enlaces: datos.enlaces || []
  };
}

/* ───────────────────── Jugar ───────────────────── */

// Serializa las jugadas de un mismo QR dentro del proceso (junto con el bloqueo de fila en BD)
const colas = new Map();
function enCola(clave, tarea) {
  const previa = colas.get(clave) || Promise.resolve();
  const actual = previa.catch(() => {}).then(tarea);
  colas.set(clave, actual);
  actual.finally(() => { if (colas.get(clave) === actual) colas.delete(clave); }).catch(() => {});
  return actual;
}

function iniciales(nombreNegocio) {
  const s = String(nombreNegocio || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
  return s || 'QR';
}

async function generarCodigo(nombreNegocio, negocioId, transaction) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let intento = 0; intento < 8; intento++) {
    let suf = '';
    for (let i = 0; i < 4; i++) suf += alfabeto[crypto.randomInt(alfabeto.length)];
    const codigo = `${iniciales(nombreNegocio)}-${suf}`;
    const existe = await Participacion.findOne({ where: { negocio_id: negocioId, codigo }, transaction });
    if (!existe) return codigo;
  }
  return `${iniciales(nombreNegocio)}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

function elegirCasilla(casillas) {
  const total = casillas.reduce((a, c) => a + c.prob, 0);
  let r = crypto.randomInt(0, 1_000_000) / 1_000_000 * total;
  for (let i = 0; i < casillas.length; i++) {
    r -= casillas[i].prob;
    if (r < 0) return i;
  }
  return casillas.length - 1;
}

export function textoConsentimiento(nombreNegocio) {
  return `Acepto que ${nombreNegocio} guarde mis datos y me envíe promociones.`;
}

function validarPersona(body, { exigirApellido }) {
  const nombre = limpiarTexto(body?.nombre, 60);
  const apellido = limpiarTexto(body?.apellido, 60);
  if (!reNombre.test(nombre)) throw new ErrorJuego(400, 'Escribe tu nombre.');
  if (exigirApellido && !reNombre.test(apellido)) throw new ErrorJuego(400, 'Escribe tu apellido.');
  const telefono = normalizarMovil(body?.telefono);
  if (!telefono) throw new ErrorJuego(400, 'Escribe un móvil español de 9 dígitos.');
  if (body?.consentimiento !== true) throw new ErrorJuego(400, 'Marca la casilla para poder participar.');
  return { nombre, apellido: apellido || null, telefono };
}

export function jugar({ qr, negocio, body, ahora = new Date() }) {
  const persona = validarPersona(body, { exigirApellido: true });

  return enCola(qr.id, () =>
    sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (t) => {
      // Bloqueo de la fila del QR: dos jugadas a la vez no pueden pasarse del tope
      const fila = await ConfiguracionQR.findOne({
        where: { id: qr.id, activo: true }, transaction: t, lock: t.LOCK.UPDATE
      });
      if (!fila) throw new ErrorJuego(404, 'Este QR ya no está disponible.');
      const datos = fila.datos || datosRuletaPorDefecto();
      const inicioHoy = inicioDiaMadrid(ahora);

      // 1) Una participación por teléfono y día
      const hoy = await Participacion.findOne({
        where: { qr_id: qr.id, origen: 'Ruleta', telefono: persona.telefono, created_at: { [Op.gte]: inicioHoy } },
        transaction: t
      });
      if (hoy) return { resultado: 'ya_jugo_hoy' };

      // 2) ¿Ganó hace poco?
      const ultimoPremio = await Participacion.findOne({
        where: { qr_id: qr.id, origen: 'Ruleta', telefono: persona.telefono, es_premio: true },
        order: [['created_at', 'DESC']],
        transaction: t
      });
      if (ultimoPremio) {
        const puedeVolver = new Date(inicioDiaMadrid(new Date(ultimoPremio.created_at)).getTime() + datos.periodo_dias * DIA_MS);
        if (ahora < puedeVolver) {
          return { resultado: 'ya_gano', puede_volver: puedeVolver.toISOString(), puede_volver_texto: fechaCorta(puedeVolver) };
        }
      }

      // 3) ¿Quedan premios hoy?
      const casillas = casillasDeHoy(datos, await premiosEntregadosHoy(qr.id, ahora, t));
      if (!casillas.some(c => c.es_premio)) return { resultado: 'agotado' };

      // 4) Sorteo en el servidor
      const indice = elegirCasilla(casillas);
      const casilla = casillas[indice];
      const gana = casilla.es_premio;
      const codigo = gana ? await generarCodigo(negocio.nombre_empresa, negocio.id, t) : null;
      const validoHasta = gana ? inicioDiaSiguienteMadrid(ahora) : null;

      await Participacion.create({
        negocio_id: negocio.id, qr_id: qr.id, origen: 'Ruleta',
        nombre: persona.nombre, apellido: persona.apellido, telefono: persona.telefono,
        consentimiento: true,
        texto_consentimiento: textoConsentimiento(negocio.nombre_empresa),
        fecha_consentimiento: ahora,
        premio_indice: indice, premio_texto: casilla.texto, es_premio: gana,
        codigo, valido_hasta: validoHasta
      }, { transaction: t });

      return {
        resultado: gana ? 'gana' : 'pierde',
        indice,
        premio: { texto: casilla.texto, color: casilla.color },
        codigo,
        valido_hasta: validoHasta ? validoHasta.toISOString() : null
      };
    })
  );
}

/** "Avísame de la próxima promoción" cuando hoy no quedan premios */
export async function registrarAviso({ qr, negocio, body, ahora = new Date() }) {
  const persona = validarPersona(body, { exigirApellido: false });
  const existe = await Participacion.findOne({
    where: { qr_id: qr.id, origen: 'Aviso', telefono: persona.telefono }
  });
  if (existe) return { ok: true, repetido: true };
  await Participacion.create({
    negocio_id: negocio.id, qr_id: qr.id, origen: 'Aviso',
    nombre: persona.nombre, apellido: persona.apellido, telefono: persona.telefono,
    consentimiento: true,
    texto_consentimiento: textoConsentimiento(negocio.nombre_empresa),
    fecha_consentimiento: ahora
  });
  return { ok: true };
}

export function estadoPremio(p, ahora = new Date()) {
  if (!p.es_premio) return null;
  if (p.canjeado_en) return 'Canjeado';
  if (p.valido_hasta && ahora >= new Date(p.valido_hasta)) return 'Caducado';
  return 'Pendiente';
}
