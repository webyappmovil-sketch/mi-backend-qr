/**
 * Envío de correos vía Brevo SMTP (Nodemailer)
 * Si SMTP no está configurado, imprime el email en consola (dev).
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

function crearTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass || pass.includes('xxxx') || pass.includes('tu_smtp')) {
    return null; // modo simulación
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

/**
 * Envío genérico (alertas, etc.)
 */
export async function enviarEmailGenerico({ to, subject, html, text }) {
  const from = process.env.EMAIL_FROM || 'noreply@qrsas.es';
  const transporter = crearTransporter();
  if (!transporter) {
    console.log('════════════════════════════════════════');
    console.log('[EMAIL GENÉRICO SIMULADO]');
    console.log(`  Para:   ${to}`);
    console.log(`  Asunto: ${subject}`);
    console.log('════════════════════════════════════════');
    return { simulated: true };
  }
  return transporter.sendMail({ from, to, subject, html, text: text || '' });
}

/**
 * Notificación al SuperAdmin: nuevo pedido de impresión
 */
export async function enviarEmailNotificacionAdmin(datosPedido) {
  const {
    pedidoId,
    nombreEmpresa,
    emailNegocio,
    tipoMaterial,
    direccionEnvio,
    nombreContacto,
    telefonoContacto,
    archivoQrUrl,
    qrId
  } = datosPedido;

  const precio = tipoMaterial === 'Vinilo' ? '20,00 €' : '10,00 €';
  const qrLink =
    archivoQrUrl ||
    (qrId ? `${process.env.APP_BASE_URL || 'http://localhost:3000'}/r/${qrId}` : 'No disponible');

  const to = process.env.ADMIN_EMAIL || 'admin@qrsas.es';
  const from = process.env.EMAIL_FROM || 'noreply@qrsas.es';
  const subject = `[QR SaaS] Nuevo pedido de impresión – ${nombreEmpresa} (${tipoMaterial})`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;padding:20px;">
  <h2 style="color:#0f172a;border-bottom:2px solid #16a34a;padding-bottom:8px;">
    🖨️ Nuevo Pedido de Impresión – Plan Starter
  </h2>
  <p><strong>Pedido ID:</strong> ${pedidoId}</p>
  <p><strong>Negocio:</strong> ${nombreEmpresa}</p>
  <p><strong>Email del negocio:</strong> ${emailNegocio}</p>
  <h3 style="margin-top:24px;">Detalles</h3>
  <ul>
    <li><strong>Material:</strong> ${tipoMaterial} (${precio})</li>
    <li><strong>Estado:</strong> Pendiente de envío a imprenta</li>
  </ul>
  <h3 style="margin-top:24px;">Dirección de envío</h3>
  <p style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-line;">${direccionEnvio || '—'}</p>
  <p><strong>Contacto:</strong> ${nombreContacto || '—'} · ${telefonoContacto || '—'}</p>
  <h3 style="margin-top:24px;">Archivo / URL del QR</h3>
  <p><a href="${qrLink}" style="color:#16a34a;">${qrLink}</a></p>
  <p style="margin-top:32px;font-size:0.85rem;color:#64748b;">
    Generado automáticamente por QR SaaS. El negocio ya está <strong>Activo</strong>; solo falta enviar la impresión física.
  </p>
</body>
</html>`;

  const text = `
Nuevo pedido de impresión – ${nombreEmpresa}
Pedido: ${pedidoId}
Material: ${tipoMaterial} (${precio})
Dirección: ${direccionEnvio}
Contacto: ${nombreContacto} ${telefonoContacto}
QR: ${qrLink}
`;

  const transporter = crearTransporter();

  if (!transporter) {
    console.log('════════════════════════════════════════');
    console.log('[EMAIL SIMULADO – configura SMTP_HOST/USER/PASS en .env]');
    console.log(`  Para:    ${to}`);
    console.log(`  Asunto:  ${subject}`);
    console.log(`  Negocio: ${nombreEmpresa}`);
    console.log(`  Material:${tipoMaterial}`);
    console.log(`  Dirección: ${direccionEnvio}`);
    console.log(`  QR:      ${qrLink}`);
    console.log('════════════════════════════════════════');
    return { simulated: true, messageId: 'sim_' + Date.now() };
  }

  const info = await transporter.sendMail({ from, to, subject, html, text });
  console.log(`[EMAIL] Enviado a ${to}. MessageId: ${info.messageId}`);
  return info;
}

/**
 * Email de bienvenida al dueño del negocio tras registro gratuito (Plan Starter)
 */
export async function enviarEmailBienvenida(datos) {
  const {
    nombreEmpresa,
    email,
    telefonoWhatsapp
  } = datos;

  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
  const loginUrl = `${baseUrl}/login.html`;
  const to = email;
  const from = process.env.EMAIL_FROM || 'noreply@qrsas.es';
  const subject = `¡Bienvenido a QR SaaS, ${nombreEmpresa}! Activa tu código en minutos`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:linear-gradient(135deg,#16a34a,#15803d);padding:28px 32px;text-align:center;">
            <div style="display:inline-block;width:40px;height:40px;background:#fff;border-radius:10px;line-height:40px;font-weight:800;color:#16a34a;font-size:20px;">Q</div>
            <h1 style="color:#ffffff;font-size:22px;margin:12px 0 0;font-weight:800;">¡Bienvenido a QR SaaS!</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px;color:#1e293b;">
            <p style="font-size:16px;margin:0 0 16px;">Hola, <strong>${nombreEmpresa}</strong> 👋</p>
            <p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px;">
              Tu cuenta <strong>Plan Starter</strong> (0 €/mes) ya está creada. Tienes escaneos ilimitados y un menú de opciones en WhatsApp listo para configurar.
            </p>
            <p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 8px;"><strong>Cómo activar tu QR:</strong></p>
            <ol style="font-size:14px;line-height:1.7;color:#475569;padding-left:20px;margin:0 0 20px;">
              <li>Entra en tu panel con el email <strong>${email}</strong></li>
              <li>Configura el mensaje de bienvenida y las opciones (carta, Wi‑Fi, ofertas…)</li>
              <li>Activa la cuenta con el pack de impresión:
                <strong>Papel 10 €</strong> o <strong>Vinilo 20 €</strong> (pago único)</li>
              <li>En cuanto pagues, tu QR digital queda activo al instante; nosotros enviamos la impresión física a tu dirección</li>
            </ol>
            <p style="text-align:center;margin:28px 0;">
              <a href="${loginUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;">
                Entrar a mi panel
              </a>
            </p>
            <p style="font-size:13px;color:#94a3b8;margin:0;">
              WhatsApp registrado: ${telefonoWhatsapp || '—'}<br>
              Si no has sido tú quien se ha registrado, ignora este correo.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:16px 28px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;">
            QR SaaS · España · Software independiente, no afiliado a WhatsApp ni Meta
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `
¡Bienvenido a QR SaaS, ${nombreEmpresa}!

Tu cuenta Plan Starter (0 €/mes) está creada.

Cómo activar tu QR:
1. Entra en ${loginUrl} con ${email}
2. Configura el mensaje y las opciones
3. Activa con pack de impresión: Papel 10 € o Vinilo 20 € (pago único)
4. El QR digital se activa al pagar; enviamos la impresión a tu dirección

WhatsApp: ${telefonoWhatsapp || '—'}
`;

  const transporter = crearTransporter();

  if (!transporter) {
    console.log('════════════════════════════════════════');
    console.log('[EMAIL BIENVENIDA SIMULADO]');
    console.log(`  Para:    ${to}`);
    console.log(`  Asunto:  ${subject}`);
    console.log(`  Negocio: ${nombreEmpresa}`);
    console.log(`  Panel:   ${loginUrl}`);
    console.log('════════════════════════════════════════');
    return { simulated: true, messageId: 'welcome_sim_' + Date.now() };
  }

  const info = await transporter.sendMail({ from, to, subject, html, text });
  console.log(`[EMAIL] Bienvenida enviada a ${to}. MessageId: ${info.messageId}`);
  return info;
}

export async function verificarConexionEmail() {
  const transporter = crearTransporter();
  if (!transporter) {
    console.warn('⚠️  SMTP no configurado – emails en modo simulación');
    return false;
  }
  try {
    await transporter.verify();
    console.log('✅ Conexión SMTP (Brevo) OK');
    return true;
  } catch (err) {
    console.warn('⚠️  SMTP error:', err.message);
    return false;
  }
}
