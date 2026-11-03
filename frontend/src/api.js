// Cliente HTTP: agrega el JWT y el contexto (modo auditoría) a cada petición
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

export const sesion = {
  get token() { return leer('hd_token'); },
  set token(v) { guardar('hd_token', v); },
  get contexto() { return leer('hd_contexto'); },
  set contexto(v) { guardar('hd_contexto', v); },
};

export class ErrorApi extends Error {
  constructor(status, datos) {
    super(datos?.error || `Error ${status}`);
    this.status = status;
    this.datos = datos;
  }
}

function encabezados(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (sesion.token) h.Authorization = `Bearer ${sesion.token}`;
  if (sesion.contexto) h['X-Contexto'] = sesion.contexto;
  return h;
}

export async function api(ruta, { method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}${ruta}`, { method, headers: encabezados(), body: body ? JSON.stringify(body) : undefined });
  const texto = await r.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = { error: texto }; }
  if (r.status === 401 && sesion.token && !ruta.startsWith('/auth/login')) {
    sesion.token = null;
    window.dispatchEvent(new Event('sesion-expirada'));
  }
  if (!r.ok) throw new ErrorApi(r.status, datos);
  return datos;
}

// Descarga archivos (CSV/JSON) que requieren el token
export async function descargar(ruta, nombre) {
  const r = await fetch(`${BASE}${ruta}`, { headers: encabezados() });
  if (!r.ok) throw new ErrorApi(r.status, await r.json().catch(() => null));
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
