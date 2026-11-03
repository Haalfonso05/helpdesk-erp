const { Router } = require('express');
const { ObjectId } = require('mongodb');
const { col } = require('../config/db');
const C = require('../config/catalogo');
const { asyncHandler, HttpError } = require('../utils/errores');
const { aId, aIdONull, paginar, escaparRegex, limpiarDetalle } = require('../utils/ayudas');
const { requierePermiso, tieneRol } = require('../middlewares/auth');
const { registrar } = require('../services/bitacora');
const { encolar } = require('../services/notificaciones');
const { calcularPrioridad, calcularSla, estadoSla, siguienteCodigo } = require('../services/tickets');
const { MEMBRESIA_CON_SERVICIO } = require('../services/membresias');

const router = Router();
const DIA = 24 * 3600e3;
const esStaff = (req) => tieneRol(req, 'soporte') || tieneRol(req, 'administrador');

/**
 * RQF-14: visibilidad por rol (se arma un $or con lo que cada rol del usuario puede ver)
 *  - Administrador y Auditor: todo
 *  - Soporte: asignados a él + cola sin asignar de sus módulos de especialidad
 *  - Cliente: los suyos (o los de toda su empresa si es contacto principal)
 */
async function filtroVisibilidad(req) {
  if (tieneRol(req, 'administrador') || tieneRol(req, 'auditor')) return {};
  const u = req.usuario;
  const partes = [];
  if (tieneRol(req, 'soporte')) {
    const cola = { responsable_id: null };
    if (u.especialidades?.length) cola.modulo = { $in: u.especialidades };
    partes.push({ responsable_id: u._id }, cola);
  }
  if (tieneRol(req, 'cliente')) {
    const cliente = u.cliente_id ? await col('clientes').findOne({ _id: u.cliente_id }, { projection: { contacto_principal_id: 1 } }) : null;
    const principal = cliente && String(cliente.contacto_principal_id) === String(u._id);
    partes.push(principal ? { cliente_id: u.cliente_id } : { usuario_id: u._id });
  }
  return partes.length ? { $or: partes } : { _id: null };
}

async function obtenerVisible(req, id) {
  const t = await col('tickets').findOne({ $and: [{ _id: aId(id) }, await filtroVisibilidad(req)] });
  if (!t) throw new HttpError(404, 'Ticket no encontrado o sin acceso');
  return t;
}

// El cliente no ve los comentarios internos (RQF-26)
function paraRespuesta(req, t) {
  const r = { ...t, estado_sla: estadoSla(t) };
  if (!esStaff(req) && !tieneRol(req, 'auditor')) {
    r.comentarios = (t.comentarios || []).filter((c) => c.visibilidad === 'publico');
  }
  return r;
}

async function notificarCreador(t, tipo, asunto, cuerpo) {
  const u = await col('usuarios').findOne({ _id: t.usuario_id });
  if (u) await encolar(u, tipo, `[${t.codigo}] ${asunto}`, cuerpo || t.asunto);
}

// ─────────────────────────── Consultas ───────────────────────────

