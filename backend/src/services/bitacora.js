/**
 * Bitácora de auditoría (RQF-34/35). Colección de SOLO ANEXADO: aquí solo existe insertOne.
 * Si se pasa "session", el registro entra en la misma transacción que la operación auditada.
 */
const { col } = require('../config/db');
const { ipDe } = require('../utils/ayudas');

async function registrar({ req, usuario, accion, entidad, documento_id = null, antes = null, despues = null, resultado = 'exito', detalle }, session) {
  const actor = usuario || req?.usuario || null;
  const doc = {
    fecha: new Date(),
    usuario_id: actor?._id || null,
    correo: actor?.correo || null,
    rol: req?.roles ? req.roles.join('+') : actor?.roles?.join('+') || null,
    accion,
    entidad,
    documento_id,
    antes,
    despues,
    ip: ipDe(req),
    resultado,
  };
  if (detalle) doc.detalle = detalle;
  try {
    await col('bitacora').insertOne(doc, session ? { session } : undefined);
  } catch (e) {
    if (session) throw e; // dentro de una transacción el fallo debe revertir todo
    console.error('No se pudo registrar en la bitácora:', e.message);
  }
}

module.exports = { registrar };
