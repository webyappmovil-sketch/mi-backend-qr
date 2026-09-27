/**
 * Webhook de WhatsApp Cloud API (Meta)
 * GET  /webhooks/whatsapp-bot  → Verificación del webhook
 * POST /webhooks/whatsapp-bot  → Recepción de mensajes entrantes
 *
 * Flujo:
 * 1. Extrae teléfono del cliente, texto y profile.name
 * 2. Identifica el negocio por el phone_number_id que recibió el mensaje
 * 3. Si el texto es un número (ej. "1"), busca en mapeo_respuestas y responde
 * 4. Upsert en ClientesCapturados
 */

import { Router } from 'express';
import dotenv from 'dotenv';
import { Negocio, ConfiguracionQR, ClienteCapturado } from '../../models/index.js';
import { enviarMensajeTexto, enviarMensajeConEnlace } from '../../services/whatsapp.js';

dotenv.config();

const router = Router();

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'mi_token_de_verificacion_seguro';

/**
 * GET – Verificación del webhook (Meta lo llama al configurar)
 * Query params: hub.mode, hub.verify_token, hub.challenge
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verificado correctamente');
    return res.status(200).send(challenge);
  }

  console.warn('[WhatsApp] Fallo de verificación de webhook');
  return res.sendStatus(403);
});

/**
 * POST – Mensajes entrantes
 */
router.post('/', async (req, res) => {
  // Respondemos 200 inmediatamente para que Meta no reintente
  res.sendStatus(200);

  try {
    const body = req.body;

    // Estructura típica de WhatsApp Cloud API
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages || value.messages.length === 0) return;

    const message = value.messages[0];
    const contact = value.contacts?.[0];
    const metadata = value.metadata; // contiene phone_number_id y display_phone_number

    // Datos del cliente final
    const from = message.from;                     // teléfono internacional
    const messageId = message.id;
    const timestamp = message.timestamp;
    const textBody = message.text?.body?.trim() || '';
    const profileName = contact?.profile?.name || null;

    // Identificador del número de negocio que recibió el mensaje
    const phoneNumberId = metadata?.phone_number_id;
    const displayPhone = metadata?.display_phone_number; // ej: 34600111222

    console.log(`[WhatsApp] Mensaje de ${from} (${profileName}): "${textBody}"`);

    // ─── 1. Identificar el negocio ───────────────────────────────────
    // Prioridad: por telefono_whatsapp del negocio
    let negocio = null;

    if (displayPhone) {
      // Limpiamos posibles espacios o +
      const phoneClean = displayPhone.replace(/\D/g, '');
      negocio = await Negocio.findOne({
        where: { telefono_whatsapp: phoneClean }
      });
    }

    // Fallback: si solo tienes un número de WhatsApp Business en la app,
    // puedes buscar el primer negocio Activo (útil en desarrollo)
    if (!negocio) {
      negocio = await Negocio.findOne({
        where: { estado_suscripcion: 'Activo' },
        order: [['created_at', 'ASC']]
      });
    }

    if (!negocio) {
      console.warn('[WhatsApp] No se encontró negocio para este mensaje');
      return;
    }

    // Solo respondemos si el negocio está Activo
    if (negocio.estado_suscripcion !== 'Activo') {
      console.log(`[WhatsApp] Negocio ${negocio.nombre_empresa} no está Activo → ignoramos`);
      return;
    }

    // ─── 2. Guardar / actualizar cliente capturado ───────────────────
    const [cliente, created] = await ClienteCapturado.findOrCreate({
      where: {
        negocio_id: negocio.id,
        telefono_cliente: from
      },
      defaults: {
        nombre_perfil_whatsapp: profileName,
        ultima_interaccion: new Date(),
        veces_interactuado: 1
      }
    });

    if (!created) {
      await cliente.update({
        nombre_perfil_whatsapp: profileName || cliente.nombre_perfil_whatsapp,
        ultima_interaccion: new Date(),
        veces_interactuado: cliente.veces_interactuado + 1
      });
    }

    console.log(`[WhatsApp] Cliente ${created ? 'creado' : 'actualizado'}: ${from}`);

    // ─── 3. Lógica de respuestas automáticas ─────────────────────────
    // Solo reaccionamos si el mensaje es exactamente un número (1, 2, 3...)
    if (!/^\d+$/.test(textBody)) {
      // Mensaje libre → no respondemos automáticamente (o podrías enviar un menú de ayuda)
      return;
    }

    // Buscamos la configuración QR del negocio (tomamos la primera activa)
    const configQr = await ConfiguracionQR.findOne({
      where: {
        negocio_id: negocio.id,
        activo: true
      },
      order: [['created_at', 'ASC']]
    });

    if (!configQr || !configQr.mapeo_respuestas) {
      console.log('[WhatsApp] No hay mapeo de respuestas configurado');
      return;
    }

    const mapeo = typeof configQr.mapeo_respuestas === 'string'
      ? JSON.parse(configQr.mapeo_respuestas)
      : configQr.mapeo_respuestas;

    const respuesta = mapeo[textBody];

    if (!respuesta) {
      await enviarMensajeTexto(
        from,
        `Opción no reconocida. Por favor elige un número del menú.`
      );
      return;
    }

    // Si la respuesta es una URL → enviamos con enlace
    if (typeof respuesta === 'string' && (respuesta.startsWith('http://') || respuesta.startsWith('https://'))) {
      await enviarMensajeConEnlace(
        from,
        `Aquí tienes la opción ${textBody}:`,
        respuesta
      );
    } else if (respuesta === 'humano') {
      await enviarMensajeTexto(
        from,
        `Un momento, te estamos conectando con el equipo de ${negocio.nombre_empresa}…`
      );
      // Aquí podrías notificar al negocio por email/Telegram, etc.
    } else {
      // Texto libre configurado
      await enviarMensajeTexto(from, String(respuesta));
    }

  } catch (error) {
    console.error('[WhatsApp Webhook] Error:', error);
  }
});

export default router;
