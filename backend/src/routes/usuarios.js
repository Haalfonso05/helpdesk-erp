const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { col } = require('../config/db');
const { ROLES, CLAVES_MODULOS } = require('../config/catalogo');
const { asyncHandler, HttpError } = require('../utils/errores');
const { aId, aIdONull, paginar, escaparRegex } = require('../utils/ayudas');
const { requierePermiso, tieneRol } = require('../middlewares/auth');
const { registrar } = require('../services/bitacora');
const { encolar } = require('../services/notificaciones');
const { COSTO_BCRYPT, publico } = require('./auth');

const router = Router();

// RQF-03: contraseña temporal aleatoria de 16 caracteres alfanuméricos (+ símbolos para cumplir la política)
function passwordTemporal() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 16; i++) p += alfabeto[crypto.randomInt(alfabeto.length)];
  return `${p}#9aA`;
}

// RQF-09: listar con filtros (rol, estado, cliente) y búsqueda por nombre, correo o documento
router.get('/', requierePermiso('usuarios:consultar'), asyncHandler(async (req, res) => {
  const { rol, estado, cliente_id, q, pagina, limite, orden } = req.query;
  const f = {};
  if (rol) f.roles = rol;
  if (estado) f.estado = estado;
  if (cliente_id) f.cliente_id = aId(cliente_id, 'cliente_id');
  if (q) {
    const r = new RegExp(escaparRegex(q), 'i');
    f.$or = [{ nombre: r }, { correo: r }, { documento: r }];
  }
  // Anexo A: soporte solo ve datos de contacto
  const soloContacto = !tieneRol(req, 'administrador') && !tieneRol(req, 'auditor');
  const proyeccion = soloContacto
    ? { nombre: 1, correo: 1, telefono: 1, roles: 1, cliente_id: 1, especialidades: 1 }
    : { password_hash: 0 };
  res.json(await paginar(col('usuarios'), f, { pagina, limite, orden, proyeccion }));
}));

router.get('/:id', requierePermiso('usuarios:consultar'), asyncHandler(async (req, res) => {
  const u = await col('usuarios').findOne({ _id: aId(req.params.id) }, { projection: { password_hash: 0 } });
  if (!u) throw new HttpError(404, 'Usuario no encontrado');
  res.json(u);
}));

// RQF-09: el administrador crea usuarios de cualquier rol (con contraseña temporal)
router.post('/', requierePermiso('usuarios:crear'), asyncHandler(async (req, res) => {
  const { nombre, tipo_documento, documento, correo, telefono, roles = ['cliente'], cliente_id, especialidades } = req.body;
  const ahora = new Date();
  const temporal = passwordTemporal();
  const usuario = {
    nombre: String(nombre || '').trim(),
    tipo_documento,
    documento: String(documento || '').trim(),
    correo: String(correo || '').trim().toLowerCase(),
    telefono: telefono ? String(telefono).trim() : null,
    password_hash: await bcrypt.hash(temporal, COSTO_BCRYPT),
    password_temporal: true,
    roles,
    estado: 'activo',
    cliente_id: aIdONull(cliente_id, 'cliente_id'),
    especialidades: Array.isArray(especialidades) ? especialidades : [],
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
  await encolar(usuario, 'cuenta_creada', 'Se creó su cuenta', `Contraseña temporal (cámbiela al ingresar): ${temporal}`);
  await registrar({ req, accion: 'crear_usuario', entidad: 'usuario', documento_id: insertedId, despues: { correo: usuario.correo, roles } });
  res.status(201).json({
    usuario: publico(usuario),
    ...(process.env.MOSTRAR_TOKENS_DEV === 'true' ? { password_temporal_dev: temporal } : {}),
  });
}));

// RQF-09/11: el administrador actualiza datos de un usuario
router.put('/:id', requierePermiso('usuarios:actualizar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const permitidos = ['nombre', 'telefono', 'tipo_documento', 'documento', 'cliente_id', 'especialidades'];
  const set = { fecha_actualizacion: new Date() };
  for (const k of permitidos) if (req.body[k] !== undefined) set[k] = req.body[k];
  if ('cliente_id' in set) set.cliente_id = aIdONull(set.cliente_id, 'cliente_id');
  if (set.especialidades && !set.especialidades.every((e) => CLAVES_MODULOS.includes(e))) throw new HttpError(400, 'Especialidad inválida');
  const antes = await col('usuarios').findOne({ _id }, { projection: { password_hash: 0 } });
  if (!antes) throw new HttpError(404, 'Usuario no encontrado');
  const r = await col('usuarios').findOneAndUpdate({ _id }, { $set: set }, { returnDocument: 'after', projection: { password_hash: 0 } });
  await registrar({ req, accion: 'actualizar_usuario', entidad: 'usuario', documento_id: _id, antes: Object.fromEntries(Object.keys(set).map((k) => [k, antes[k]])), despues: set });
  res.json(r);
}));

// Garantiza que quede al menos un administrador activo (RQF-06)
async function verificarUltimoAdmin(_id) {
  const otros = await col('usuarios').countDocuments({ _id: { $ne: _id }, roles: 'administrador', estado: 'activo' });
  if (otros === 0) throw new HttpError(409, 'Debe existir siempre al menos un Administrador activo');
}

