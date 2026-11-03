const { col } = require('../config/db');
const { PRIORIDADES, SLA_HORAS } = require('../config/catalogo');

// RQF-25: la prioridad sale de la severidad reportada ajustada por el plan del cliente
function calcularPrioridad(severidad, plan) {
  let i = PRIORIDADES.indexOf(severidad);
  if (plan === 'premium') i += 1;
  if (plan === 'basico' && severidad !== 'critica') i -= 1;
  return PRIORIDADES[Math.min(Math.max(i, 0), PRIORIDADES.length - 1)];
}

function calcularSla(prioridad, desde = new Date()) {
  const h = SLA_HORAS[prioridad];
  return {
    vence_respuesta: new Date(desde.getTime() + h.respuesta * 3600e3),
    vence_resolucion: new Date(desde.getTime() + h.resolucion * 3600e3),
    pausado_desde: null,
    minutos_pausa: 0,
    notificado_incumplimiento: false,
  };
}

// Estado del acuerdo de servicio para mostrar en pantalla
function estadoSla(t, ahora = new Date()) {
  const fin = t.fecha_resolucion || (t.sla.pausado_desde ? t.sla.pausado_desde : ahora);
  const vence = new Date(t.sla.vence_resolucion);
  if (t.fecha_resolucion) return fin <= vence ? 'cumplido' : 'incumplido';
  if (t.sla.pausado_desde) return 'pausado';
  if (fin > vence) return 'incumplido';
  const total = vence - new Date(t.fecha_creacion);
  return vence - fin < total * 0.25 ? 'en_riesgo' : 'a_tiempo';
}

// Consecutivo atómico TK-000001, TK-000002...
async function siguienteCodigo(session) {
  const r = await col('contadores').findOneAndUpdate(
    { _id: 'tickets' },
    { $inc: { valor: 1 } },
    { upsert: true, returnDocument: 'after', session }
  );
  return `TK-${String(r.valor).padStart(6, '0')}`;
}

module.exports = { calcularPrioridad, calcularSla, estadoSla, siguienteCodigo };
