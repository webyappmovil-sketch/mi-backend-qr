/**
 * QR SaaS – Frontend shared logic (Fase 5)
 * Auth JWT + API helpers
 */
const API_BASE_OVERRIDE = 'https://plataforma-qr-backend.onrender.com';

const API_BASE = (
  window.location.hostname === 'localhost' || window.location.protocol === 'file:'
    ? 'http://localhost:3000'
    : API_BASE_OVERRIDE
);


/* ═══════════════════════════════════════════════
   AUTH (JWT en sessionStorage)
═══════════════════════════════════════════════ */
const Auth = {
  login(data) {
    sessionStorage.setItem('qr_saas_token', data.token);
    sessionStorage.setItem('qr_saas_user', JSON.stringify(data.user));
  },

  getToken() {
    return sessionStorage.getItem('qr_saas_token');
  },

  getUser() {
    try {
      return JSON.parse(sessionStorage.getItem('qr_saas_user'));
    } catch {
      return null;
    }
  },

  updateUser(partial) {
    const user = this.getUser() || {};
    const updated = { ...user, ...partial };
    sessionStorage.setItem('qr_saas_user', JSON.stringify(updated));
    return updated;
  },

  logout() {
    sessionStorage.removeItem('qr_saas_token');
    sessionStorage.removeItem('qr_saas_user');
    window.location.href = 'index.html';
  },

  requireAuth(requiredRole) {
    const user = this.getUser();
    const token = this.getToken();
    if (!user || !token) {
      window.location.href = 'index.html';
      return null;
    }
    if (requiredRole && user.role !== requiredRole) {
      window.location.href = 'index.html';
      return null;
    }
    return user;
  },

  isLoggedIn() {
    return !!(this.getUser() && this.getToken());
  }
};

/* ═══════════════════════════════════════════════
   API
═══════════════════════════════════════════════ */
const API = {
  async request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const token = Auth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      Auth.logout();
      throw new Error('Sesión expirada');
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  registro(body) {
    return this.request('/api/auth/registro', { method: 'POST', body: JSON.stringify(body) });
  },
  login(body) {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
  },
  me() {
    return this.request('/api/auth/me');
  },

  getConfigQR() {
    return this.request('/api/negocio/config-qr');
  },
  saveConfigQR(body) {
    return this.request('/api/negocio/config-qr', { method: 'PUT', body: JSON.stringify(body) });
  },
  getContactos() {
    return this.request('/api/negocio/contactos');
  },
  getMetricas() {
    return this.request('/api/negocio/metricas');
  },

  crearSesionImpresion(payload) {
    return this.request('/pagos/crear-sesion-impresion', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  crearSesionSuscripcion(negocioId, plan) {
    return this.request('/pagos/crear-sesion-suscripcion', {
      method: 'POST',
      body: JSON.stringify({ negocio_id: negocioId, plan })
    });
  },

  adminNegocios() {
    return this.request('/api/admin/negocios');
  },
  adminCambiarEstado(id, estado) {
    return this.request(`/api/admin/negocios/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado })
    });
  },
  adminPedidos(estado = 'Pendiente') {
    return this.request(`/api/admin/pedidos?estado=${estado}`);
  },
  adminPedidoEstado(id, estado) {
    return this.request(`/api/admin/pedidos/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado })
    });
  },
  adminMetricas() {
    return this.request('/api/admin/metricas');
  }
};

/* ═══════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════ */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `fixed bottom-4 right-4 z-[100] px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-opacity
    ${type === 'error' ? 'bg-red-600 text-white' : type === 'success' ? 'bg-green-600 text-white' : 'bg-slate-800 text-white'}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3200);
}

function formatFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function redirectUrl(qrId) {
  let base;
  if (typeof window !== 'undefined' && window.location.hostname.includes('onrender.com')) {
    base = window.location.origin;
  } else {
    base = API_BASE || (typeof window !== 'undefined' ? window.location.origin : 'https://plataforma-qr-backend.onrender.com');
  }
  base = String(base).replace(/\/$/, '');
  if (!base || base === 'https://onrender.com') {
    base = 'https://plataforma-qr-backend.onrender.com';
  }
  return `${base}/r/${qrId}`;
}