// RQF-06/07: asignar o revocar roles (multi-rol). Invalida las sesiones del usuario (RQF-18)
router.put('/:id/roles', requierePermiso('usuarios:roles'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const { roles, motivo } = req.body;
  if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => ROLES.includes(r))) {
    throw new HttpError(400, `Roles inválidos. Permitidos: ${ROLES.join(', ')}`);
  }
  if (!motivo || String(motivo).trim().length < 5) throw new HttpError(400, 'Indique el motivo del cambio de roles');
  const u = await col('usuarios').findOne({ _id });
  if (!u) throw new HttpError(404, 'Usuario no encontrado');
  if (u.roles.includes('administrador') && !roles.includes('administrador')) await verificarUltimoAdmin(_id);

  await col('usuarios').updateOne({ _id }, { $set: { roles: [...new Set(roles)], fecha_actualizacion: new Date() }, $inc: { token_version: 1 } });
  await registrar({ req, accion: 'cambio_roles', entidad: 'usuario', documento_id: _id, antes: { roles: u.roles }, despues: { roles }, detalle: motivo });
  await encolar(u, 'cambio_rol', 'Sus roles cambiaron', `Nuevos roles: ${roles.join(', ')}`);
  res.json({ mensaje: 'Roles actualizados', roles });
}));

// RQF-08: deshabilitar (borrado lógico) y volver a habilitar
router.patch('/:id/deshabilitar', requierePermiso('usuarios:deshabilitar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const u = await col('usuarios').findOne({ _id });
  if (!u) throw new HttpError(404, 'Usuario no encontrado');
  if (u.roles.includes('administrador')) await verificarUltimoAdmin(_id);
  await col('usuarios').updateOne({ _id }, { $set: { estado: 'inactivo', fecha_actualizacion: new Date() }, $inc: { token_version: 1 } });
  await registrar({ req, accion: 'deshabilitar_usuario', entidad: 'usuario', documento_id: _id, antes: { estado: u.estado }, despues: { estado: 'inactivo' }, detalle: req.body?.motivo });
  res.json({ mensaje: 'Usuario deshabilitado' });
}));

router.patch('/:id/habilitar', requierePermiso('usuarios:deshabilitar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const r = await col('usuarios').findOneAndUpdate({ _id, estado: 'inactivo', anonimizado: { $ne: true } }, { $set: { estado: 'activo', fecha_actualizacion: new Date() } });
  if (!r) throw new HttpError(409, 'El usuario no está inactivo o fue anonimizado');
  await registrar({ req, accion: 'habilitar_usuario', entidad: 'usuario', documento_id: _id, antes: { estado: 'inactivo' }, despues: { estado: 'activo' } });
  res.json({ mensaje: 'Usuario habilitado' });
}));

// RQF-08: anonimizar (conserva _id y trazabilidad, borra datos personales)
router.post('/:id/anonimizar', requierePermiso('usuarios:deshabilitar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const u = await col('usuarios').findOne({ _id });
  if (!u) throw new HttpError(404, 'Usuario no encontrado');
  if (u.roles.includes('administrador')) await verificarUltimoAdmin(_id);
  const sufijo = String(_id).slice(-8);
  await col('usuarios').updateOne({ _id }, {
    $set: {
      nombre: `Usuario anonimizado ${sufijo}`,
      documento: `ANON-${sufijo}`,
      correo: `anonimo-${sufijo}@anonimizado.local`,
      telefono: null,
      password_hash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 4),
      estado: 'inactivo',
      anonimizado: true,
      fecha_actualizacion: new Date(),
    },
    $inc: { token_version: 1 },
  });
  await registrar({ req, accion: 'anonimizar_usuario', entidad: 'usuario', documento_id: _id, detalle: req.body?.motivo });
  res.json({ mensaje: 'Usuario anonimizado' });
}));

// RQF-08: borrado físico solo si no tiene tickets, membresías ni registros de auditoría
router.delete('/:id', requierePermiso('usuarios:deshabilitar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const u = await col('usuarios').findOne({ _id });
  if (!u) throw new HttpError(404, 'Usuario no encontrado');
  const [tickets, auditoria, contacto] = await Promise.all([
    col('tickets').countDocuments({ $or: [{ usuario_id: _id }, { responsable_id: _id }] }),
    col('bitacora').countDocuments({ $or: [{ usuario_id: _id }, { documento_id: _id }] }),
    col('clientes').countDocuments({ contacto_principal_id: _id }),
  ]);
  if (tickets || contacto) throw new HttpError(409, 'El usuario tiene tickets o es contacto de una membresía: use deshabilitar');
  if (auditoria) throw new HttpError(409, 'El usuario tiene registros en la bitácora: use anonimizar', { sugerencia: 'anonimizar' });
  await col('usuarios').deleteOne({ _id });
  await registrar({ req, accion: 'eliminar_usuario', entidad: 'usuario', documento_id: _id, antes: { correo: u.correo } });
  res.json({ mensaje: 'Usuario eliminado' });
}));

module.exports = router;
