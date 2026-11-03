/**
 * Cambios de estado de la membresía con TRANSACCIÓN MULTIDOCUMENTO (RQF-23):
 * el pago, el estado de la membresía y la bitácora se confirman o se revierten juntos.
 */
const { getClient, col } = require('../config/db');
const { HttpError } = require('../utils/errores');
const { registrar } = require('./bitacora');
const { encolar } = require('./notificaciones');

const opcionesTx = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

async function notificarUsuariosCliente(clienteId, tipo, asunto, cuerpo) {
  const usuarios = await col('usuarios').find({ cliente_id: clienteId, estado: 'activo' }).toArray();
  await Promise.all(usuarios.map((u) => encolar(u, tipo, asunto, cuerpo)));
}

/**
 * Registra un pago y aplica su efecto sobre la membresía:
 *  aprobado → activa (y corre la fecha de renovación un mes)
 *  fallido  → suspendida (bloquea la creación de tickets y la base de conocimientos restringida)
 *  pendiente→ sin cambio
 * opciones.simularFallo: lanza un error a mitad de la transacción para demostrar el rollback.
 */
async function registrarPago({ req, clienteId, valor, metodo, estado, referencia, simularFallo = false }) {
  const session = getClient().startSession();
  let resultado;
  try {
    await session.withTransaction(async () => {
      const cliente = await col('clientes').findOne({ _id: clienteId }, { session });
      if (!cliente) throw new HttpError(404, 'Cliente no encontrado');

      const pago = {
        cliente_id: clienteId,
        valor: Number(valor),
        metodo,
        estado,
        referencia: referencia || `PAY-${Date.now()}`,
        fecha: new Date(),
        registrado_por: req.usuario._id,
      };
      const { insertedId } = await col('pagos').insertOne(pago, { session });

      const antes = { estado: cliente.membresia.estado, fecha_renovacion: cliente.membresia.fecha_renovacion };
      const set = { 'membresia.fecha_ultimo_cambio': new Date(), 'membresia.metodo_pago': metodo };
      if (estado === 'aprobado') {
        const base = new Date(Math.max(Date.now(), new Date(cliente.membresia.fecha_renovacion).getTime()));
        base.setMonth(base.getMonth() + 1);
        set['membresia.estado'] = 'activa';
        set['membresia.fecha_renovacion'] = base;
      } else if (estado === 'fallido') {
        set['membresia.estado'] = 'suspendida';
      }
      await col('clientes').updateOne({ _id: clienteId }, { $set: set }, { session });

      if (simularFallo) throw new HttpError(409, 'Fallo simulado a mitad de la transacción: MongoDB revirtió el pago y el cambio de membresía (abortTransaction)');

      const despues = { estado: set['membresia.estado'] || antes.estado, fecha_renovacion: set['membresia.fecha_renovacion'] || antes.fecha_renovacion };
      await registrar({ req, accion: `pago_${estado}`, entidad: 'membresia', documento_id: clienteId, antes, despues, detalle: `pago ${insertedId}` }, session);

      resultado = { pago: { _id: insertedId, ...pago }, membresia: despues, cambio: antes.estado !== despues.estado };
    }, opcionesTx);
  } finally {
    await session.endSession();
  }

  if (resultado.cambio) {
    await notificarUsuariosCliente(clienteId, `membresia_${resultado.membresia.estado}`, `Su membresía ahora está ${resultado.membresia.estado}`,
      estado === 'fallido' ? 'El pago fue rechazado y el acceso a soporte quedó suspendido.' : 'Su pago fue aprobado.');
  }
  return resultado;
}

// Cambio manual del estado de la membresía por el administrador (también transaccional)
async function cambiarEstado({ req, clienteId, nuevoEstado, motivo, usuarioSistema }) {
  const session = getClient().startSession();
  let antes;
  try {
    await session.withTransaction(async () => {
      const cliente = await col('clientes').findOne({ _id: clienteId }, { session });
      if (!cliente) throw new HttpError(404, 'Cliente no encontrado');
      antes = cliente.membresia.estado;
      if (antes === nuevoEstado) throw new HttpError(409, `La membresía ya está ${nuevoEstado}`);
      await col('clientes').updateOne(
        { _id: clienteId },
        { $set: { 'membresia.estado': nuevoEstado, 'membresia.fecha_ultimo_cambio': new Date() } },
        { session }
      );
      await registrar({ req, usuario: usuarioSistema, accion: 'cambio_estado_membresia', entidad: 'membresia', documento_id: clienteId, antes: { estado: antes }, despues: { estado: nuevoEstado }, detalle: motivo }, session);
    }, opcionesTx);
  } finally {
    await session.endSession();
  }
  await notificarUsuariosCliente(clienteId, `membresia_${nuevoEstado}`, `Su membresía ahora está ${nuevoEstado}`, motivo || '');
  return { antes, despues: nuevoEstado };
}

// RQF-22: estados de membresía que permiten crear tickets y ver la base restringida
const MEMBRESIA_CON_SERVICIO = ['activa', 'en_gracia'];

module.exports = { registrarPago, cambiarEstado, MEMBRESIA_CON_SERVICIO };
