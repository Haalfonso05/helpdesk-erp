const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { col } = require('../config/db');
const { asyncHandler, HttpError } = require('../utils/errores');
const { validarPassword } = require('../utils/ayudas');
const { firmarToken, autenticar } = require('../middlewares/auth');
const { registrar } = require('../services/bitacora');
const { encolar } = require('../services/notificaciones');

const router = Router();
const COSTO_BCRYPT = 12; // RQF-03
const MAX_INTENTOS = 5; // RQF-17
const MINUTOS_BLOQUEO = 15;
const mostrarTokens = () => process.env.MOSTRAR_TOKENS_DEV === 'true';

// RQF-17: límite de peticiones por IP en login, registro y recuperación
const limitador = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_AUTH || 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones desde esta IP, intente más tarde' },
});

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function crearToken(usuarioId, tipo, horas) {
  // RQF-05: al pedir uno nuevo se invalidan los anteriores del mismo tipo
  await col('tokens').updateMany({ usuario_id: usuarioId, tipo, usado: false }, { $set: { usado: true } });
  const token = crypto.randomBytes(24).toString('hex');
  await col('tokens').insertOne({
    usuario_id: usuarioId,
    tipo,
    token_hash: hash(token),
    expira: new Date(Date.now() + horas * 3600e3),
    usado: false,
    fecha_creacion: new Date(),
  });
  return token;
}

async function consumirToken(token, tipo) {
  const doc = await col('tokens').findOneAndUpdate(
    { token_hash: hash(String(token || '')), tipo, usado: false, expira: { $gt: new Date() } },
    { $set: { usado: true } }
  );
  if (!doc) throw new HttpError(400, 'El código es inválido, ya fue usado o expiró');
  return doc;
}

const publico = (u) => {
  const { password_hash, intentos_fallidos, bloqueado_hasta, token_version, ...resto } = u;
  return resto;
};

// RQF-01: registro. Siempre entra como cliente y pendiente de verificación
router.post('/registro', limitador, asyncHandler(async (req, res) => {
  const { nombre, tipo_documento, documento, correo, telefono, password, nit_cliente } = req.body;
  if (!correo || !password) throw new HttpError(400, 'Correo y contraseña son obligatorios');
  validarPassword(password, { correo, documento });

  let cliente_id = null;
  if (nit_cliente) {
    const cliente = await col('clientes').findOne({ nit: String(nit_cliente).trim() });
    if (!cliente) throw new HttpError(400, 'No existe un cliente corporativo con ese NIT');
    cliente_id = cliente._id;
  }

  const ahora = new Date();
  const usuario = {
    nombre: String(nombre || '').trim(),
    tipo_documento,
    documento: String(documento || '').trim(),
    correo: String(correo).trim().toLowerCase(),
    telefono: telefono ? String(telefono).trim() : null,
    password_hash: await bcrypt.hash(password, COSTO_BCRYPT),
    roles: ['cliente'],
    estado: 'pendiente_verificacion',
    cliente_id,
    intentos_fallidos: 0,
    bloqueado_hasta: null,
    token_version: 0,
    preferencias_notificacion: { frecuencia: 'inmediata', tickets: true, membresia: true },
    fecha_creacion: ahora,
    fecha_actualizacion: ahora,
    ultimo_acceso: null,
  };
  const { insertedId } = await col('usuarios').insertOne(usuario);
  usuario._id = insertedId;

  const token = await crearToken(insertedId, 'verificacion', 24);
  await encolar(usuario, 'verificacion_cuenta', 'Verifique su cuenta', `Su código de verificación es: ${token}`);
  await registrar({ req, usuario, accion: 'registro_usuario', entidad: 'usuario', documento_id: insertedId });

  res.status(201).json({
    mensaje: 'Cuenta creada. Revise su correo para verificarla.',
    usuario: publico(usuario),
    ...(mostrarTokens() ? { token_verificacion_dev: token } : {}),
  });
}));

// RQF-16: verificación de cuenta
router.post('/verificar', limitador, asyncHandler(async (req, res) => {
  const t = await consumirToken(req.body.token, 'verificacion');
  const r = await col('usuarios').findOneAndUpdate(
    { _id: t.usuario_id, estado: 'pendiente_verificacion' },
    { $set: { estado: 'activo', fecha_actualizacion: new Date() } },
    { returnDocument: 'after' }
  );
  if (!r) throw new HttpError(409, 'La cuenta ya estaba verificada o está inactiva');
  await registrar({ req, usuario: r, accion: 'verificacion_usuario', entidad: 'usuario', documento_id: r._id });
  res.json({ mensaje: 'Cuenta verificada. Ya puede crear tickets.' });
}));