// RQF-24 (v1) / C4 / S1: listado con filtros por módulo, estado, prioridad, cliente, responsable y fechas
router.get('/', requierePermiso('tickets:consultar'), asyncHandler(async (req, res) => {
  const { modulo, estado, prioridad, tipo, cliente_id, responsable_id, sin_asignar, desde, hasta, q, pagina, limite, orden } = req.query;
  const f = {};
  if (modulo) f.modulo = { $in: String(modulo).split(',') };
  if (estado) f.estado = { $in: String(estado).split(',') };
  if (prioridad) f.prioridad = { $in: String(prioridad).split(',') };
  if (tipo) f.tipo = tipo;
  if (cliente_id) f.cliente_id = aId(cliente_id, 'cliente_id');
  if (responsable_id) f.responsable_id = responsable_id === 'yo' ? req.usuario._id : aId(responsable_id, 'responsable_id');
  if (sin_asignar === 'true') f.responsable_id = null;
  if (desde || hasta) {
    f.fecha_creacion = {};
    if (desde) f.fecha_creacion.$gte = new Date(desde);
    if (hasta) f.fecha_creacion.$lte = new Date(`${hasta}T23:59:59.999Z`);
  }
  if (q) {
    const r = new RegExp(escaparRegex(q), 'i');
    f.$or = [{ codigo: r }, { asunto: r }];
  }
  const filtro = { $and: [f, await filtroVisibilidad(req)] };
  const resultado = await paginar(col('tickets'), filtro, {
    pagina, limite, orden,
    proyeccion: { comentarios: 0, historial_estados: 0, 'detalle.log_api': 0 },
  });
  // Nombres de empresa y responsable para la tabla
  const clientes = await col('clientes').find({ _id: { $in: [...new Set(resultado.datos.map((t) => t.cliente_id))] } }, { projection: { razon_social: 1 } }).toArray();
  const responsables = await col('usuarios').find({ _id: { $in: resultado.datos.map((t) => t.responsable_id).filter(Boolean) } }, { projection: { nombre: 1 } }).toArray();
  const nom = (lista, id, campo) => lista.find((x) => String(x._id) === String(id))?.[campo] || null;
  resultado.datos = resultado.datos.map((t) => ({
    ...t,
    estado_sla: estadoSla(t),
    cliente: nom(clientes, t.cliente_id, 'razon_social'),
    responsable: nom(responsables, t.responsable_id, 'nombre'),
  }));
  res.json(resultado);
}));

// Detalle con $lookup de cliente, creador, responsable y artículo de solución
router.get('/:id', requierePermiso('tickets:consultar'), asyncHandler(async (req, res) => {
  const t = await obtenerVisible(req, req.params.id);
  const [extra] = await col('tickets').aggregate([
    { $match: { _id: t._id } },
    { $lookup: { from: 'clientes', localField: 'cliente_id', foreignField: '_id', as: 'cliente', pipeline: [{ $project: { razon_social: 1, nit: 1, membresia: 1 } }] } },
    { $lookup: { from: 'usuarios', localField: 'usuario_id', foreignField: '_id', as: 'creador', pipeline: [{ $project: { nombre: 1, correo: 1 } }] } },
    { $lookup: { from: 'usuarios', localField: 'responsable_id', foreignField: '_id', as: 'responsable', pipeline: [{ $project: { nombre: 1, correo: 1 } }] } },
    { $lookup: { from: 'articulos', localField: 'articulo_solucion_id', foreignField: '_id', as: 'articulo', pipeline: [{ $project: { titulo: 1 } }] } },
    { $project: { cliente: { $first: '$cliente' }, creador: { $first: '$creador' }, responsable: { $first: '$responsable' }, articulo: { $first: '$articulo' } } },
  ]).toArray();
  res.json({ ...paraRespuesta(req, t), ...extra, transiciones_posibles: C.TRANSICIONES[t.estado] });
}));

// RQF-S4: historial de tickets anteriores del mismo cliente corporativo (contexto para soporte)
router.get('/:id/historial-cliente', requierePermiso('tickets:tomar'), asyncHandler(async (req, res) => {
  const t = await obtenerVisible(req, req.params.id);
  const previos = await col('tickets')
    .find({ cliente_id: t.cliente_id, _id: { $ne: t._id } }, { projection: { codigo: 1, asunto: 1, modulo: 1, estado: 1, fecha_creacion: 1 } })
    .sort({ fecha_creacion: -1 }).limit(20).toArray();
  res.json(previos);
}));

// ─────────────────────────── Creación ───────────────────────────

