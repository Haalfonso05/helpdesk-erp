const { Router } = require('express');
const { col } = require('../config/db');
const C = require('../config/catalogo');
const { asyncHandler, HttpError } = require('../utils/errores');
const { aId, aIdONull, paginar, escaparRegex } = require('../utils/ayudas');
const { requierePermiso } = require('../middlewares/auth');
const { registrar } = require('../services/bitacora');
const { registrarPago, cambiarEstado } = require('../services/membresias');

const router = Router();

// El cliente solo puede ver su propia empresa
function verificarAlcance(req, clienteId) {
  const soloPropio = req.roles.length === 1 && req.roles[0] === 'cliente';
  if (soloPropio && String(req.usuario.cliente_id) !== String(clienteId)) {
    throw new HttpError(403, 'Solo puede consultar su propia empresa');
  }
}

router.get('/', requierePermiso('membresias:consultar'), asyncHandler(async (req, res) => {
  const { estado, plan, modulo, q, pagina, limite, orden } = req.query;
  const f = {};
  if (req.roles.length === 1 && req.roles[0] === 'cliente') f._id = req.usuario.cliente_id || null;
  if (estado) f['membresia.estado'] = estado;
  if (plan) f['membresia.plan'] = plan;
  if (modulo) f['membresia.modulos_contratados'] = modulo;
  if (q) {
    const r = new RegExp(escaparRegex(q), 'i');
    f.$or = [{ razon_social: r }, { nit: r }];
  }
  res.json(await paginar(col('clientes'), f, { pagina, limite, orden: orden || 'razon_social' }));
}));

// Detalle: empresa + usuarios + últimos pagos + historial de estados de la membresía (RQF-14 v1 / C2)
router.get('/:id', requierePermiso('membresias:consultar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  verificarAlcance(req, _id);
  const [cliente] = await col('clientes').aggregate([
    { $match: { _id } },
    { $lookup: { from: 'usuarios', localField: '_id', foreignField: 'cliente_id', as: 'usuarios', pipeline: [{ $project: { nombre: 1, correo: 1, estado: 1, roles: 1 } }] } },
    { $lookup: { from: 'pagos', localField: '_id', foreignField: 'cliente_id', as: 'pagos', pipeline: [{ $sort: { fecha: -1 } }, { $limit: 20 }] } },
  ]).toArray();
  if (!cliente) throw new HttpError(404, 'Cliente no encontrado');
  cliente.historial_membresia = await col('bitacora')
    .find({ entidad: 'membresia', documento_id: _id }, { projection: { fecha: 1, accion: 1, antes: 1, despues: 1, correo: 1, detalle: 1 } })
    .sort({ fecha: -1 }).limit(30).toArray();
  res.json(cliente);
}));

// RQF-12/20: el administrador registra la empresa y su membresía
router.post('/', requierePermiso('membresias:gestionar'), asyncHandler(async (req, res) => {
  const { razon_social, nit, correo, telefono, plan, modulos_contratados, metodo_pago, contacto_principal_id } = req.body;
  const ahora = new Date();
  const renovacion = new Date(ahora);
  renovacion.setMonth(renovacion.getMonth() + 1);
  const doc = {
    razon_social: String(razon_social || '').trim(),
    nit: String(nit || '').trim(),
    correo: String(correo || '').trim().toLowerCase(),
    telefono: String(telefono || '').trim(),
    contacto_principal_id: aIdONull(contacto_principal_id, 'contacto_principal_id'),
    membresia: {
      plan,
      estado: 'activa',
      modulos_contratados: Array.isArray(modulos_contratados) ? modulos_contratados : [],
      ...(metodo_pago ? { metodo_pago } : {}),
      fecha_inicio: ahora,
      fecha_renovacion: renovacion,
      fecha_ultimo_cambio: ahora,
    },
    fecha_creacion: ahora,
  };
  const { insertedId } = await col('clientes').insertOne(doc);
  await registrar({ req, accion: 'crear_cliente', entidad: 'membresia', documento_id: insertedId, despues: { razon_social: doc.razon_social, plan, estado: 'activa' } });
  res.status(201).json({ _id: insertedId, ...doc });
}));

// Actualiza datos, plan, módulos o contacto principal
router.put('/:id', requierePermiso('membresias:gestionar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const set = {};
  for (const k of ['razon_social', 'correo', 'telefono']) if (req.body[k] !== undefined) set[k] = String(req.body[k]).trim();
  if (req.body.plan) set['membresia.plan'] = req.body.plan;
  if (req.body.modulos_contratados) set['membresia.modulos_contratados'] = req.body.modulos_contratados;
  if (req.body.contacto_principal_id !== undefined) {
    const cid = aIdONull(req.body.contacto_principal_id, 'contacto_principal_id');
    if (cid && !(await col('usuarios').findOne({ _id: cid, cliente_id: _id }))) throw new HttpError(400, 'El contacto principal debe ser un usuario de la empresa');
    set.contacto_principal_id = cid;
  }
  const antes = await col('clientes').findOne({ _id });
  if (!antes) throw new HttpError(404, 'Cliente no encontrado');
  const r = await col('clientes').findOneAndUpdate({ _id }, { $set: set }, { returnDocument: 'after' });
  await registrar({ req, accion: 'actualizar_cliente', entidad: 'membresia', documento_id: _id, antes: { plan: antes.membresia.plan, modulos: antes.membresia.modulos_contratados }, despues: set });
  res.json(r);
}));

// RQF-23 / RQF-A5: registrar un pago → transacción (pago + membresía + bitácora)
router.post('/:id/pagos', requierePermiso('membresias:gestionar'), asyncHandler(async (req, res) => {
  const { valor, metodo, estado, referencia, simular_fallo } = req.body;
  if (!C.ESTADOS_PAGO.includes(estado)) throw new HttpError(400, `Estado de pago inválido. Use: ${C.ESTADOS_PAGO.join(', ')}`);
  if (!C.METODOS_PAGO.includes(metodo)) throw new HttpError(400, `Método inválido. Use: ${C.METODOS_PAGO.join(', ')}`);
  if (!(Number(valor) > 0)) throw new HttpError(400, 'El valor debe ser mayor que cero');
  const r = await registrarPago({ req, clienteId: aId(req.params.id), valor, metodo, estado, referencia, simularFallo: !!simular_fallo });
  res.status(201).json(r);
}));

router.get('/:id/pagos', requierePermiso('membresias:consultar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  verificarAlcance(req, _id);
  res.json(await paginar(col('pagos'), { cliente_id: _id }, { ...req.query, orden: '-fecha' }));
}));

// Cambio manual del estado de la membresía (transaccional)
router.patch('/:id/membresia', requierePermiso('membresias:gestionar'), asyncHandler(async (req, res) => {
  const { estado, motivo } = req.body;
  if (!C.ESTADOS_MEMBRESIA.includes(estado)) throw new HttpError(400, `Estado inválido. Use: ${C.ESTADOS_MEMBRESIA.join(', ')}`);
  if (!motivo) throw new HttpError(400, 'Indique el motivo');
  res.json(await cambiarEstado({ req, clienteId: aId(req.params.id), nuevoEstado: estado, motivo }));
}));

module.exports = router;
module.exports.verificarAlcance = verificarAlcance;