// RQF-16: reenvío del código (máximo 3 por hora)
router.post('/reenviar-verificacion', autenticar, asyncHandler(async (req, res) => {
  if (req.usuario.estado !== 'pendiente_verificacion') throw new HttpError(409, 'La cuenta ya está verificada');
  const ultimaHora = await col('tokens').countDocuments({
    usuario_id: req.usuario._id,
    tipo: 'verificacion',
    fecha_creacion: { $gt: new Date(Date.now() - 3600e3) },
  });
  if (ultimaHora >= 3) throw new HttpError(429, 'Solo se permiten 3 reenvíos por hora');
  const token = await crearToken(req.usuario._id, 'verificacion', 24);
  await encolar(req.usuario, 'verificacion_cuenta', 'Verifique su cuenta', `Su código de verificación es: ${token}`);
  res.json({ mensaje: 'Código reenviado', ...(mostrarTokens() ? { token_verificacion_dev: token } : {}) });
}));

// RQF-02 / RQF-17: login con correo + contraseña, bloqueo tras 5 intentos
router.post('/login', limitador, asyncHandler(async (req, res) => {
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const usuario = await col('usuarios').findOne({ correo });
  const errorGenerico = new HttpError(401, 'Correo o contraseña incorrectos'); // no revela si el correo existe

  if (!usuario) {
    await registrar({ req, accion: 'login_fallido', entidad: 'usuario', resultado: 'fallo', detalle: 'correo no registrado' });
    throw errorGenerico;
  }
  if (usuario.bloqueado_hasta && usuario.bloqueado_hasta > new Date()) {
    const min = Math.ceil((usuario.bloqueado_hasta - Date.now()) / 60000);
    throw new HttpError(423, `Cuenta bloqueada temporalmente por intentos fallidos. Intente en ${min} minuto(s).`);
  }
  if (usuario.estado === 'inactivo') throw errorGenerico;

  const ok = await bcrypt.compare(String(req.body.password || ''), usuario.password_hash);
  if (!ok) {
    const intentos = (usuario.intentos_fallidos || 0) + 1;
    const set = { intentos_fallidos: intentos };
    if (intentos >= MAX_INTENTOS) {
      set.bloqueado_hasta = new Date(Date.now() + MINUTOS_BLOQUEO * 60000);
      set.intentos_fallidos = 0;
    }
    await col('usuarios').updateOne({ _id: usuario._id }, { $set: set });
    await registrar({ req, usuario, accion: set.bloqueado_hasta ? 'bloqueo_cuenta' : 'login_fallido', entidad: 'usuario', documento_id: usuario._id, resultado: 'fallo' });
    throw errorGenerico;
  }

  await col('usuarios').updateOne({ _id: usuario._id }, { $set: { intentos_fallidos: 0, bloqueado_hasta: null, ultimo_acceso: new Date() } });
  await registrar({ req, usuario, accion: 'login_exitoso', entidad: 'usuario', documento_id: usuario._id });
  res.json({ token: firmarToken(usuario), usuario: publico(usuario), debe_cambiar_password: !!usuario.password_temporal });
}));

// Datos del usuario autenticado (+ su empresa y membresía)
router.get('/yo', autenticar, asyncHandler(async (req, res) => {
  const cliente = req.usuario.cliente_id ? await col('clientes').findOne({ _id: req.usuario.cliente_id }) : null;
  res.json({
    usuario: publico(req.usuario),
    roles_efectivos: req.roles,
    cliente,
    es_contacto_principal: !!cliente && String(cliente.contacto_principal_id) === String(req.usuario._id),
  });
}));

// RQF-18: renovación explícita del token
router.post('/renovar', autenticar, (req, res) => res.json({ token: firmarToken(req.usuario) }));

// RQF-18: cerrar sesión → invalida los tokens vigentes del usuario
router.post('/logout', autenticar, asyncHandler(async (req, res) => {
  await col('usuarios').updateOne({ _id: req.usuario._id }, { $inc: { token_version: 1 } });
  await registrar({ req, accion: 'logout', entidad: 'usuario', documento_id: req.usuario._id });
  res.json({ mensaje: 'Sesión cerrada' });
}));

