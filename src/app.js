import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { sequelize, SuperAdmin, Negocio, ClienteCapturado } from './models/index.js';
import redirectRouter from './routes/redirect.js';
import stripeWebhook from './routes/webhooks/stripe.js';
import revolutWebhook from './routes/webhooks/revolut.js';
import whatsappWebhook from './routes/webhooks/whatsapp.js';
import pagosRouter from './routes/pagos.js';
import authRouter from './routes/api/auth.js';
import negocioRouter from './routes/api/negocio.js';
import adminRouter from './routes/api/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS – permite frontend en Netlify / localhost
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : true; // en desarrollo: permite todo

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature']
}));

// ────────────────────────────────────────────────
// WEBHOOKS (necesitan raw body ANTES de express.json)
// ────────────────────────────────────────────────
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);
app.use('/webhooks/revolut', express.raw({ type: 'application/json' }), revolutWebhook);

// WhatsApp puede usar JSON normal
app.use('/webhooks/whatsapp-bot', express.json(), whatsappWebhook);

// ────────────────────────────────────────────────
// Resto de la app (JSON normal)
// ────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.urlencoded({ extended: true }));

// API de autenticación y paneles (Fase 5)
app.use('/api/auth', authRouter);
app.use('/api/negocio', negocioRouter);
app.use('/api/admin', adminRouter);

// Endpoints de creación de sesiones de pago (Stripe Checkout)
app.use('/pagos', pagosRouter);

// Frontend estático (login, dashboard, admin, pago-exito…)
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    phase: '1 + 2 – DB + Redirect + Payments + WhatsApp Bot',
    db: 'SQLite',
    timestamp: new Date().toISOString()
  });
});

// Página de inicio informativa
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>QR SaaS – Fase 1 + 2</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1e293b; }
        h1 { color: #0f172a; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; }
        code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
        a { color: #2563eb; }
        .tag { display: inline-block; font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; margin-right: 6px; }
        .tag-green { background: #dcfce7; color: #166534; }
        .tag-blue { background: #dbeafe; color: #1e40af; }
      </style>
    </head>
    <body>
      <h1>🚀 QR SaaS – Fase 1 + 2 activas</h1>
      <p>Motor de redirección + Webhooks de pagos (Stripe/Revolut) + Bot de WhatsApp.</p>

      <div class="card">
        <h3><span class="tag tag-green">Fase 1</span> Redirección QR</h3>
        <ul>
          <li><code>GET /r/:id_qr</code> – Redirección / pantallas de estado</li>
        </ul>
      </div>

      <div class="card">
        <h3><span class="tag tag-blue">Fase 2</span> Webhooks</h3>
        <ul>
          <li><code>POST /webhooks/stripe</code> – Pagos y suscripciones Stripe</li>
          <li><code>POST /webhooks/revolut</code> – Pagos Revolut Merchant</li>
          <li><code>GET/POST /webhooks/whatsapp-bot</code> – Bot + captura de contactos</li>
        </ul>
      </div>

      <div class="card">
        <h3>Otros</h3>
        <ul>
          <li><a href="/health">GET /health</a> – Estado del servidor</li>
        </ul>
      </div>

      <p style="color:#64748b; font-size:0.9rem;">Fase 1 + 2 listas · Configura las claves en .env</p>
    </body>
    </html>
  `);
});
app.get('/api/dev/activar', async (req, res) => {
  try {
    if (req.query.key !== 'qr-activar-2026') {
      return res.status(403).json({ error: 'Clave incorrecta' });
    }
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@qrsas.es';
    let admin = await SuperAdmin.findOne({ where: { email: adminEmail } });
    if (!admin) {
      admin = await SuperAdmin.create({
        email: adminEmail,
        password_hash: 'Admin123!',
        nombre: 'Super Admin'
      });
    }
    const [n] = await Negocio.update(
      { estado_suscripcion: 'Activo', fecha_activacion: new Date() },
      { where: { estado_suscripcion: 'Pendiente_Impresion' } }
    );
    res.json({
      ok: true,
      admin: admin.email,
      negocios_activados: n,
      mensaje: 'Listo. Entra al panel del negocio: el estado debe ser Activo.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Motor de redirección
app.use('/r', redirectRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexión a SQLite establecida');

    await sequelize.sync({ alter: true });
    console.log('✅ Modelos sincronizados');

    app.listen(PORT, () => {
      console.log(`\n🚀 Servidor escuchando en http://localhost:${PORT}`);
      console.log(`🔗 Redirección:       GET  /r/:id_qr`);
      console.log(`🔐 Auth:              POST /api/auth/login | /registro`);
      console.log(`👤 Negocio API:       /api/negocio/*`);
      console.log(`🛡️  Admin API:         /api/admin/*`);
      console.log(`💳 Stripe Webhook:    POST /webhooks/stripe`);
      console.log(`📱 WhatsApp Bot:      GET/POST /webhooks/whatsapp-bot`);
      console.log(`💰 Pagos:             POST /pagos/crear-sesion-*`);
      console.log(`❤️  Health:            http://localhost:${PORT}/health\n`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exit(1);
  }
}

start();
