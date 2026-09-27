/**
 * Servicio de WhatsApp – MODO SIMULACIÓN (Fase 2)
 * No llama a la API real de Meta.
 * Solo registra en consola y devuelve un objeto mock.
 * Cuando tengas la Cloud API, sustituye el cuerpo de las funciones.
 */

/**
 * Simula el envío de un mensaje de texto.
 * @param {string} to - Número internacional sin +
 * @param {string} text - Texto del mensaje
 */
export async function enviarMensajeTexto(to, text) {
  console.log('────────────────────────────────────────');
  console.log('[WhatsApp MOCK] → Enviando mensaje');
  console.log(`   Para:   ${to}`);
  console.log(`   Texto:  ${text}`);
  console.log('────────────────────────────────────────');

  return {
    mock: true,
    messaging_product: 'whatsapp',
    contacts: [{ input: to, wa_id: to }],
    messages: [{ id: `mock_${Date.now()}` }]
  };
}

/**
 * Simula el envío de un mensaje con enlace.
 * @param {string} to
 * @param {string} textoIntro
 * @param {string} url
 */
export async function enviarMensajeConEnlace(to, textoIntro, url) {
  const cuerpo = `${textoIntro}\n\n🔗 ${url}`;
  return enviarMensajeTexto(to, cuerpo);
}
