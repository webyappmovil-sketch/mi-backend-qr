/**
 * Configuración de entorno compartida.
 *
 * - isProduction: true en Render (variable RENDER) o con NODE_ENV=production.
 * - getSecret(): en producción EXIGE la variable (si falta, el servidor no arranca);
 *   en local usa un valor de desarrollo para poder probar sin configurar nada.
 */

import dotenv from 'dotenv';

dotenv.config();

export const isProduction =
  process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

/**
 * @param {string} name          Nombre de la variable de entorno
 * @param {string} devFallback   Valor SOLO para desarrollo local
 * @param {{ rejectDefault?: boolean }} [opts]
 *        rejectDefault: en producción rechaza también el valor de desarrollo
 */
export function getSecret(name, devFallback, { rejectDefault = false } = {}) {
  const value = process.env[name];

  if (value && value.trim()) {
    if (isProduction && rejectDefault && value === devFallback) {
      throw new Error(`${name} tiene el valor de desarrollo por defecto. Define uno propio y secreto en producción.`);
    }
    return value;
  }

  if (isProduction) {
    throw new Error(`Falta la variable de entorno obligatoria ${name} (producción).`);
  }

  console.warn(`[Config] ${name} no definida: usando valor de desarrollo (solo local).`);
  return devFallback;
}
