/**
 * Pruebas de: planes y límites, tipos de QR, ruleta (topes, periodos, concurrencia),
 * canje, "avísame" y prueba gratuita de 60 días.
 *
 *   node scripts/test-ruleta.js
 *
 * Arranca su propio servidor con una base de datos temporal. Solo para uso local.
 */
import { spawn } from 'child_process';
import http from 'http';
import { rmSync } from 'fs';

const PORT = 3300;
const BASE = `http://localhost:${PORT}`;
const DB = `/tmp/test-ruleta-${Date.now()}.sqlite`;
const ENV = {
  ...process.env, PORT: String(PORT), DB_STORAGE: DB, JWT_SECRET: 'test-secret-local-test-secret-local-1234',
  PUBLICO_MAX_POR_MINUTO: '1000', NODE_ENV: 'test',
  STRIPE_SECRET_KEY: 'sk_test_dummy_local', STRIPE_WEBHOOK_SECRET: 'whsec_test_local_secret',
  ADMIN_EMAIL: 'admin@test.es', AVISOS_EMAIL: 'avisos@test.es',
  BREVO_API_KEY: 'xkeysib-test', BREVO_API_URL: 'http://localhost:3398/v3/smtp/email', BREVO_SENDER_EMAIL: 'envios@test.es',
  CALLMEBOT_URL: 'http://localhost:3399/whatsapp.php', CALLMEBOT_PHONE: '+34600000000', CALLMEBOT_APIKEY: '123456'
};
delete ENV.DATABASE_URL; delete ENV.RENDER;
// Para probar contra PostgreSQL local: TEST_DATABASE_URL=postgres://… node scripts/test-ruleta.js
if (process.env.TEST_DATABASE_URL) { ENV.DATABASE_URL = process.env.TEST_DATABASE_URL; ENV.DB_SSL = 'false'; }
Object.assign(process.env, ENV);

let ok = 0, fallos = 0;
function check(nombre, cond, extra = '') {
  if (cond) { ok++; console.log(`  ✅ ${nombre}`); }
  else { fallos++; console.log(`  ❌ ${nombre} ${extra}`); }
}
const titulo = t => console.log(`\n── ${t}`);

async function api(path, { method = 'GET', body, token, manual, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method, redirect: manual ? 'manual' : 'follow',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.clone().json(); } catch { /* html */ }
  return { status: res.status, json, headers: res.headers };
}

async function registrar(nombre, plan) {
  const email = `${nombre.toLowerCase().replace(/\W/g, '')}-${Date.now()}@test.es`;
  const r = await api('/api/auth/registro', {
    method: 'POST',
    body: { nombre_empresa: nombre, email, password: 'clave-segura-123', telefono_whatsapp: '34600111222', plan }
  });
  return { token: r.json.token, id: r.json.user.id, qrId: r.json.user.qrId || r.json.qrId, email, raw: r };
}

// Servidor falso que hace de CallMeBot y apunta los avisos de WhatsApp que recibe
const avisos = [];
const mock = http.createServer((req, res) => { avisos.push(new URL(req.url, 'http://x').searchParams.get('text')); res.end('ok'); }).listen(3399);

// Servidor falso que hace de la API de Brevo y apunta los correos que recibe
const correos = [];
const mockBrevo = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => { correos.push({ clave: req.headers['api-key'], metodo: req.method, ...JSON.parse(body || '{}') }); res.statusCode = 201; res.end('{"messageId":"<test@brevo>"}'); });
}).listen(3398);