// RQF-13 / C3: crear ticket (cliente verificado, membresía con servicio y módulo contratado)
router.post('/', requierePermiso('tickets:crear'), asyncHandler(async (req, res) => {
  const { modulo, tipo = 'problematica', asunto, descripcion, canal = 'web', severidad = 'media', detalle, ticket_origen_id } = req.body;
  const u = req.usuario;
  const actuaComoCliente = tieneRol(req, 'cliente') && !tieneRol(req, 'administrador');

  if (actuaComoCliente && u.estado !== 'activo') throw new HttpError(403, 'Debe verificar su cuenta antes de crear tickets');
  const clienteId = actuaComoCliente ? u.cliente_id : aId(req.body.cliente_id || u.cliente_id, 'cliente_id');
  if (!clienteId) throw new HttpError(400, 'Su usuario no está asociado a ningún cliente corporativo');

  const cliente = await col('clientes').findOne({ _id: clienteId });
  if (!cliente) throw new HttpError(404, 'Cliente corporativo no encontrado');
  if (!MEMBRESIA_CON_SERVICIO.includes(cliente.membresia.estado)) {
    throw new HttpError(403, `La membresía está ${cliente.membresia.estado}: no se pueden crear tickets nuevos`);
  }
  if (!C.CLAVES_MODULOS.includes(modulo)) throw new HttpError(400, 'Seleccione un módulo válido');
  if (!cliente.membresia.modulos_contratados.includes(modulo)) {
    throw new HttpError(403, `El módulo ${C.MODULOS[modulo].nombre} no está contratado por su empresa`);
  }
  if (!C.SEVERIDADES.includes(severidad)) throw new HttpError(400, 'Severidad inválida');

  // Ticket nuevo enlazado a uno cerrado (cuando ya no se puede reabrir, RQF-24)
  const origen = aIdONull(ticket_origen_id, 'ticket_origen_id');
  if (origen && !(await col('tickets').findOne({ _id: origen, cliente_id: clienteId }))) throw new HttpError(400, 'Ticket de origen inválido');

  const ahora = new Date();
  const prioridad = calcularPrioridad(severidad, cliente.membresia.plan);
  const ticket = {
    codigo: await siguienteCodigo(),
    cliente_id: clienteId,
    usuario_id: u._id,
    modulo,
    tipo,
    asunto: String(asunto || '').trim(),
    descripcion: String(descripcion || '').trim(),
    canal,
    severidad,
    prioridad,
    estado: 'nuevo',
    responsable_id: null,
    membresia: { plan: cliente.membresia.plan, estado: cliente.membresia.estado },
    detalle: limpiarDetalle(modulo, detalle), // la forma final la valida MongoDB con oneOf
    sla: calcularSla(prioridad, ahora),
    historial_estados: [{ de: null, a: 'nuevo', fecha: ahora, usuario_id: u._id }],
    comentarios: [],
    articulo_solucion_id: null,
    reaperturas: 0,
    ticket_origen_id: origen,
    fecha_creacion: ahora,
    fecha_actualizacion: ahora,
    fecha_primera_respuesta: null,
    fecha_resolucion: null,
    fecha_cierre: null,
  };
  const { insertedId } = await col('tickets').insertOne(ticket);
  ticket._id = insertedId;

  await registrar({ req, accion: 'crear_ticket', entidad: 'ticket', documento_id: insertedId, despues: { codigo: ticket.codigo, modulo, prioridad } });
  await encolar(u, 'ticket_creado', `[${ticket.codigo}] Recibimos su ticket`, ticket.asunto);
  // Avisar a los agentes de soporte con esa especialidad
  const agentes = await col('usuarios').find({ roles: 'soporte', estado: 'activo', $or: [{ especialidades: modulo }, { especialidades: { $size: 0 } }] }).toArray();
  await Promise.all(agentes.map((a) => encolar(a, 'ticket_nuevo_cola', `[${ticket.codigo}] Nuevo ticket en ${C.MODULOS[modulo].nombre}`, ticket.asunto)));

  res.status(201).json(paraRespuesta(req, ticket));
}));

// ─────────────────────── Máquina de estados ───────────────────────

/**
 * Aplica una transición validando RQF-24. Usa el estado actual en el filtro del updateOne
 * (control de concurrencia optimista): si alguien lo cambió antes, no se pisa.
 */
