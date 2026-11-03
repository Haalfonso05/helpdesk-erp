/**
 * Notificaciones (RQF-31/32/33). Se encolan en la colección "notificaciones" con estado "pendiente"
 * y un proceso asíncrono las "envía" con reintentos. Un fallo de envío nunca bloquea la operación.
 * En este proyecto el envío se simula en consola; para correo real se cambia "enviarCorreo" por
 * nodemailer/SendGrid.
 */
const { col } = require('../config/db');

// Tipos de seguridad: no se pueden desactivar (RQF-33)
const SEGURIDAD = new Set(['verificacion_cuenta', 'restablecer_password', 'cambio_password', 'cambio_correo', 'cambio_rol']);
const CATEGORIA = (tipo) => (tipo.startsWith('ticket') || tipo === 'sla_incumplido' ? 'tickets' : tipo.startsWith('membresia') ? 'membresia' : 'otros');

async function encolar(usuario, tipo, asunto, cuerpo) {
  try {
    if (!usuario?.correo) return;
    const pref = usuario.preferencias_notificacion || {};
    const cat = CATEGORIA(tipo);
    if (!SEGURIDAD.has(tipo) && pref[cat] === false) return; // el usuario la desactivó
    await col('notificaciones').insertOne({
      usuario_id: usuario._id || null,
      correo: usuario.correo,
      tipo,
      asunto,
      cuerpo,
      estado: 'pendiente',
      intentos: 0,
      fecha_creacion: new Date(),
      fecha_envio: null,
    });
  } catch (e) {
    console.error('No se pudo encolar la notificación:', e.message);
  }
}

async function enviarCorreo(n) {
  if (process.env.NODE_ENV !== 'test') console.log(`[correo] [${n.tipo}] → ${n.correo}: ${n.asunto}`);
}

// Procesa la cola: hasta 3 intentos por notificación
async function procesarCola() {
  const pendientes = await col('notificaciones').find({ estado: 'pendiente' }).sort({ fecha_creacion: 1 }).limit(50).toArray();
  for (const n of pendientes) {
    try {
      await enviarCorreo(n);
      await col('notificaciones').updateOne({ _id: n._id }, { $set: { estado: 'enviada', fecha_envio: new Date() }, $inc: { intentos: 1 } });
    } catch {
      await col('notificaciones').updateOne({ _id: n._id }, [
        { $set: { intentos: { $add: ['$intentos', 1] } } },
        { $set: { estado: { $cond: [{ $gte: ['$intentos', 3] }, 'fallida', 'pendiente'] } } },
      ]);
    }
  }
  return pendientes.length;
}

module.exports = { encolar, procesarCola };