// RQF-05: pedir recuperación de contraseña (respuesta igual exista o no el correo)
router.post('/recuperar', limitador, asyncHandler(async (req, res) => {
  const usuario = await col('usuarios').findOne({ correo: String(req.body.correo || '').trim().toLowerCase(), estado: { $ne: 'inactivo' } });
  let token;
  if (usuario) {
    token = await crearToken(usuario._id, 'recuperacion', 1);
    await encolar(usuario, 'restablecer_password', 'Restablecer contraseña', `Use este código (vence en 1 hora): ${token}`);
    await registrar({ req, usuario, accion: 'solicitud_recuperacion', entidad: 'usuario', documento_id: usuario._id });
  }
  res.json({
    mensaje: 'Si el correo está registrado, recibirá un código para restablecer la contraseña.',
    ...(mostrarTokens() && token ? { token_recuperacion_dev: token } : {}),
  });
}));

// RQF-05: restablecer con el código
router.post('/restablecer', limitador, asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const t = await consumirToken(token, 'recuperacion');
  const usuario = await col('usuarios').findOne({ _id: t.usuario_id });
  validarPassword(password, usuario);
  await col('usuarios').updateOne(
    { _id: usuario._id },
    {
      $set: { password_hash: await bcrypt.hash(password, COSTO_BCRYPT), password_temporal: false, intentos_fallidos: 0, bloqueado_hasta: null, fecha_actualizacion: new Date() },
      $inc: { token_version: 1 },
    }
  );
  await encolar(usuario, 'cambio_password', 'Su contraseña fue cambiada', 'Si no fue usted, contacte a soporte.');
  await registrar({ req, usuario, accion: 'restablecer_password', entidad: 'usuario', documento_id: usuario._id });
  res.json({ mensaje: 'Contraseña actualizada. Inicie sesión de nuevo.' });
}));

// RQF-11: cambiar la propia contraseña (invalida todas las sesiones)
router.put('/password', autenticar, asyncHandler(async (req, res) => {
  const { actual, nueva } = req.body;
  const usuario = await col('usuarios').findOne({ _id: req.usuario._id });
  if (!(await bcrypt.compare(String(actual || ''), usuario.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta');
  validarPassword(nueva, usuario);
  await col('usuarios').updateOne(
    { _id: usuario._id },
    { $set: { password_hash: await bcrypt.hash(nueva, COSTO_BCRYPT), password_temporal: false, fecha_actualizacion: new Date() }, $inc: { token_version: 1 } }
  );
  await encolar(usuario, 'cambio_password', 'Su contraseña fue cambiada', 'Si no fue usted, contacte a soporte.');
  await registrar({ req, accion: 'cambio_password', entidad: 'usuario', documento_id: usuario._id });
  const actualizado = await col('usuarios').findOne({ _id: usuario._id });
  res.json({ mensaje: 'Contraseña actualizada', token: firmarToken(actualizado) });
}));

// RQF-11: actualizar el propio perfil
router.put('/perfil', autenticar, asyncHandler(async (req, res) => {
  const set = { fecha_actualizacion: new Date() };
  if (req.body.nombre !== undefined) set.nombre = String(req.body.nombre).trim();
  if (req.body.telefono !== undefined) set.telefono = req.body.telefono ? String(req.body.telefono).trim() : null;
  if (req.body.preferencias_notificacion) {
    const p = req.body.preferencias_notificacion;
    set.preferencias_notificacion = {
      frecuencia: p.frecuencia === 'resumen_diario' ? 'resumen_diario' : 'inmediata',
      tickets: p.tickets !== false,
      membresia: p.membresia !== false,
    };
  }
  const antes = await col('usuarios').findOne({ _id: req.usuario._id }, { projection: { nombre: 1, telefono: 1, preferencias_notificacion: 1 } });
  const r = await col('usuarios').findOneAndUpdate({ _id: req.usuario._id }, { $set: set }, { returnDocument: 'after', projection: { password_hash: 0 } });
  await registrar({ req, accion: 'actualizar_perfil', entidad: 'usuario', documento_id: req.usuario._id, antes, despues: set });
  res.json(publico(r));
}));

// Útil para el formulario de registro: valida un NIT sin exponer datos
router.get('/cliente-existe/:nit', asyncHandler(async (req, res) => {
  const c = await col('clientes').findOne({ nit: req.params.nit }, { projection: { razon_social: 1 } });
  res.json({ existe: !!c, razon_social: c?.razon_social || null });
}));

module.exports = router;
module.exports.COSTO_BCRYPT = COSTO_BCRYPT;
module.exports.publico = publico;