async function transicionar(req, t, nuevo, { nota, setExtra = {}, incExtra } = {}) {
  const permitidas = C.TRANSICIONES[t.estado] || [];
  if (!permitidas.includes(nuevo)) {
    throw new HttpError(409, `Transición no permitida: ${t.estado} → ${nuevo}. Permitidas: ${permitidas.join(', ') || 'ninguna'}`);
  }
  const ahora = new Date();
  const set = { estado: nuevo, fecha_actualizacion: ahora, ...setExtra };
  const inc = { ...(incExtra || {}) };

  // RQF-25: el tiempo en "en_espera_cliente" no cuenta para el SLA
  if (nuevo === 'en_espera_cliente') set['sla.pausado_desde'] = ahora;
  if (t.estado === 'en_espera_cliente' && t.sla.pausado_desde) {
    const pausaMs = ahora - new Date(t.sla.pausado_desde);
    set['sla.pausado_desde'] = null;
    set['sla.vence_respuesta'] = new Date(new Date(t.sla.vence_respuesta).getTime() + pausaMs);
    set['sla.vence_resolucion'] = new Date(new Date(t.sla.vence_resolucion).getTime() + pausaMs);
    inc['sla.minutos_pausa'] = Math.round(pausaMs / 60000);
  }
  if (nuevo === 'resuelto') set.fecha_resolucion = ahora;
  if (nuevo === 'cerrado') set.fecha_cierre = ahora;
  if (nuevo === 'reabierto') {
    set.fecha_cierre = null;
    set.fecha_resolucion = null;
  }
  if (esStaff(req) && !t.fecha_primera_respuesta && String(t.usuario_id) !== String(req.usuario._id)) set.fecha_primera_respuesta = ahora;

  const update = {
    $set: set,
    $push: { historial_estados: { de: t.estado, a: nuevo, fecha: ahora, usuario_id: req.usuario._id, ...(nota ? { nota } : {}) } },
  };
  if (Object.keys(inc).length) update.$inc = inc;

  const r = await col('tickets').findOneAndUpdate({ _id: t._id, estado: t.estado }, update, { returnDocument: 'after' });
  if (!r) throw new HttpError(409, 'El ticket fue modificado por otra persona; recargue e intente de nuevo');

  await registrar({ req, accion: 'cambio_estado_ticket', entidad: 'ticket', documento_id: t._id, antes: { estado: t.estado }, despues: { estado: nuevo, ...setExtra }, detalle: nota });
  await notificarCreador(r, 'ticket_cambio_estado', `Su ticket pasó a "${nuevo}"`, nota);
  return r;
}

// Cambiar estado (soporte/admin: según la máquina; cliente: solo confirmar o reabrir)
router.post('/:id/estado', requierePermiso('tickets:estado'), asyncHandler(async (req, res) => {
  const { estado, nota } = req.body;
  const t = await obtenerVisible(req, req.params.id);

  if (!esStaff(req)) {
    // RQF-C7: el cliente confirma (resuelto → cerrado) o rechaza/reabre
    if (!['cerrado', 'reabierto'].includes(estado)) throw new HttpError(403, 'El cliente solo puede confirmar la solución o reabrir el ticket');
    if (estado === 'cerrado' && t.estado !== 'resuelto') throw new HttpError(409, 'Solo puede confirmar tickets resueltos');
  }
  if (estado === 'asignado') throw new HttpError(400, 'Use "tomar" o "asignar" para asignar un responsable');
  if (estado === 'escalado') throw new HttpError(400, 'Use "escalar" e indique el motivo');
  if (['en_proceso', 'en_espera_cliente', 'resuelto'].includes(estado) && !t.responsable_id) {
    throw new HttpError(409, 'El ticket debe tener un responsable antes de trabajarlo');
  }
  if (tieneRol(req, 'soporte') && !tieneRol(req, 'administrador') && t.responsable_id && String(t.responsable_id) !== String(req.usuario._id)) {
    throw new HttpError(403, 'Solo el responsable del ticket puede cambiar su estado');
  }

  let opciones = { nota };
  if (estado === 'reabierto') {
    // RQF-24: un cerrado se reabre una sola vez y dentro de los 15 días siguientes
    if (t.estado === 'cerrado') {
      const dias = (Date.now() - new Date(t.fecha_cierre)) / DIA;
      if (t.reaperturas >= 1 || dias > C.DIAS_PLAZO_REAPERTURA) {
        throw new HttpError(409, 'Este ticket ya no puede reabrirse (plazo de 15 días vencido o ya fue reabierto). Cree un ticket nuevo enlazado.', { crear_enlazado: true });
      }
    }
    if (t.reaperturas >= 1) throw new HttpError(409, 'El ticket ya fue reabierto una vez. Cree un ticket nuevo enlazado.', { crear_enlazado: true });
    opciones = { nota, incExtra: { reaperturas: 1 } };
  }
  const r = await transicionar(req, t, estado, opciones);
  res.json(paraRespuesta(req, r));
}));

