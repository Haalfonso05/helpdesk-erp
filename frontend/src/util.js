export const fecha = (d) => (d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fechaHora = (d) => (d ? new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const pesos = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
export const texto = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');

export function haceCuanto(d) {
  if (!d) return '';
  const min = Math.round((Date.now() - new Date(d)) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function restante(d) {
  const ms = new Date(d) - Date.now();
  const h = Math.abs(ms) / 3600e3;
  const t = h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
  return ms >= 0 ? `vence en ${t}` : `venció hace ${t}`;
}
