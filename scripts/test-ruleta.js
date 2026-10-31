/**
 * Pruebas de: planes y límites, tipos de QR, ruleta (topes, periodos, concurrencia),
 * canje, "avísame" y prueba gratuita de 60 días.
 *
 *   node scripts/test-ruleta.js
 *
 * Arranca su propio servidor con una base de datos temporal. Solo para uso local.
 */
import { spawn } from 'child_process';
import { rmSync } from 'fs';

const PORT = 3300;
const BASE = `http://localhost:${PORT}`;
const DB = `/tmp/test-ruleta-${Date.now()}.sqlite`;
const ENV = {
  ...process.env, PORT: String(PORT), DB_STORAGE: DB, JWT_SECRET: 'test-secret-local-test-secret-local-1234',
  PUBLICO_MAX_POR_MINUTO: '1000', NODE_ENV: 'test'
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

async function api(path, { method = 'GET', body, token, manual } = {}) {
  const res = await fetch(BASE + path, {
    method, redirect: manual ? 'manual' : 'follow',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  r = await api(`/r/${qrEnlace}`, { manual: true });
  check('Escaneo → redirección 302 (no 301)', r.status === 302 && r.headers.get('location') === 'https://carta.test/v1');
  check('Sin caché en el navegador', (r.headers.get('cache-control') || '').includes('no-store'));
  await api(`/api/negocio/qrs/${qrEnlace}`, { method: 'PUT', token: A.token, body: { nombre: 'Carta', url_destino: 'https://carta.test/v2' } });
  r = await api(`/r/${qrEnlace}`, { manual: true });
  check('El cambio de URL se aplica al instante', r.headers.get('location') === 'https://carta.test/v2');
  const cont = (await ConfiguracionQR.findByPk(qrEnlace)).contador_escaneos;
  check('Cuenta los escaneos', cont === 2, `(${cont})`);

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
  try { rmSync(DB, { force: true }); } catch { /* nada */ }
  process.exit(fallos ? 1 : 0);
}