// RQF-S2: el agente de soporte toma un ticket de la cola
router.post('/:id/tomar', requierePermiso('tickets:tomar'), asyncHandler(async (req, res) => {
  const t = await obtenerVisible(req, req.params.id);
  if (t.responsable_id) throw new HttpError(409, 'El ticket ya tiene responsable');
  const r = await transicionar(req, t, 'asignado', { setExtra: { responsable_id: req.usuario._id }, nota: `Tomado por ${req.usuario.nombre}` });
  res.json(paraRespuesta(req, r));
}));

// RQF-A4: el administrador asigna o reasigna
router.put('/:id/asignar', requierePermiso('tickets:reasignar'), asyncHandler(async (req, res) => {
  const t = await obtenerVisible(req, req.params.id);
  const responsable = await col('usuarios').findOne({ _id: aId(req.body.responsable_id, 'responsable_id'), roles: 'soporte', estado: 'activo' });
  if (!responsable) throw new HttpError(400, 'El responsable debe ser un agente de soporte activo');
  const ahora = new Date();
  const nota = `Asignado a ${responsable.nombre}${req.body.nota ? `: ${req.body.nota}` : ''}`;

  let r;
  if ((C.TRANSICIONES[t.estado] || []).includes('asignado')) {
    r = await transicionar(req, t, 'asignado', { setExtra: { responsable_id: responsable._id }, nota });
  } else {
    // Reasignación sin cambiar de estado (p. ej. un ticket en_proceso pasa a otro agente)
    r = await col('tickets').findOneAndUpdate(
      { _id: t._id },
      { $set: { responsable_id: responsable._id, fecha_actualizacion: ahora }, $push: { historial_estados: { de: t.estado, a: t.estado, fecha: ahora, usuario_id: req.usuario._id, nota } } },
      { returnDocument: 'after' }
    );
    await registrar({ req, accion: 'reasignar_ticket', entidad: 'ticket', documento_id: t._id, antes: { responsable_id: t.responsable_id }, despues: { responsable_id: responsable._id } });
  }
  await encolar(responsable, 'ticket_asignado', `[${t.codigo}] Se le asignó un ticket`, t.asunto);
  res.json(paraRespuesta(req, r));
}));

// RQF-27: escalar con motivo obligatorio (no reinicia el SLA)
router.post('/:id/escalar', requierePermiso('tickets:escalar'), asyncHandler(async (req, res) => {
  const { motivo } = req.body;
  if (!motivo || String(motivo).trim().length < 5) throw new HttpError(400, 'El motivo del escalamiento es obligatorio');
  const t = await obtenerVisible(req, req.params.id);
  const r = await transicionar(req, t, 'escalado', {
    nota: motivo,
    setExtra: { escalamiento: { motivo: String(motivo).trim(), fecha: new Date(), por: req.usuario._id } },
  });
  const admins = await col('usuarios').find({ roles: 'administrador', estado: 'activo' }).toArray();
  await Promise.all(admins.map((a) => encolar(a, 'ticket_escalado', `[${t.codigo}] Ticket escalado`, motivo)));
  res.json(paraRespuesta(req, r));
}));

