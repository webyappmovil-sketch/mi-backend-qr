/**
 * Carga un QR por su id y decide si se puede usar ahora mismo.
 * Lo comparten la redirección (/r/:id) y la API pública de la ruleta.
 */
import { ConfiguracionQR, Negocio } from '../models/index.js';
import { estadoPrueba, reglasPlan } from './planes.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MENSAJES_BLOQUEO = {
  suspendido: ['Este código QR se encuentra temporalmente inactivo', 'Este servicio aún no ha sido reactivado.<br>Inténtalo de nuevo más tarde.'],
  pendiente:  ['Código QR pendiente de activación', 'Este QR todavía no está activo.<br>El negocio debe completar su activación.'],
  pausado:    ['Este código QR está pausado', 'Este código está pausado temporalmente.<br>Vuelve a intentarlo más adelante.'],
  no_disponible: ['Este código no está disponible', 'Este tipo de código no está disponible en el plan del negocio.']
};

export async function cargarQR(id) {
  if (!UUID.test(String(id))) return { error: 'invalido' };
  const qr = await ConfiguracionQR.findOne({ where: { id, activo: true } });
  if (!qr) return { error: 'no_encontrado' };
  const negocio = await Negocio.findByPk(qr.negocio_id);
  if (!negocio) return { error: 'no_encontrado' };

  let bloqueo = null;
  if (negocio.estado_suscripcion === 'Suspendido') bloqueo = 'suspendido';
  else if (negocio.estado_suscripcion === 'Pendiente_Impresion') bloqueo = 'pendiente';
  else if (estadoPrueba(negocio).pausado) bloqueo = 'pausado';
  else if (qr.tipo_destino === 'Ruleta' && !reglasPlan(negocio.plan_actual).ruleta) bloqueo = 'no_disponible';

  return { qr, negocio, bloqueo };
}
