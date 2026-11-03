/**
 * Tareas programadas (se ejecutan al iniciar y luego cada hora):
 *  - RQF-21: ciclo de vida de la membresía (activa → en_gracia → suspendida).
 *  - RQF-24: cierre automático de tickets resueltos hace más de 5 días.
 *  - RQF-25: marca y notifica tickets con el acuerdo de servicio incumplido.
 *  - RQF-16: cuentas sin verificar por 15 días pasan a inactivas.
 *  - RQF-32: procesa la cola de notificaciones.
 */
const { col } = require('../config/db');
const C = require('../config/catalogo');
const { cambiarEstado } = require('./membresias');
const { registrar } = require('./bitacora');
const { encolar, procesarCola } = require('./notificaciones');

const SISTEMA = { _id: null, correo: 'sistema', roles: ['sistema'] };
const DIA = 24 * 3600e3;

async function cicloMembresias(ahora = new Date()) {
  let cambios = 0;
  const aGracia = await col('clientes').find({ 'membresia.estado': 'activa', 'membresia.fecha_renovacion': { $lt: ahora } }).toArray();
  for (const c of aGracia) {
    await cambiarEstado({ clienteId: c._id, nuevoEstado: 'en_gracia', motivo: 'Fecha de renovación vencida', usuarioSistema: SISTEMA });
    cambios++;
  }
  const limite = new Date(ahora.getTime() - C.DIAS_GRACIA_MEMBRESIA * DIA);
  const aSuspender = await col('clientes').find({ 'membresia.estado': 'en_gracia', 'membresia.fecha_renovacion': { $lt: limite } }).toArray();
  for (const c of aSuspender) {
    await cambiarEstado({ clienteId: c._id, nuevoEstado: 'suspendida', motivo: `Periodo de gracia de ${C.DIAS_GRACIA_MEMBRESIA} días vencido`, usuarioSistema: SISTEMA });
    cambios++;
  }
  return cambios;
}

async function cierreAutomaticoTickets(ahora = new Date()) {
  const limite = new Date(ahora.getTime() - C.DIAS_CIERRE_AUTOMATICO * DIA);
  const tickets = await col('tickets').find({ estado: 'resuelto', fecha_resolucion: { $lt: limite } }).toArray();
  for (const t of tickets) {
    await col('tickets').updateOne(
      { _id: t._id, estado: 'resuelto' },
      {
        $set: { estado: 'cerrado', fecha_cierre: ahora, fecha_actualizacion: ahora },
        $push: { historial_estados: { de: 'resuelto', a: 'cerrado', fecha: ahora, usuario_id: null, nota: 'Cierre automático: 5 días sin respuesta del cliente' } },
      }
    );
    await registrar({ usuario: SISTEMA, accion: 'cambio_estado_ticket', entidad: 'ticket', documento_id: t._id, antes: { estado: 'resuelto' }, despues: { estado: 'cerrado' }, detalle: 'cierre automático' });
  }
  return tickets.length;
}

async function revisarSla(ahora = new Date()) {
  const vencidos = await col('tickets')
    .find({ estado: { $in: C.ESTADOS_ABIERTOS }, 'sla.pausado_desde': null, 'sla.vence_resolucion': { $lt: ahora }, 'sla.notificado_incumplimiento': { $ne: true } })
    .toArray();
  if (!vencidos.length) return 0;
  const admins = await col('usuarios').find({ roles: 'administrador', estado: 'activo' }).toArray();
  for (const t of vencidos) {
    await col('tickets').updateOne({ _id: t._id }, { $set: { 'sla.notificado_incumplimiento': true } });
    await Promise.all(admins.map((a) => encolar(a, 'sla_incumplido', `Ticket ${t.codigo} incumplió el acuerdo de servicio`, t.asunto)));
  }
  return vencidos.length;
}

async function inactivarNoVerificados(ahora = new Date()) {
  const limite = new Date(ahora.getTime() - 15 * DIA);
  const r = await col('usuarios').updateMany(
    { estado: 'pendiente_verificacion', fecha_creacion: { $lt: limite } },
    { $set: { estado: 'inactivo', fecha_actualizacion: ahora }, $inc: { token_version: 1 } }
  );
  return r.modifiedCount;
}

async function ejecutarTareas() {
  try {
    const r = {
      membresias: await cicloMembresias(),
      ticketsCerrados: await cierreAutomaticoTickets(),
      slaIncumplidos: await revisarSla(),
      cuentasInactivadas: await inactivarNoVerificados(),
      notificaciones: await procesarCola(),
    };
    return r;
  } catch (e) {
    console.error('Error en tareas programadas:', e.message);
  }
}

function iniciarTareas() {
  ejecutarTareas();
  setInterval(ejecutarTareas, 60 * 60 * 1000).unref();
  setInterval(procesarCola, 30 * 1000).unref(); // la cola de correos se revisa más seguido
}

module.exports = { iniciarTareas, ejecutarTareas, cicloMembresias, cierreAutomaticoTickets, revisarSla };