// ─────────────────────── Comentarios, solución y calificación ───────────────────────

// RQF-26: comentarios públicos o internos (embebidos en el ticket)
router.post('/:id/comentarios', requierePermiso('tickets:comentar'), asyncHandler(async (req, res) => {
  const { texto, visibilidad = 'publico' } = req.body;
  if (!texto || !String(texto).trim()) throw new HttpError(400, 'El comentario no puede estar vacío');
  if (visibilidad === 'interno' && !esStaff(req)) throw new HttpError(403, 'Solo soporte y administración pueden dejar comentarios internos');
  const t = await obtenerVisible(req, req.params.id);
  if (t.estado === 'cerrado') throw new HttpError(409, 'El ticket está cerrado (solo lectura)');

  const ahora = new Date();
  const comentario = { _id: new ObjectId(), usuario_id: req.usuario._id, autor: req.usuario.nombre, texto: String(texto).trim(), visibilidad, fecha: ahora };
  const set = { fecha_actualizacion: ahora };
  if (esStaff(req) && visibilidad === 'publico' && !t.fecha_primera_respuesta) set.fecha_primera_respuesta = ahora;
  await col('tickets').updateOne({ _id: t._id }, { $push: { comentarios: comentario }, $set: set });

  if (visibilidad === 'publico' && String(t.usuario_id) !== String(req.usuario._id)) {
    await notificarCreador(t, 'ticket_comentario', 'Tiene una nueva respuesta', comentario.texto.slice(0, 200));
  }
  res.status(201).json(comentario);
}));

// RQF-25 (v1) / RQF-30: vincular el artículo que resolvió el ticket
router.put('/:id/articulo', requierePermiso('tickets:tomar'), asyncHandler(async (req, res) => {
  const t = await obtenerVisible(req, req.params.id);
  const articuloId = aId(req.body.articulo_id, 'articulo_id');
  const articulo = await col('articulos').findOne({ _id: articuloId, estado: 'publicado' });
  if (!articulo) throw new HttpError(400, 'El artículo debe existir y estar publicado');
  if (String(t.articulo_solucion_id) === String(articuloId)) return res.json({ mensaje: 'Ya estaba vinculado' });

  await col('tickets').updateOne({ _id: t._id }, { $set: { articulo_solucion_id: articuloId, fecha_actualizacion: new Date() } });
  await col('articulos').updateOne({ _id: articuloId }, { $inc: { resoluciones: 1 } });
  if (t.articulo_solucion_id) await col('articulos').updateOne({ _id: t.articulo_solucion_id, resoluciones: { $gt: 0 } }, { $inc: { resoluciones: -1 } });
  await registrar({ req, accion: 'vincular_articulo', entidad: 'ticket', documento_id: t._id, antes: { articulo: t.articulo_solucion_id }, despues: { articulo: articuloId } });
  res.json({ mensaje: 'Artículo vinculado', articulo: { _id: articuloId, titulo: articulo.titulo } });
}));

// RQF-C8: calificar la atención al cerrarse
router.post('/:id/calificar', requierePermiso('tickets:calificar'), asyncHandler(async (req, res) => {
  const puntaje = Number(req.body.puntaje);
  if (!Number.isInteger(puntaje) || puntaje < 1 || puntaje > 5) throw new HttpError(400, 'El puntaje debe ser un entero de 1 a 5');
  const t = await obtenerVisible(req, req.params.id);
  if (!['resuelto', 'cerrado'].includes(t.estado)) throw new HttpError(409, 'Solo se califican tickets resueltos o cerrados');
  if (t.calificacion) throw new HttpError(409, 'Este ticket ya fue calificado');
  const calificacion = { puntaje, fecha: new Date(), ...(req.body.comentario ? { comentario: String(req.body.comentario) } : {}) };
  await col('tickets').updateOne({ _id: t._id }, { $set: { calificacion } });
  res.json({ mensaje: '¡Gracias por calificar!', calificacion });
}));

module.exports = router;
module.exports.filtroVisibilidad = filtroVisibilidad;
