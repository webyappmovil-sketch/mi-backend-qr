/**
 * Reglas de planes, prueba gratuita y fechas (hora de Madrid).
 *
 * Plan "Gratuito" = valor 'Starter' en la base de datos (así no hay que
 * migrar el tipo ENUM de la columna plan_actual).
 */

export const TZ = 'Europe/Madrid';
const DIA_MS = 24 * 60 * 60 * 1000;

export const DIAS_PRUEBA = 60;
export const DIAS_CORTESIA = 7;

export const TIPOS_QR = ['WhatsApp', 'Enlace', 'Enlaces', 'Texto', 'Ruleta'];

export const PLANES = {
  Starter:  { nombre: 'Gratuito', maxQR: 1,  tipos: ['WhatsApp', 'Enlace'], ruleta: false, metricas: false },
  Pro:      { nombre: 'Pro',      maxQR: 5,  tipos: TIPOS_QR,              ruleta: true,  metricas: true },
  Business: { nombre: 'Business', maxQR: 50, tipos: TIPOS_QR,              ruleta: true,  metricas: true }
};

export function reglasPlan(plan) {
  return PLANES[plan] || PLANES.Starter;
}

export function tipoPermitido(plan, tipo) {
  return reglasPlan(plan).tipos.includes(tipo);
}

/** Fin de la prueba para un negocio gratuito nuevo */
export function calcularFinPrueba(desde = new Date()) {
  return new Date(desde.getTime() + DIAS_PRUEBA * DIA_MS);
}

/**
 * Estado de la prueba gratuita.
 *  - sinPrueba: plan de pago o negocio antiguo sin caducidad
 *  - activa:    dentro de los 60 días
 *  - cortesia:  pasaron los 60 días pero el QR aún funciona (7 días)
 *  - pausada:   el QR ya no redirige
 */
export function estadoPrueba(negocio, ahora = new Date()) {
  if (!negocio || negocio.plan_actual !== 'Starter' || !negocio.prueba_fin) {
    return { estado: 'sinPrueba', diasRestantes: null, pausado: false };
  }
  const fin = new Date(negocio.prueba_fin).getTime();
  const t = ahora.getTime();
  const diasRestantes = Math.ceil((fin - t) / DIA_MS);

  if (t <= fin) return { estado: 'activa', diasRestantes, pausado: false, fin: new Date(fin) };
  if (t <= fin + DIAS_CORTESIA * DIA_MS) {
    return {
      estado: 'cortesia', diasRestantes: 0, pausado: false, fin: new Date(fin),
      cortesiaHasta: new Date(fin + DIAS_CORTESIA * DIA_MS)
    };
  }
  return { estado: 'pausada', diasRestantes: 0, pausado: true, fin: new Date(fin) };
}

/* ───────── Fechas en hora de Madrid ───────── */

function offsetMin(date) {
  const local = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 60000);
}

/** Instante (UTC) en que empezó el día de Madrid que contiene `ahora` */
export function inicioDiaMadrid(ahora = new Date()) {
  const ymd = ahora.toLocaleDateString('sv-SE', { timeZone: TZ });
  const guess = new Date(`${ymd}T00:00:00Z`);
  return new Date(guess.getTime() - offsetMin(guess) * 60000);
}

/** Instante en que empieza el día siguiente (el premio caduca ahí, o sea a las 23:59:59) */
export function inicioDiaSiguienteMadrid(ahora = new Date()) {
  return inicioDiaMadrid(new Date(inicioDiaMadrid(ahora).getTime() + 30 * 60 * 60 * 1000));
}

export function fechaCorta(date) {
  return new Date(date).toLocaleDateString('es-ES', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long'
  });
}
