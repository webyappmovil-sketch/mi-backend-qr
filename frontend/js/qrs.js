/**
 * Panel del dueño: Mis QR (lista, crear, editar, eliminar, descargar) y
 * participantes de la ruleta (buscar, canjear, exportar CSV).
 * Depende de app.js (API, Auth, toast, redirectUrl) y qrlocal.js.
 */
const QRS = (() => {
  const TIPOS = {
    Ruleta:   { nombre: 'Ruleta de premios', desc: 'Capta clientes con premios. Ideal para la ventana o la entrada.', emoji: '🎡' },
    Enlace:   { nombre: 'Enlace directo',    desc: 'Lleva directo a una web, carta, vídeo o PDF.', emoji: '🔗' },
    Enlaces:  { nombre: 'Página de enlaces', desc: 'Una página con varios botones.', emoji: '🗂️' },
    Texto:    { nombre: 'Texto o clave',     desc: 'Muestra la clave del wifi, el código del baño…', emoji: '🔑' },
    WhatsApp: { nombre: 'Chat de WhatsApp',  desc: 'Abre un chat con tu negocio.', emoji: '💬' }
  };
  const ORDEN_TIPOS = ['Ruleta', 'Enlace', 'Enlaces', 'Texto', 'WhatsApp'];
  const NOMBRE_PLAN = { Starter: 'Gratuito', Pro: 'Pro', Business: 'Business' };
  const COLORES = [['#7F77DD', 'Morado'], ['#1D9E75', 'Verde'], ['#D85A30', 'Naranja'], ['#EF9F27', 'Amarillo'], ['#D4537E', 'Rosa'], ['#378ADD', 'Azul'], ['#888780', 'Gris']];
  const ICONOS = [['whatsapp', '💬 WhatsApp'], ['pdf', '📄 PDF / carta'], ['web', '🌐 Web'], ['video', '▶️ Vídeo'], ['catalogo', '📖 Catálogo'], ['mapa', '📍 Mapa'], ['telefono', '📞 Teléfono'], ['email', '✉️ Email'], ['otro', '🔗 Otro']];
  const RULETA_DEFECTO = () => ({
    titulo: '¿Quieres jugar a la ruleta y ganar premios?',
    premios: [
      { texto: '10 % dto.', color: COLORES[0][0], probabilidad: 15, es_premio: true, tope_dia: 10 },
      { texto: 'Café gratis', color: COLORES[1][0], probabilidad: 10, es_premio: true, tope_dia: 5 },
      { texto: '5 % dto.', color: COLORES[2][0], probabilidad: 20, es_premio: true, tope_dia: 15 },
      { texto: 'Postre gratis', color: COLORES[3][0], probabilidad: 5, es_premio: true, tope_dia: 3 },
      { texto: '2x1 en café', color: COLORES[5][0], probabilidad: 5, es_premio: true, tope_dia: 3 },
      { texto: 'Sigue probando', color: COLORES[6][0], probabilidad: 45, es_premio: false, tope_dia: '' }
    ],
    periodo_dias: 7, enlaces: []
  });

  let S = { qrs: [], plan: null, estado: null, telefono: '', modal: null };
  let participantes = [];

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = iso => iso ? new Date(iso).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long' }) : '';

  /* ───────────── Carga ───────────── */
  async function cargar() {
    try {
      const d = await API.request('/api/negocio/qrs');
      S.qrs = d.qrs; S.plan = d.plan; S.estado = d.estado; S.telefono = d.telefono_whatsapp || '';
      if (S.qrs[0]) { window.qrId = S.qrs[0].id; Auth.updateUser({ qrId: S.qrs[0].id }); }
      Auth.updateUser({ estado: d.estado, plan: d.plan.plan });
      if (typeof actualizarBadgeEstado === 'function') actualizarBadgeEstado(d.estado);
      const bp = $('badge-plan'); if (bp) bp.textContent = d.plan.nombre_plan;
      renderBannerPrueba(); renderPanel();
    } catch (e) { toast('Error cargando tus QR: ' + e.message, 'error'); }
  }

  /* ───────────── Banner y barra de plan ───────────── */
  function renderBannerPrueba() {
    const b = $('banner-prueba'); if (!b) return;
    const p = S.plan.prueba;
    let html = '', cls = '';
    if (p.estado === 'activa' && p.dias_restantes <= 15) {
      cls = 'bg-amber-50 border-amber-200 text-amber-900';
      html = `<strong>Te quedan ${p.dias_restantes} ${p.dias_restantes === 1 ? 'día' : 'días'} de prueba gratuita.</strong> Mejora tu plan antes del ${fecha(p.fin)} para que tu QR siga funcionando.`;
    } else if (p.estado === 'cortesia') {
      cls = 'bg-orange-50 border-orange-200 text-orange-900';
      html = `<strong>Tu prueba ha terminado.</strong> Tu QR seguirá funcionando hasta el ${fecha(p.cortesia_hasta)}. Después se pausará.`;
    } else if (p.estado === 'pausada') {
      cls = 'bg-red-50 border-red-200 text-red-900';
      html = '<strong>Tu QR está pausado.</strong> Mejora tu plan para reactivarlo: no se ha borrado nada.';
    }
    b.className = html ? `border-b ${cls}` : 'hidden';
    b.innerHTML = html ? `<div class="max-w-6xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><p class="text-sm">${html}</p><button onclick="abrirMejora()" class="text-sm font-semibold bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg whitespace-nowrap">Mejorar plan</button></div>` : '';
  }

  function textoPrueba() {
    const p = S.plan.prueba;
    if (p.estado === 'activa') return `Prueba gratuita: ${p.dias_restantes} ${p.dias_restantes === 1 ? 'día restante' : 'días restantes'} (hasta el ${fecha(p.fin)})`;
    if (p.estado === 'cortesia') return `Prueba terminada. Funciona hasta el ${fecha(p.cortesia_hasta)}`;
    if (p.estado === 'pausada') return 'Prueba terminada: QR pausado';
    return '';
  }

  /* ───────────── Lista de QR ───────────── */
  function renderPanel() {
    const P = S.plan, lleno = P.qr_usados >= P.max_qr, pausado = P.prueba.estado === 'pausada';
    const gratis = P.plan === 'Starter';
    let h = `<div class="bg-white rounded-2xl border border-slate-200 p-5 mb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <p class="font-bold text-lg">Plan ${esc(P.nombre_plan)} <span class="text-sm font-normal text-slate-500">· ${P.qr_usados} de ${P.max_qr} QR usados</span></p>
        ${textoPrueba() ? `<p class="text-sm text-slate-500 mt-0.5">${esc(textoPrueba())}</p>` : ''}
        ${gratis ? '<p class="text-xs text-slate-400 mt-1">El plan gratuito incluye 1 QR de enlace directo. La ruleta, los otros tipos de QR y las métricas completas están en Pro y Business.</p>' : ''}
      </div>
      <div class="flex gap-2 flex-wrap">
        ${gratis ? '<button onclick="abrirMejora()" class="text-sm font-semibold border border-green-600 text-green-700 hover:bg-green-50 px-4 py-2.5 rounded-xl">Mejorar plan</button>' : ''}
        <button onclick="QRS.nuevo()" ${pausado ? 'disabled' : ''} class="text-sm font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl">+ Crear QR</button>
      </div>
    </div>`;
    if (!S.qrs.length) h += '<p class="text-center text-slate-400 py-10">Aún no tienes ningún QR. Crea el primero.</p>';
    h += '<div class="grid md:grid-cols-2 xl:grid-cols-3 gap-4">';
    S.qrs.forEach((q, i) => {
      const t = TIPOS[q.tipo_destino] || TIPOS.Enlace;
      const destino = q.tipo_destino === 'Enlace' ? q.url_destino : '';
      h += `<div class="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="font-semibold truncate">${esc(q.nombre)}</p>
            <p class="text-xs text-slate-500">${t.emoji} ${t.nombre}${destino ? ' · ' + esc(destino).slice(0, 40) : ''}</p>
          </div>
          <span class="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-1 rounded-full whitespace-nowrap">${q.escaneos} ${q.escaneos === 1 ? 'escaneo' : 'escaneos'}</span>
        </div>
        <div class="my-3 flex justify-center"><canvas id="qr-prev-${i}" class="w-36 h-36 border border-slate-100 rounded-lg"></canvas></div>
        <p class="text-[11px] text-slate-400 break-all text-center mb-3">${esc(redirectUrl(q.id))}</p>
        <div class="mt-auto grid grid-cols-3 gap-2 text-sm">
          <button onclick="QRS.descargar(${i})" class="bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg py-2">Descargar</button>
          <button onclick="QRS.editar(${i})" ${pausado ? 'disabled' : ''} class="border border-slate-200 hover:bg-slate-50 disabled:opacity-50 font-semibold rounded-lg py-2">Editar</button>
          <button onclick="QRS.eliminar(${i})" ${pausado ? 'disabled' : ''} class="border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 font-semibold rounded-lg py-2">Eliminar</button>
        </div>
      </div>`;
    });
    h += '</div>';
    $('qr-panel').innerHTML = h;
    S.qrs.forEach((q, i) => { try { QRLocal.dibujar($('qr-prev-' + i), redirectUrl(q.id), 300); } catch (e) { /* sin vista previa */ } });
  }

  function descargar(i) {
    const q = S.qrs[i];
    if (S.estado === 'Pendiente_Impresion') return toast('Activa tu cuenta para descargar el QR.', 'error');
    const c = QRLocal.dibujar(document.createElement('canvas'), redirectUrl(q.id), 1200);
    const a = document.createElement('a');
    a.download = `qr-${(q.nombre || 'qr').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }

  async function eliminar(i) {
    const q = S.qrs[i];
    if (!confirm(`¿Eliminar el QR "${q.nombre}"?\nSi ya está impreso, dejará de funcionar. Tus clientes y participantes se conservan.`)) return;
    try { await API.request(`/api/negocio/qrs/${q.id}`, { method: 'DELETE' }); toast('QR eliminado', 'success'); await cargar(); }
    catch (e) { toast(e.message, 'error'); }
  }

  /* ───────────── Modal: crear / editar ───────────── */
  function nuevo() {
    const P = S.plan;
    if (P.qr_usados >= P.max_qr) {
      toast(`Has llegado al límite de tu plan (${P.max_qr} ${P.max_qr === 1 ? 'QR' : 'QR'}).`, 'error');
      if (P.plan === 'Starter') abrirMejora();
      return;
    }
    S.modal = { modo: 'crear', tipo: null, form: null };
    renderModal();
  }

  function editar(i) {
    const q = S.qrs[i];
    const f = { nombre: q.nombre };
    if (q.tipo_destino === 'Enlace') f.url = q.url_destino || '';
    if (q.tipo_destino === 'WhatsApp') { f.telefono = S.telefono; f.mensaje = q.mensaje; }
    if (q.tipo_destino === 'Enlaces') Object.assign(f, { titulo: q.datos?.titulo || '', enlaces: q.datos?.enlaces || [] });
    if (q.tipo_destino === 'Texto') Object.assign(f, { titulo: q.datos?.titulo || '', items: q.datos?.items || [], nota: q.datos?.nota || '' });
    if (q.tipo_destino === 'Ruleta') Object.assign(f, JSON.parse(JSON.stringify(q.datos || RULETA_DEFECTO())));
    S.modal = { modo: 'editar', tipo: q.tipo_destino, qrId: q.id, form: f };
    renderModal();
  }

  function elegirTipo(tipo) {
    if (!S.plan.tipos_permitidos.includes(tipo)) {
      toast('Este tipo de QR está disponible desde el plan Pro.', 'error');
      return abrirMejora();
    }
    const base = { nombre: '' };
    const defectos = {
      Enlace: { url: '' },
      WhatsApp: { telefono: S.telefono, mensaje: '¡Hola! Vengo del código QR.' },
      Enlaces: { titulo: 'Todo sobre nosotros', enlaces: [{ etiqueta: '', url: '', icono: 'web' }] },
      Texto: { titulo: 'Wifi', items: [{ etiqueta: 'Red', valor: '' }, { etiqueta: 'Clave', valor: '' }], nota: '' },
      Ruleta: RULETA_DEFECTO()
    };
    S.modal.tipo = tipo;
    S.modal.form = { ...base, ...defectos[tipo], nombre: TIPOS[tipo].nombre };
    renderModal();
  }

  const campo = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500';

  function filasEnlaces(lista, max) {
    return `<div id="lista-enlaces" class="space-y-2">${lista.map((e, i) => `
      <div class="fila-enlace grid grid-cols-12 gap-2 items-center">
        <select data-k="icono" class="${campo} col-span-3">${ICONOS.map(([v, l]) => `<option value="${v}" ${e.icono === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input data-k="etiqueta" class="${campo} col-span-3" placeholder="Nombre del botón" maxlength="40" value="${esc(e.etiqueta)}">
        <input data-k="url" class="${campo} col-span-5" placeholder="https://…" value="${esc(e.url)}">
        <button type="button" onclick="QRS.quitar('enlaces',${i})" class="col-span-1 text-slate-400 hover:text-red-600 text-lg" aria-label="Quitar">×</button>
      </div>`).join('')}</div>
      ${lista.length < max ? `<button type="button" onclick="QRS.anadir('enlaces')" class="text-sm font-semibold text-green-700 mt-2">+ Añadir enlace</button>` : `<p class="text-xs text-slate-400 mt-2">Máximo ${max} enlaces</p>`}`;
  }

  function formTipo(tipo, f) {
    if (tipo === 'Enlace') return `
      <label class="block text-sm font-medium mb-1">¿A dónde lleva este QR?</label>
      <input id="f-url" class="${campo}" placeholder="https://tu-carta.com" value="${esc(f.url)}">
      <p class="text-xs text-slate-400 mt-1">Puedes cambiar esta dirección cuando quieras: el QR impreso seguirá funcionando.</p>`;
    if (tipo === 'WhatsApp') return `
      <label class="block text-sm font-medium mb-1">WhatsApp del negocio (sin +)</label>
      <input id="f-tel" class="${campo}" placeholder="34600111222" value="${esc(f.telefono)}">
      <label class="block text-sm font-medium mb-1 mt-3">Mensaje que se escribe al abrir el chat</label>
      <textarea id="f-msg" rows="3" class="${campo}">${esc(f.mensaje)}</textarea>`;
    if (tipo === 'Enlaces') return `
      <label class="block text-sm font-medium mb-1">Título de la página</label>
      <input id="f-titulo" class="${campo} mb-3" maxlength="60" value="${esc(f.titulo)}">
      ${filasEnlaces(f.enlaces, 12)}`;
    if (tipo === 'Texto') return `
      <label class="block text-sm font-medium mb-1">Título</label>
      <input id="f-titulo" class="${campo} mb-3" maxlength="60" value="${esc(f.titulo)}">
      <div id="lista-items" class="space-y-2">${f.items.map((it, i) => `
        <div class="fila-item grid grid-cols-12 gap-2 items-center">
          <input data-k="etiqueta" class="${campo} col-span-4" placeholder="Nombre (ej. Clave)" maxlength="30" value="${esc(it.etiqueta)}">
          <input data-k="valor" class="${campo} col-span-7" placeholder="Valor" maxlength="120" value="${esc(it.valor)}">
          <button type="button" onclick="QRS.quitar('items',${i})" class="col-span-1 text-slate-400 hover:text-red-600 text-lg" aria-label="Quitar">×</button>
        </div>`).join('')}</div>
      ${f.items.length < 4 ? `<button type="button" onclick="QRS.anadir('items')" class="text-sm font-semibold text-green-700 mt-2">+ Añadir dato</button>` : ''}
      <label class="block text-sm font-medium mb-1 mt-3">Nota (opcional)</label>
      <input id="f-nota" class="${campo}" maxlength="160" value="${esc(f.nota)}">
      <p class="text-xs text-slate-400 mt-1">Cualquiera que escanee este QR verá estos datos. Úsalo solo para información que quieras compartir con tus clientes.</p>`;
    if (tipo === 'Ruleta') return formRuleta(f);
    return '';
  }

  function formRuleta(f) {
    const suma = f.premios.reduce((a, p) => a + (Number(p.probabilidad) || 0), 0);
    const maxDia = f.premios.reduce((a, p) => a + (p.es_premio && p.tope_dia ? Number(p.tope_dia) : 0), 0);
    const sinTope = f.premios.some(p => p.es_premio && !p.tope_dia);
    return `
      <label class="block text-sm font-medium mb-1">Mensaje para invitar a jugar</label>
      <input id="f-titulo" class="${campo} mb-4" maxlength="80" value="${esc(f.titulo)}">
      <p class="text-sm font-medium mb-1">Las 6 casillas de la ruleta</p>
      <div class="grid grid-cols-12 gap-2 text-xs text-slate-500 mb-1 px-0.5">
        <span class="col-span-2">Color</span><span class="col-span-4">Texto</span><span class="col-span-2">¿Premio?</span><span class="col-span-2">Probab. %</span><span class="col-span-2">Tope/día</span>
      </div>
      <div id="lista-premios" class="space-y-2">${f.premios.map(p => `
        <div class="fila-premio grid grid-cols-12 gap-2 items-center">
          <select data-k="color" class="${campo} col-span-2 px-1">${COLORES.map(([v, n]) => `<option value="${v}" ${p.color === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <input data-k="texto" class="${campo} col-span-4" maxlength="24" value="${esc(p.texto)}">
          <label class="col-span-2 flex items-center gap-1 text-xs"><input data-k="es_premio" type="checkbox" ${p.es_premio ? 'checked' : ''}> Sí</label>
          <input data-k="probabilidad" type="number" min="0" max="100" step="0.5" class="${campo} col-span-2 px-2" value="${esc(p.probabilidad)}">
          <input data-k="tope_dia" type="number" min="1" class="${campo} col-span-2 px-2" placeholder="∞" value="${esc(p.tope_dia ?? '')}" ${p.es_premio ? '' : 'disabled'}>
        </div>`).join('')}</div>
      <div class="flex flex-wrap justify-between text-sm mt-3 gap-2">
        <span class="${Math.abs(suma - 100) < 0.01 ? 'text-green-700' : 'text-red-600 font-semibold'}">Suma: ${Math.round(suma * 100) / 100} % ${Math.abs(suma - 100) < 0.01 ? '' : '(debe ser 100 %)'}</span>
        <span class="text-slate-500">${sinTope ? 'Algún premio no tiene tope diario' : 'Máximo de premios al día: ' + maxDia}</span>
      </div>
      <button type="button" onclick="QRS.recalcular()" class="text-xs font-semibold text-green-700 mt-1">Actualizar suma</button>
      <div class="grid sm:grid-cols-2 gap-3 mt-4">
        <div><label class="block text-sm font-medium mb-1">Un premio por persona cada</label>
          <select id="f-periodo" class="${campo}"><option value="7" ${f.periodo_dias == 7 ? 'selected' : ''}>Semana</option><option value="30" ${f.periodo_dias == 30 ? 'selected' : ''}>Mes</option></select></div>
        <div><label class="block text-sm font-medium mb-1">El premio se puede canjear</label>
          <select class="${campo}" disabled><option>Solo el día en que se gana</option></select></div>
      </div>
      <p class="text-xs text-slate-400 mt-2">Cada persona puede jugar una vez al día. Si un premio llega a su tope diario, esa casilla aparece como "Sigue probando"; si no queda ningún premio, se avisa antes de pedir datos.</p>
      <p class="text-sm font-medium mt-4 mb-1">Qué ve el cliente después de jugar (opcional)</p>
      ${filasEnlaces(f.enlaces, 6)}`;
  }

  function renderModal() {
    const m = S.modal;
    if (!m) { const x = $('qr-modal'); if (x) x.remove(); return; }
    let cuerpo = '', titulo = '';
    if (!m.tipo) {
      titulo = '¿Qué tipo de QR quieres crear?';
      cuerpo = '<div class="grid sm:grid-cols-2 gap-3">' + ORDEN_TIPOS.map(t => {
        const bloq = !S.plan.tipos_permitidos.includes(t);
        return `<button onclick="QRS.elegirTipo('${t}')" class="text-left border-2 ${bloq ? 'border-slate-100 bg-slate-50' : 'border-slate-200 hover:border-green-500'} rounded-xl p-4">
          <p class="font-semibold">${TIPOS[t].emoji} ${TIPOS[t].nombre} ${bloq ? '<span class="text-[11px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full ml-1">Desde Pro</span>' : ''}</p>
          <p class="text-xs text-slate-500 mt-1">${TIPOS[t].desc}</p></button>`;
      }).join('') + '</div>';
    } else {
      titulo = (m.modo === 'crear' ? 'Nuevo QR · ' : 'Editar QR · ') + TIPOS[m.tipo].nombre;
      cuerpo = `<label class="block text-sm font-medium mb-1">Nombre del QR (solo lo ves tú)</label>
        <input id="f-nombre" class="${campo} mb-4" maxlength="100" value="${esc(m.form.nombre)}">
        ${formTipo(m.tipo, m.form)}
        <p id="modal-error" class="text-sm text-red-600 mt-3 min-h-[1.25rem]" role="alert"></p>
        <div class="flex gap-2 justify-end mt-2">
          ${m.modo === 'crear' ? '<button onclick="QRS.volverTipos()" class="px-4 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl">Atrás</button>' : ''}
          <button id="btn-guardar-qr" onclick="QRS.guardar()" class="px-5 py-2.5 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded-xl">${m.modo === 'crear' ? 'Crear QR' : 'Guardar cambios'}</button>
        </div>`;
    }
    let cont = $('qr-modal');
    if (!cont) { cont = document.createElement('div'); cont.id = 'qr-modal'; document.body.appendChild(cont); }
    cont.innerHTML = `<div class="fixed inset-0 bg-black/40 z-50 flex items-start sm:items-center justify-center p-3 overflow-y-auto">
      <div class="bg-white rounded-2xl w-full max-w-2xl p-5 sm:p-6 shadow-xl relative my-4">
        <button onclick="QRS.cerrar()" class="absolute top-3 right-4 text-slate-400 text-2xl" aria-label="Cerrar">&times;</button>
        <h2 class="text-lg font-bold mb-4 pr-6">${titulo}</h2>${cuerpo}</div></div>`;
  }

  /* Lee lo escrito en el formulario hacia el estado (antes de añadir/quitar filas) */
  function sincronizar() {
    const m = S.modal; if (!m || !m.tipo) return;
    const f = m.form, v = id => ($(id)?.value ?? '');
    f.nombre = v('f-nombre');
    if (m.tipo === 'Enlace') f.url = v('f-url');
    if (m.tipo === 'WhatsApp') { f.telefono = v('f-tel'); f.mensaje = v('f-msg'); }
    if (m.tipo === 'Enlaces' || m.tipo === 'Ruleta') {
      f.titulo = v('f-titulo');
      f.enlaces = [...document.querySelectorAll('.fila-enlace')].map(r => ({
        icono: r.querySelector('[data-k=icono]').value, etiqueta: r.querySelector('[data-k=etiqueta]').value, url: r.querySelector('[data-k=url]').value
      }));
    }
    if (m.tipo === 'Texto') {
      f.titulo = v('f-titulo'); f.nota = v('f-nota');
      f.items = [...document.querySelectorAll('.fila-item')].map(r => ({ etiqueta: r.querySelector('[data-k=etiqueta]').value, valor: r.querySelector('[data-k=valor]').value }));
    }
    if (m.tipo === 'Ruleta') {
      f.periodo_dias = Number(v('f-periodo')) || 7;
      f.premios = [...document.querySelectorAll('.fila-premio')].map(r => {
        const g = k => r.querySelector(`[data-k=${k}]`);
        return { color: g('color').value, texto: g('texto').value, es_premio: g('es_premio').checked, probabilidad: g('probabilidad').value, tope_dia: g('tope_dia').value };
      });
    }
  }

  function anadir(que) {
    sincronizar(); const f = S.modal.form;
    if (que === 'enlaces') f.enlaces.push({ etiqueta: '', url: '', icono: 'web' });
    if (que === 'items') f.items.push({ etiqueta: '', valor: '' });
    renderModal();
  }
  function quitar(que, i) { sincronizar(); S.modal.form[que].splice(i, 1); renderModal(); }
  function recalcular() { sincronizar(); renderModal(); }
  function volverTipos() { S.modal = { modo: 'crear', tipo: null, form: null }; renderModal(); }
  function cerrar() { S.modal = null; renderModal(); }

  async function guardar() {
    sincronizar();
    const m = S.modal, f = m.form, err = $('modal-error'), btn = $('btn-guardar-qr');
    let body = { nombre: f.nombre };
    if (m.modo === 'crear') body.tipo_destino = m.tipo;
    if (m.tipo === 'Enlace') body.url_destino = f.url.trim();
    if (m.tipo === 'WhatsApp') { body.mensaje = f.mensaje; body.telefono_whatsapp = f.telefono; }
    if (m.tipo === 'Enlaces') body.datos = { titulo: f.titulo, enlaces: f.enlaces };
    if (m.tipo === 'Texto') body.datos = { titulo: f.titulo, items: f.items, nota: f.nota };
    if (m.tipo === 'Ruleta') {
      body.datos = {
        titulo: f.titulo, periodo_dias: f.periodo_dias, enlaces: f.enlaces,
        premios: f.premios.map(p => ({ ...p, probabilidad: Number(p.probabilidad), tope_dia: p.es_premio && p.tope_dia !== '' ? Number(p.tope_dia) : null }))
      };
    }
    btn.disabled = true; err.textContent = '';
    try {
      await API.request(m.modo === 'crear' ? '/api/negocio/qrs' : `/api/negocio/qrs/${m.qrId}`, { method: m.modo === 'crear' ? 'POST' : 'PUT', body: JSON.stringify(body) });
      toast(m.modo === 'crear' ? 'QR creado' : 'Cambios guardados', 'success');
      cerrar(); await cargar();
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  }

  /* ───────────── Participantes de la ruleta ───────────── */
  async function cargarParticipantes() {
    const cont = $('panel-participantes'); if (!cont) return;
    try { participantes = (await API.request('/api/negocio/participaciones')).participaciones; }
    catch (e) { return toast(e.message, 'error'); }
    if (!participantes.length) { cont.innerHTML = ''; return; }
    cont.innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-6">
      <div class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100">
        <div><h2 class="font-bold text-lg">Participantes de la ruleta</h2>
          <p class="text-xs text-slate-400">Han aceptado recibir promociones. Úsalos solo para lo que aceptaron.</p></div>
        <div class="flex gap-2">
          <input id="buscar-part" oninput="QRS.pintarParticipantes()" placeholder="Buscar nombre, móvil o código" class="border border-slate-200 rounded-lg px-3 py-2 text-sm w-56">
          <button onclick="QRS.exportar()" class="text-sm font-semibold bg-green-50 text-green-700 hover:bg-green-100 px-4 py-2 rounded-lg whitespace-nowrap">📥 Exportar CSV</button>
        </div></div>
      <div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-slate-500 text-left"><tr>
        <th class="px-4 py-3 font-medium">Fecha</th><th class="px-4 py-3 font-medium">Nombre</th><th class="px-4 py-3 font-medium">Móvil</th>
        <th class="px-4 py-3 font-medium">Resultado</th><th class="px-4 py-3 font-medium">Código</th><th class="px-4 py-3 font-medium">Estado</th><th></th>
      </tr></thead><tbody id="tabla-part" class="divide-y divide-slate-100"></tbody></table></div></div>`;
    pintarParticipantes();
  }

  function pintarParticipantes() {
    const q = ($('buscar-part')?.value || '').toLowerCase().trim();
    const filas = participantes.filter(p => !q || [p.nombre, p.apellido, p.telefono, p.codigo, p.premio].join(' ').toLowerCase().includes(q));
    const chip = { Pendiente: 'bg-amber-100 text-amber-800', Canjeado: 'bg-green-100 text-green-800', Caducado: 'bg-slate-100 text-slate-500' };
    $('tabla-part').innerHTML = filas.map(p => `<tr class="hover:bg-slate-50">
      <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${esc(formatFecha(p.fecha))}</td>
      <td class="px-4 py-3 font-medium">${esc(p.nombre)} ${esc(p.apellido || '')}</td>
      <td class="px-4 py-3 text-slate-600">${esc(p.telefono)}</td>
      <td class="px-4 py-3">${p.origen === 'Aviso' ? '<span class="text-slate-500">Quiere avisos</span>' : esc(p.premio)}</td>
      <td class="px-4 py-3 font-mono">${esc(p.codigo || '—')}</td>
      <td class="px-4 py-3">${p.estado ? `<span class="text-xs font-semibold px-2 py-1 rounded-full ${chip[p.estado]}">${p.estado}</span>` : '—'}</td>
      <td class="px-4 py-3">${p.estado === 'Pendiente' ? `<button onclick="QRS.canjear('${esc(p.id)}')" class="text-xs font-semibold bg-green-600 text-white px-3 py-1.5 rounded-lg">Canjear</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-400">Sin resultados</td></tr>';
  }

  async function canjear(id) {
    if (!confirm('¿Marcar este premio como canjeado? No se puede deshacer.')) return;
    try { await API.request(`/api/negocio/participaciones/${id}/canjear`, { method: 'PUT' }); toast('Premio canjeado', 'success'); await cargarParticipantes(); }
    catch (e) { toast(e.message, 'error'); await cargarParticipantes(); }
  }

  // CSV seguro: comillas escapadas y sin fórmulas ejecutables al abrir en Excel
  function celda(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportar() {
    if (!participantes.length) return toast('No hay participantes', 'error');
    const filas = [['Nombre', 'Apellido', 'Móvil', 'Resultado', 'Código', 'Estado', 'Fecha', 'Acepta promociones']]
      .concat(participantes.map(p => [p.nombre, p.apellido || '', p.telefono, p.origen === 'Aviso' ? 'Quiere avisos' : p.premio, p.codigo || '', p.estado || '', formatFecha(p.fecha), p.acepta_promos ? 'Sí' : 'No']));
    const csv = '\ufeff' + filas.map(f => f.map(celda).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'participantes-ruleta.csv'; a.click();
  }

  return { cargar, nuevo, editar, eliminar, descargar, elegirTipo, anadir, quitar, recalcular, volverTipos, cerrar, guardar, cargarParticipantes, pintarParticipantes, canjear, exportar };
})();