const server = spawn('node', ['src/app.js'], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
let salida = '';
server.stdout.on('data', d => { salida += d; });
server.stderr.on('data', d => { salida += d; });

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch { /* aún no */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('El servidor no arrancó:\n' + salida);
}

try {
  await esperarServidor();
  const { sequelize, Negocio, ConfiguracionQR, Participacion } = await import('../src/models/index.js');
  const { enviarAvisosPrueba } = await import('../src/services/pruebaGratuita.js');
  const { normalizarMovil } = await import('../src/services/ruleta.js');
  const DIA = 86400000;
  // Sequelize ignora los cambios sobre created_at: para "viajar en el tiempo" usamos SQL directo
  const fechaSql = d => new Date(d).toISOString().replace('T', ' ').replace('Z', ' +00:00');
  const retrasar = (id, ms) => sequelize.query('UPDATE participaciones SET created_at = ? WHERE id = ?', { replacements: [fechaSql(Date.now() - ms), id] });

  /* ───────────── Plan gratuito ───────────── */
  titulo('Plan gratuito: registro y límites');
  const A = await registrar('Bar Gratis', 'Starter');
  const nA = await Negocio.findByPk(A.id);
  check('El plan gratuito queda ACTIVO al registrarse', nA.estado_suscripcion === 'Activo');
  const dias = Math.round((new Date(nA.prueba_fin) - Date.now()) / DIA);
  check('La prueba dura 60 días', dias === 60, `(son ${dias})`);

  let r = await api('/api/negocio/qrs', { token: A.token });
  check('Muestra 1 QR de 1 permitido', r.json.plan.qr_usados === 1 && r.json.plan.max_qr === 1 && r.json.plan.nombre_plan === 'Gratuito');
  const qrDefecto = r.json.qrs[0];

  r = await api('/api/negocio/qrs', { method: 'POST', token: A.token, body: { tipo_destino: 'Enlace', url_destino: 'https://carta.test' } });
  check('No puede crear un 2º QR (límite 1)', r.status === 403 && r.json.codigo === 'limite');
  r = await api('/api/negocio/qrs', { method: 'POST', token: A.token, body: { tipo_destino: 'Ruleta' } });
  check('No puede crear Ruleta en el plan gratuito', r.status === 403 && r.json.codigo === 'plan');
  r = await api('/api/negocio/qrs', { method: 'POST', token: A.token, body: { tipo_destino: 'Texto', datos: { titulo: 'x', items: [{ etiqueta: 'a', valor: 'b' }] } } });
  check('No puede crear Texto en el plan gratuito', r.status === 403);

  titulo('Enlace directo: 302 y cambio de destino');
  r = await api(`/api/negocio/qrs/${qrDefecto.id}`, { method: 'DELETE', token: A.token });
  check('Elimina el QR por defecto', r.status === 200);
  r = await api('/api/negocio/qrs', { method: 'POST', token: A.token, body: { tipo_destino: 'Enlace', url_destino: 'javascript:alert(1)' } });
  check('Rechaza URL peligrosa (javascript:)', r.status === 400);
  r = await api('/api/negocio/qrs', { method: 'POST', token: A.token, body: { tipo_destino: 'Enlace', nombre: 'Carta', url_destino: 'https://carta.test/v1' } });
  check('Crea QR de tipo Enlace', r.status === 201);
  const qrEnlace = r.json.qr.id;
  r = await api(`/r/${qrEnlace}`, { manual: true, headers: { 'User-Agent': 'Mozilla/5.0 movil-A' } });
  check('Escaneo → redirección 302 (no 301)', r.status === 302 && r.headers.get('location') === 'https://carta.test/v1');
  check('Sin caché en el navegador', (r.headers.get('cache-control') || '').includes('no-store'));
  await api(`/api/negocio/qrs/${qrEnlace}`, { method: 'PUT', token: A.token, body: { nombre: 'Carta', url_destino: 'https://carta.test/v2' } });
  r = await api(`/r/${qrEnlace}`, { manual: true, headers: { 'User-Agent': 'Mozilla/5.0 movil-B' } });
  check('El cambio de URL se aplica al instante', r.headers.get('location') === 'https://carta.test/v2');
  const cont = (await ConfiguracionQR.findByPk(qrEnlace)).contador_escaneos;
  check('Cuenta los escaneos', cont === 2, `(${cont})`);

  titulo('Escaneos reales (sin robots, precargas ni recargas)');
  const contador = async () => (await ConfiguracionQR.findByPk(qrEnlace)).contador_escaneos;
  const antesEsc = await contador();
  r = await api(`/r/${qrEnlace}`, { manual: true, headers: { 'User-Agent': 'WhatsApp/2.23.20 A' } });
  check('Vista previa de WhatsApp: sigue redirigiendo pero NO cuenta', r.status === 302 && (await contador()) === antesEsc);
  r = await api(`/r/${qrEnlace}`, { manual: true, headers: { 'User-Agent': 'Mozilla/5.0 movil-C', 'Sec-Purpose': 'prefetch' } });
  check('Precarga del navegador: NO cuenta', (await contador()) === antesEsc);
  await api(`/r/${qrEnlace}`, { manual: true, headers: { 'User-Agent': 'Mozilla/5.0 movil-C' } });
  await api(`/r/${qrEnlace}`, { manual: true, headers: { 'User-Agent': 'Mozilla/5.0 movil-C' } });
  await api(`/r/${qrEnlace}`, { manual: true, headers: { 'User-Agent': 'Mozilla/5.0 movil-C' } });
  check('Recargar 3 veces seguidas desde el mismo móvil cuenta como 1', (await contador()) === antesEsc + 1, `(${await contador()} vs ${antesEsc + 1})`);

  titulo('Fin de la prueba: cortesía y pausa');
  await nA.update({ prueba_fin: new Date(Date.now() - 3 * DIA) });
  r = await api(`/r/${qrEnlace}`, { manual: true });
  check('Día 63 (cortesía): el QR sigue funcionando', r.status === 302);
  await nA.update({ prueba_fin: new Date(Date.now() - 9 * DIA) });
  r = await api(`/r/${qrEnlace}`, { manual: true });
  check('Día 69 (pausa): muestra página de pausado, sin redirigir', r.status === 503);
  r = await api('/api/negocio/qrs', { method: 'POST', token: A.token, body: { tipo_destino: 'Enlace', url_destino: 'https://x.test' } });
  check('Pausado: no puede editar QR hasta mejorar el plan', r.status === 403);
  r = await api('/api/negocio/qrs', { token: A.token });
  check('Pausado: el panel sigue accesible para mejorar plan', r.status === 200 && r.json.plan.prueba.estado === 'pausada');
  await nA.update({ plan_actual: 'Pro', prueba_fin: null });
  r = await api(`/r/${qrEnlace}`, { manual: true });
  check('Al pasar a Pro el mismo QR vuelve a funcionar', r.status === 302);

  /* ───────────── Plan Pro ───────────── */
  titulo('Plan Pro: tipos y límite de 5 QR');
  const B = await registrar('Restaurante Pro', 'Pro');
  const nB = await Negocio.findByPk(B.id);
  check('Pro queda pendiente hasta pagar', nB.estado_suscripcion === 'Pendiente_Impresion' && nB.prueba_fin === null);
  await nB.update({ estado_suscripcion: 'Activo' });
  const crear = async body => (await api('/api/negocio/qrs', { method: 'POST', token: B.token, body }));

  r = await crear({ tipo_destino: 'Ruleta', datos: { ...(await api('/api/negocio/qrs', { token: B.token }), {}).json, premios: undefined } });
  check('Ruleta sin 6 casillas → error', r.status === 400);

  const premiosMal = Array.from({ length: 6 }, (_, i) => ({ texto: `P${i}`, probabilidad: 10, es_premio: true, tope_dia: 5 }));
  r = await crear({ tipo_destino: 'Ruleta', datos: { premios: premiosMal } });
  check('Probabilidades que no suman 100 → error claro', r.status === 400 && /100/.test(r.json.error), r.json?.error);

  const cero = Array.from({ length: 6 }, (_, i) => ({ texto: `P${i}`, probabilidad: i === 0 ? 100 : 0, es_premio: true, tope_dia: 5 }));
  r = await crear({ tipo_destino: 'Ruleta', datos: { premios: cero } });
  check('Un premio con probabilidad 0 se rechaza (sería engañoso)', r.status === 400);

  // Ruleta de prueba: 1 premio al 100 % con tope 3/día; el resto sin premio y 0 %
  const premiosTope = [
    { texto: 'Postre gratis', probabilidad: 100, es_premio: true, tope_dia: 3 },
    ...Array.from({ length: 5 }, (_, i) => ({ texto: `Sigue ${i}`, probabilidad: 0, es_premio: false }))
  ];
  r = await crear({ tipo_destino: 'Ruleta', nombre: 'Ventana', datos: { premios: premiosTope, periodo_dias: 7 } });
  check('Crea la ruleta (Pro)', r.status === 201, JSON.stringify(r.json));
  const qrRuleta = r.json.qr.id;

  r = await crear({ tipo_destino: 'Enlaces', nombre: 'Todo', datos: { titulo: 'Todo sobre el local', enlaces: [{ etiqueta: 'Carta', url: 'https://carta.test', icono: 'pdf' }] } });
  check('Crea página de enlaces', r.status === 201);
  const qrEnlaces = r.json.qr.id;
  r = await crear({ tipo_destino: 'Texto', nombre: 'Wifi', datos: { titulo: 'Wifi', items: [{ etiqueta: 'Red', valor: 'BARU' }, { etiqueta: 'Clave', valor: 'abc12345' }] } });
  check('Crea QR de texto/clave', r.status === 201);
  const qrTexto = r.json.qr.id;
  r = await crear({ tipo_destino: 'Enlace', url_destino: 'https://web.test' });
  check('Crea 4º QR', r.status === 201);
  r = await api('/api/negocio/qrs', { token: B.token });
  check('Cuenta 5 de 5 (incluye el QR por defecto)', r.json.plan.qr_usados === 5 && r.json.plan.max_qr === 5, `(${r.json.plan.qr_usados})`);
  r = await crear({ tipo_destino: 'Enlace', url_destino: 'https://otro.test' });
  check('El 6º QR se rechaza (límite Pro)', r.status === 403 && r.json.codigo === 'limite');

  titulo('Páginas públicas');
  r = await api(`/api/publico/qr/${qrRuleta}`);
  check('Ruleta pública: 6 casillas', r.json.estado === 'ok' && r.json.ruleta.casillas.length === 6);
  check('No filtra probabilidades ni topes', !JSON.stringify(r.json).includes('probabilidad') && !JSON.stringify(r.json).includes('tope'));
  check('Incluye el texto de consentimiento del negocio', /Restaurante Pro/.test(r.json.texto_consentimiento));
  check('Aún quedan premios hoy', r.json.ruleta.premios_agotados === false);
  r = await api(`/api/publico/qr/${qrTexto}`);
  check('Texto/clave pública con 2 datos', r.json.items?.length === 2);
  r = await api(`/api/publico/qr/${qrEnlaces}`);
  check('Página de enlaces pública', r.json.enlaces?.length === 1);
  r = await api(`/r/${qrRuleta}`, { manual: true });
  check('Escanear la ruleta sirve la página (200)', r.status === 200);

  /* ───────────── Ruleta ───────────── */
  titulo('Ruleta: validación del formulario');
  const jugar = (tel, extra = {}) => api(`/api/publico/qr/${qrRuleta}/jugar`, {
    method: 'POST', body: { nombre: 'Ana', apellido: 'López', telefono: tel, consentimiento: true, ...extra }
  });
  r = await jugar('612345678', { consentimiento: false });
  check('Sin aceptar la casilla → no juega', r.status === 400);
  r = await jugar('123');
  check('Teléfono inválido → error', r.status === 400);
  r = await jugar('612345678', { nombre: '' });
  check('Sin nombre → error', r.status === 400);
  check('Normaliza +34 y espacios', normalizarMovil('+34 612 34 56 78') === '34612345678' && normalizarMovil('0034612345678') === '34612345678');
  check('Rechaza fijos y extranjeros', normalizarMovil('912345678') === null && normalizarMovil('+44 7911 123456') === null);

  titulo('Ruleta: una jugada, periodo y canje');
  r = await jugar('612345678');
  check('Gana (probabilidad 100 %) con código', r.json.resultado === 'gana' && /^REST-[A-Z0-9]{4}$/.test(r.json.codigo || ''), JSON.stringify(r.json));
  check('El premio vale solo hasta fin del día', r.json.valido_hasta && new Date(r.json.valido_hasta) > new Date() && new Date(r.json.valido_hasta) - Date.now() <= 25 * 3600 * 1000);
  const codigo1 = r.json.codigo;
  r = await jugar('612345678');
  check('Mismo móvil el mismo día → "ya jugó hoy"', r.json.resultado === 'ya_jugo_hoy');

  const p1 = await Participacion.findOne({ where: { qr_id: qrRuleta, telefono: '34612345678' } });
  check('Guarda consentimiento con fecha y texto', p1.consentimiento && p1.fecha_consentimiento && /Restaurante Pro/.test(p1.texto_consentimiento));
  await retrasar(p1.id, 1 * DIA);
  r = await jugar('612345678');
  check('Ganó ayer → no puede ganar hasta pasar la semana', r.json.resultado === 'ya_gano' && !!r.json.puede_volver_texto, JSON.stringify(r.json));
  await retrasar(p1.id, 8 * DIA);
  r = await jugar('612345678');
  check('Pasada la semana vuelve a poder jugar y ganar', r.json.resultado === 'gana');

  r = await api('/api/negocio/participaciones', { token: B.token });
  const filaGanada = r.json.participaciones.find(p => p.codigo === codigo1);
  check('El panel lista nombre, apellido, teléfono y premio', filaGanada && filaGanada.nombre === 'Ana' && filaGanada.telefono === '34612345678' && filaGanada.premio === 'Postre gratis');
  r = await api(`/api/negocio/participaciones/${filaGanada.id}/canjear`, { method: 'PUT', token: B.token });
  check('El dueño marca el premio como canjeado', r.status === 200);
  r = await api(`/api/negocio/participaciones/${filaGanada.id}/canjear`, { method: 'PUT', token: B.token });
  check('No se puede canjear dos veces', r.status === 409);

  titulo('Ruleta: 10 jugadores a la vez, tope de 3 premios al día');
  // Ya se entregaron 1 (hoy, el de la segunda victoria) → quedan 2 del tope de 3
  const antes = await Participacion.count({ where: { qr_id: qrRuleta, es_premio: true, created_at: { [(await import('sequelize')).Op.gte]: new Date(Date.now() - 20 * 3600 * 1000) } } });
  const resultados = await Promise.all(Array.from({ length: 10 }, (_, i) => jugar(`6000000${String(i).padStart(2, '0')}`)));
  const ganan = resultados.filter(x => x.json.resultado === 'gana').length;
  const agotados = resultados.filter(x => x.json.resultado === 'agotado').length;
  const hoyInicio = (await import('../src/services/planes.js')).inicioDiaMadrid();
  const entregadosHoy = await Participacion.count({ where: { qr_id: qrRuleta, es_premio: true, created_at: { [(await import('sequelize')).Op.gte]: hoyInicio } } });
  check('Nunca se superan los 3 premios del día', entregadosHoy <= 3, `(entregados hoy: ${entregadosHoy}, antes ${antes})`);
  check('Los premios de hoy se agotan exactamente en el tope', entregadosHoy === 3, `(entregados hoy: ${entregadosHoy})`);
  check('Quien llega tarde recibe "agotado" (no pierde sus datos jugando en vano)', ganan + agotados === 10 && agotados >= 7, `(ganan ${ganan}, agotado ${agotados})`);
  r = await api(`/api/publico/qr/${qrRuleta}`);
  check('La página avisa desde el principio: premios agotados', r.json.ruleta.premios_agotados === true);
  check('La casilla agotada se muestra como "Sigue probando"', r.json.ruleta.casillas[0].texto === 'Sigue probando');

  titulo('"Avísame" cuando no quedan premios');
  const avisar = (tel, extra = {}) => api(`/api/publico/qr/${qrRuleta}/avisame`, { method: 'POST', body: { nombre: 'Luis', telefono: tel, consentimiento: true, ...extra } });
  r = await avisar('699111222', { consentimiento: false });
  check('Sin consentimiento no se guarda', r.status === 400);
  r = await avisar('699111222');
  check('Guarda el contacto con consentimiento', r.status === 200 && r.json.ok);
  r = await avisar('699111222');
  check('No duplica el mismo móvil', r.json.repetido === true);
  r = await api('/api/negocio/participaciones', { token: B.token });
  check('Aparece en el panel como Aviso', r.json.participaciones.some(p => p.origen === 'Aviso' && p.telefono === '34699111222'));

  titulo('Aislamiento entre negocios');
  r = await api('/api/negocio/participaciones', { token: A.token });
  check('Otro negocio no ve estos participantes', r.json.participaciones.length === 0);
  r = await api(`/api/negocio/participaciones/${filaGanada.id}/canjear`, { method: 'PUT', token: A.token });
  check('Otro negocio no puede canjear premios ajenos', r.status === 404);
  r = await api(`/api/negocio/qrs/${qrRuleta}`, { method: 'PUT', token: A.token, body: { nombre: 'hack' } });
  check('Otro negocio no puede editar mis QR', r.status === 404);

  titulo('Métricas: clientes capturados y escaneos');
  const { Op: OpM } = await import('sequelize');
  const telsB = new Set((await Participacion.findAll({ where: { negocio_id: B.id }, attributes: ['telefono'], raw: true })).map(x => x.telefono));
  r = await api('/api/negocio/metricas', { token: B.token });
  check('"Clientes capturados" incluye a quien rellenó el formulario (sin duplicar móviles)', r.json.total_clientes === telsB.size && r.json.total_clientes >= 2, `(${r.json.total_clientes} vs ${telsB.size})`);
  const sumaB = (await ConfiguracionQR.findAll({ where: { negocio_id: B.id }, raw: true })).reduce((a, q) => a + q.contador_escaneos, 0);
  check('"Total de escaneos" suma todos los QR del negocio', r.json.total_escaneos === sumaB, `(${r.json.total_escaneos} vs ${sumaB})`);

  titulo('Pagos: webhook de Stripe firmado, registro y aviso por WhatsApp');
  const Stripe = (await import('stripe')).default;
  const { procesarSesionSuscripcion } = await import('../src/services/pagos.js');
  const { Pago } = await import('../src/models/index.js');
  const U = await registrar('Bar Mejora', 'Starter');
  const nU = await Negocio.findByPk(U.id);
  check('Parte del plan gratuito, activo y con prueba', nU.plan_actual === 'Starter' && nU.estado_suscripcion === 'Activo' && !!nU.prueba_fin);

  const aleat = () => Math.random().toString(36).slice(2);
  const sesion = (extra = {}) => ({ id: 'cs_test_' + aleat(), object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'paid',
    amount_total: 1999, currency: 'eur', invoice: 'in_test_1', customer_email: U.email,
    customer_details: { name: 'Juan Pérez', email: U.email, phone: null }, metadata: { negocio_id: U.id, plan: 'Pro', tipo: 'suscripcion' }, ...extra });
  const evento = (type, obj) => JSON.stringify({ id: 'evt_' + aleat(), object: 'event', type, data: { object: obj } });
  const enviar = (payload, secret = ENV.STRIPE_WEBHOOK_SECRET) => fetch(BASE + '/webhooks/stripe', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload });

  const evPago = evento('checkout.session.completed', sesion());
  r = await enviar(evPago, 'whsec_secreto_falso');
  check('Evento con firma falsa → rechazado (400)', r.status === 400);
  await nU.reload();
  check('…y el plan NO cambia ni se avisa a nadie', nU.plan_actual === 'Starter' && avisos.length === 0);

  r = await enviar(evPago);
  check('Evento con firma correcta → aceptado', r.status === 200);
  await nU.reload();
  check('Tras pagar pasa a Pro, activo y sin caducidad de prueba', nU.plan_actual === 'Pro' && nU.estado_suscripcion === 'Activo' && nU.prueba_fin === null, `(${nU.plan_actual}/${nU.estado_suscripcion}/${nU.prueba_fin})`);
  check('Se registra el pago (19,99 €)', (await Pago.count({ where: { negocio_id: U.id } })) === 1 && (await Pago.findOne({ where: { negocio_id: U.id } })).importe_centimos === 1999);
  check('Llega UN aviso por WhatsApp con negocio, plan, importe y contacto', avisos.length === 1 && /Bar Mejora/.test(avisos[0]) && /Pro/.test(avisos[0]) && /19,99/.test(avisos[0]) && /Juan Pérez/.test(avisos[0]), JSON.stringify(avisos));
  check('El aviso incluye el email y el vendedor', avisos[0].includes(U.email) && /Directo/.test(avisos[0]));
  await new Promise(res => setTimeout(res, 400));
  const correoPago = correos.find(c => /Pago recibido/.test(c.subject || ''));
  check('El aviso por email sale por la API web de Brevo (no por SMTP)', !!correoPago && correoPago.metodo === 'POST' && correoPago.clave === 'xkeysib-test');
  check('Va a AVISOS_EMAIL, con el remitente configurado, y NO al correo de login del admin', correoPago?.to?.[0]?.email === 'avisos@test.es' && correoPago.sender.email === 'envios@test.es' && !correos.some(c => c.to?.some(t => t.email === 'admin@test.es')), JSON.stringify(correoPago));
  check('El correo trae el detalle del pago (negocio, importe, contacto)', /Bar Mejora/.test(correoPago?.textContent || '') && /19,99/.test(correoPago.textContent) && /Juan Pérez/.test(correoPago.textContent));

  await enviar(evPago);
  check('Si Stripe reenvía el mismo evento NO se duplica el pago ni el aviso', avisos.length === 1 && (await Pago.count({ where: { negocio_id: U.id } })) === 1);
  await enviar(evento('invoice.payment_succeeded', { id: 'in_test_1', amount_paid: 1999, currency: 'eur', billing_reason: 'subscription_create', customer_email: U.email,
    subscription_details: { metadata: { negocio_id: U.id, plan: 'Pro', tipo: 'suscripcion' } } }));
  check('La factura del mismo cobro (otro evento) tampoco duplica', avisos.length === 1 && (await Pago.count({ where: { negocio_id: U.id } })) === 1);

  await enviar(evento('invoice.payment_succeeded', { id: 'in_test_2', amount_paid: 1999, currency: 'eur', billing_reason: 'subscription_cycle', customer_email: U.email,
    subscription_details: { metadata: { negocio_id: U.id, plan: 'Pro', tipo: 'suscripcion' } } }));
  check('Una renovación mensual sí genera un aviso nuevo, marcado como renovación', avisos.length === 2 && /Renovación/.test(avisos[1]), JSON.stringify(avisos[1]));

  await enviar(evento('checkout.session.completed', { id: 'cs_test_imp1', object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 2000, currency: 'eur',
    customer_email: U.email, metadata: { tipo: 'impresion', negocio_id: U.id, tipo_material: 'Vinilo', nombre_contacto: 'María Gil', telefono_contacto: '611222333', direccion_envio: 'Calle Sol 1, Madrid' } }));
  check('Un pago de impresión avisa con material, importe y datos de contacto', avisos.length === 3 && /Impresión Vinilo/.test(avisos[2]) && /20,00/.test(avisos[2]) && /María Gil/.test(avisos[2]) && /611222333/.test(avisos[2]), JSON.stringify(avisos[2]));

  titulo('Activación desde la página de pago correcto (sin depender del webhook)');
  const U2 = await registrar('Bar Fallback', 'Starter');
  const s2 = sesion({ id: 'cs_test_fb1', invoice: 'in_test_9', amount_total: 2999, customer_email: U2.email, customer_details: { name: 'Eva Ruiz', email: U2.email }, metadata: { negocio_id: U2.id, plan: 'Business', tipo: 'suscripcion' } });
  const antesAv = avisos.length;
  let rr = await procesarSesionSuscripcion(s2);
  const nU2 = await Negocio.findByPk(U2.id);
  check('Un pago cobrado activa el plan Business aunque el webhook no llegue', rr.ok && nU2.plan_actual === 'Business' && nU2.estado_suscripcion === 'Activo' && nU2.prueba_fin === null);
  check('…y avisa una vez con el importe de 29,99 €', avisos.length === antesAv + 1 && /29,99/.test(avisos[antesAv]) && /Business/.test(avisos[antesAv]));
  await procesarSesionSuscripcion(s2);
  check('Repetirlo (webhook + página de éxito) no duplica el aviso', avisos.length === antesAv + 1);
  const U3 = await registrar('Bar Sin Pagar', 'Starter');
  rr = await procesarSesionSuscripcion(sesion({ id: 'cs_test_np', invoice: null, payment_status: 'unpaid', metadata: { negocio_id: U3.id, plan: 'Pro', tipo: 'suscripcion' } }));
  const nU3 = await Negocio.findByPk(U3.id);
  check('Una sesión NO pagada no cambia el plan ni avisa', !rr.ok && nU3.plan_actual === 'Starter' && avisos.length === antesAv + 1);
  r = await api('/api/negocio/qrs', { token: U.token });
  check('El panel ya muestra Pro con 5 QR y todos los tipos', r.json.plan.max_qr === 5 && r.json.plan.tipos_permitidos.includes('Ruleta'));
  r = await api('/health');
  check('/health informa de la versión', /^\d+\.\d+\.\d+$/.test(r.json.version), JSON.stringify(r.json));

  titulo('Panel admin: pestaña Pagos');
  const { SuperAdmin, PedidoImpresion } = await import('../src/models/index.js');
  const { importarPagosAntiguos } = await import('../src/services/pagos.js');
  await SuperAdmin.create({ email: 'admin@test.es', password_hash: 'clave-admin-123456', nombre: 'Admin' });
  r = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.es', password: 'clave-admin-123456' } });
  const adminToken = r.json?.token;
  check('El admin puede entrar con su correo de login', !!adminToken && r.json.user.role === 'admin', JSON.stringify(r.json));
  r = await api('/api/admin/pagos');
  check('Sin sesión no se ven los pagos (401)', r.status === 401);
  r = await api('/api/admin/pagos', { token: B.token });
  check('Un negocio NO puede ver los pagos (403)', r.status === 403);
  r = await api('/api/admin/pagos', { token: adminToken });
  check('El admin ve los pagos', r.status === 200 && Array.isArray(r.json.pagos));
  const res1 = r.json.resumen;
  check('Total cobrado = suma real de los 4 pagos (89,97 €)', res1.total_centimos === 1999 + 1999 + 2000 + 2999 && res1.num_pagos === 4, JSON.stringify(res1));
  check('Lo cobrado hoy cuenta como "este mes"', res1.mes_centimos === res1.total_centimos);
  check('Desglose por tipo correcto', res1.por_tipo.Suscripcion === 4998 && res1.por_tipo.Renovacion === 1999 && res1.por_tipo.Impresion === 2000, JSON.stringify(res1.por_tipo));
  const pImp = r.json.pagos.find(x => x.tipo === 'Impresion');
  check('Cada pago trae negocio, concepto y datos de contacto', pImp.negocio === 'Bar Mejora' && pImp.material === 'Vinilo' && pImp.pagador_nombre === 'María Gil' && pImp.pagador_telefono === '611222333');
  check('Los más recientes salen primero', new Date(r.json.pagos[0].fecha) >= new Date(r.json.pagos[r.json.pagos.length - 1].fecha));

  titulo('Importación de pedidos de impresión antiguos (sin duplicar)');
  const pagosAntes = await Pago.count();
  const ped = await PedidoImpresion.create({ negocio_id: B.id, tipo_material: 'Papel', direccion_envio_completa: 'Calle Vieja 1, Madrid', nombre_contacto: 'Cliente Antiguo', telefono_contacto: '600123123', estado: 'Pendiente' });
  await sequelize.query(`UPDATE ${PedidoImpresion.getTableName()} SET created_at = ? WHERE id = ?`, { replacements: [fechaSql(Date.now() - 40 * DIA), ped.id] });
  const n1 = await importarPagosAntiguos();
  check('Importa SOLO el pedido antiguo (los de pagos nuevos ya tienen su pago)', n1 === 1 && (await Pago.count()) === pagosAntes + 1, `(importados ${n1})`);
  const pAnt = await Pago.findOne({ where: { referencia: `pedido-${ped.id}` } });
  check('Lo importado vale 10,00 € (Papel), con su contacto y SU fecha original', pAnt.importe_centimos === 1000 && pAnt.pagador_nombre === 'Cliente Antiguo' && Math.abs(new Date(pAnt.created_at) - (Date.now() - 40 * DIA)) < 3600 * 1000, `(${pAnt.created_at})`);
  check('Repetir la importación no duplica nada', (await importarPagosAntiguos()) === 0 && (await Pago.count()) === pagosAntes + 1);
  r = await api('/api/admin/pagos', { token: adminToken });
  check('El pago antiguo suma al total pero NO al mes en curso', r.json.resumen.total_centimos === res1.total_centimos + 1000 && r.json.resumen.mes_centimos === res1.mes_centimos);

  titulo('Canje en una hora, enlaces vacíos y métricas del día/mes');
  const { validarDatosRuleta, datosRuletaPorDefecto, validarDatosEnlaces } = await import('../src/services/ruleta.js');
  const { Escaneo } = await import('../src/models/index.js');
  check('Por defecto el premio vale "solo el día en que se gana"', validarDatosRuleta(datosRuletaPorDefecto()).datos.validez === 'dia');
  await api(`/api/negocio/qrs/${qrEnlaces}`, { method: 'DELETE', token: B.token });
  const premiosHora = [{ texto: 'Café gratis', probabilidad: 100, es_premio: true, tope_dia: 50 }, ...Array.from({ length: 5 }, (_, i) => ({ texto: `Nada ${i}`, probabilidad: 0, es_premio: false }))];
  r = await api('/api/negocio/qrs', { method: 'POST', token: B.token, body: { tipo_destino: 'Ruleta', nombre: 'Canje hora', datos: { premios: premiosHora, validez: 'hora', enlaces: [{ etiqueta: '', url: '', icono: 'web' }] } } });
  check('Se puede guardar la ruleta con una fila de enlace vacía (los enlaces son opcionales)', r.status === 201 && r.json.qr.datos.enlaces.length === 0, JSON.stringify(r.json));
  check('La opción "canjear en una hora" se guarda', r.json.qr.datos.validez === 'hora');
  const qrHora = r.json.qr.id;
  r = await api(`/api/negocio/qrs/${qrHora}`, { method: 'PUT', token: B.token, body: { nombre: 'Canje hora', datos: { premios: premiosHora, validez: 'hora', enlaces: [{ etiqueta: 'Carta', url: '' }] } } });
  check('Una fila a medias (nombre sin dirección) sí avisa', r.status === 400 && /dirección válida/.test(r.json.error), r.json?.error);
  r = await api(`/api/negocio/qrs/${qrHora}`, { method: 'PUT', token: B.token, body: { nombre: 'Canje hora', datos: { premios: premiosHora, validez: 'hora', enlaces: [{ etiqueta: '', url: 'https://x.test' }] } } });
  check('…y una dirección sin nombre también', r.status === 400 && /nombre/.test(r.json.error), r.json?.error);
  check('La página de enlaces SÍ necesita al menos un enlace', /al menos un enlace/.test(validarDatosEnlaces({ titulo: 'x', enlaces: [{ etiqueta: '', url: '' }] }).error || ''));

  r = await api(`/api/publico/qr/${qrHora}/jugar`, { method: 'POST', body: { nombre: 'Rosa', apellido: 'Gil', telefono: '622333444', consentimiento: true } });
  const minutos = (new Date(r.json.valido_hasta) - Date.now()) / 60000;
  check('Gana y el plazo es de una hora (no hasta fin de día)', r.json.resultado === 'gana' && r.json.validez === 'hora' && minutos > 58 && minutos <= 60.5, `(${minutos.toFixed(1)} min, ${JSON.stringify(r.json)})`);
  r = await api('/api/negocio/participaciones', { token: B.token });
  const filaHora = r.json.participaciones.find(x => x.telefono === '34622333444');
  check('Dentro de la hora el premio figura como Pendiente', filaHora.estado === 'Pendiente');
  await sequelize.query('UPDATE participaciones SET valido_hasta = ? WHERE id = ?', { replacements: [fechaSql(Date.now() - 60000), filaHora.id] });
  r = await api('/api/negocio/participaciones', { token: B.token });
  check('Pasada la hora figura como Caducado', r.json.participaciones.find(x => x.id === filaHora.id).estado === 'Caducado');
  r = await api(`/api/negocio/participaciones/${filaHora.id}/canjear`, { method: 'PUT', token: B.token });
  check('…y ya no se puede canjear', r.status === 409);

  r = await api('/api/negocio/metricas', { token: B.token });
  const hoy0 = r.json.escaneos_hoy, mes0 = r.json.escaneos_mes;
  const qrAny = (await ConfiguracionQR.findOne({ where: { negocio_id: B.id } })).id;
  await Escaneo.create({ qr_id: qrAny, negocio_id: B.id, user_agent: 't', scanned_at: new Date(Date.now() - 40 * DIA) });
  r = await api('/api/negocio/metricas', { token: B.token });
  check('Un escaneo de hace 40 días no cuenta ni en "hoy" ni en "este mes"', r.json.escaneos_hoy === hoy0 && r.json.escaneos_mes === mes0);
  await Escaneo.create({ qr_id: qrAny, negocio_id: B.id, user_agent: 't', scanned_at: new Date() });
  r = await api('/api/negocio/metricas', { token: B.token });
  check('Un escaneo de ahora suma 1 en "hoy" y 1 en "este mes"', r.json.escaneos_hoy === hoy0 + 1 && r.json.escaneos_mes === mes0 + 1);
  const telsB2 = new Set((await Participacion.findAll({ where: { negocio_id: B.id }, attributes: ['telefono'], raw: true })).map(x => x.telefono));
  check('"Clientes capturados" = personas que rellenaron el formulario', r.json.total_clientes === telsB2.size && telsB2.size >= 3, `(${r.json.total_clientes} vs ${telsB2.size})`);

  /* ───────────── Avisos de prueba ───────────── */
  titulo('Avisos de fin de prueba (día 45, 55 y 60)');
  const casos = [['Prueba D40', 20, null], ['Prueba D45', 14, 'd15'], ['Prueba D55', 4, 'd5'], ['Prueba D61', -1, 'd0']];
  const ids = {};
  for (const [nombre, diasRestantes] of casos) {
    const c = await registrar(nombre, 'Starter');
    await Negocio.update({ prueba_fin: new Date(Date.now() + diasRestantes * DIA + 3600 * 1000) }, { where: { id: c.id } });
    ids[nombre] = c.id;
  }
  const enviados = await enviarAvisosPrueba();
  check('Envía 3 avisos (no al que le quedan 20 días)', enviados === 3, `(${enviados})`);
  for (const [nombre, , nivel] of casos) {
    const n = await Negocio.findByPk(ids[nombre]);
    check(`${nombre}: ${nivel ? 'aviso ' + nivel : 'sin aviso'}`, nivel ? !!n.avisos_prueba?.[nivel] : !n.avisos_prueba);
  }
  check('No repite avisos ya enviados', (await enviarAvisosPrueba()) === 0);

  console.log(`\n══════════════════════════════════\n  ${ok} correctas · ${fallos} fallos\n══════════════════════════════════`);
  await sequelize.close();
} catch (e) {
  fallos++;
  console.error('\n💥 Error en las pruebas:', e);
} finally {
  server.kill();
  mock.close();
  mockBrevo.close();
  try { rmSync(DB, { force: true }); } catch { /* nada */ }
  process.exit(fallos ? 1 : 0);
}
