const { Router } = require('express');
const { col } = require('../config/db');
const { asyncHandler, HttpError } = require('../utils/errores');
const { aId, paginar } = require('../utils/ayudas');
const { requierePermiso, tieneRol } = require('../middlewares/auth');
const { registrar } = require('../services/bitacora');
const { MEMBRESIA_CON_SERVICIO } = require('../services/membresias');

const router = Router();
const PROYECCION_LISTA = {
  titulo: 1, modulo: 1, etiquetas: 1, estado: 1, votos_utiles: 1, votos_no_utiles: 1, resoluciones: 1,
  version: 1, fecha_creacion: 1, autor_id: 1, resumen: { $substrCP: ['$contenido', 0, 220] },
};
const soloCliente = (req) => req.roles.length === 1 && req.roles[0] === 'cliente';

// RQF-22: con la membresía suspendida el cliente no consulta la base de conocimientos
async function verificarMembresiaCliente(req) {
  if (!soloCliente(req)) return;
  const cliente = req.usuario.cliente_id ? await col('clientes').findOne({ _id: req.usuario.cliente_id }) : null;
  if (!cliente || !MEMBRESIA_CON_SERVICIO.includes(cliente.membresia.estado)) {
    throw new HttpError(403, 'La base de conocimientos requiere una membresía activa');
  }
}

// Qué artículos puede ver cada rol
function filtroEstado(req) {
  if (tieneRol(req, 'administrador') || tieneRol(req, 'auditor')) return {};
  if (tieneRol(req, 'soporte')) return { $or: [{ estado: 'publicado' }, { autor_id: req.usuario._id }] };
  return { estado: 'publicado' };
}

/**
 * RQF-29: búsqueda en lenguaje natural con el índice de texto en español.
 * Ordena por relevancia ({ $meta: "textScore" }) y permite filtrar por módulo.
 */
router.get('/', requierePermiso('articulos:consultar'), asyncHandler(async (req, res) => {
  await verificarMembresiaCliente(req);
  const { q, modulo, estado, pagina, limite } = req.query;
  const p = Math.max(parseInt(pagina, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limite, 10) || 10, 1), 50);

  const filtro = { $and: [filtroEstado(req)] };
  if (modulo) filtro.$and.push({ modulo });
  if (estado) filtro.$and.push({ estado });

  if (q && String(q).trim()) {
    filtro.$text = { $search: String(q).trim(), $language: 'spanish' };
    const [datos, total] = await Promise.all([
      col('articulos')
        .find(filtro, { projection: { ...PROYECCION_LISTA, puntaje: { $meta: 'textScore' } } })
        .sort({ puntaje: { $meta: 'textScore' } })
        .skip((p - 1) * l).limit(l).toArray(),
      col('articulos').countDocuments(filtro),
    ]);
    return res.json({ datos, paginacion: { total, pagina: p, limite: l, totalPaginas: Math.ceil(total / l) || 1 } });
  }

  const r = await paginar(col('articulos'), filtro, {
    pagina: p, limite: l, orden: '-votos_utiles,-fecha_creacion',
    proyeccion: PROYECCION_LISTA,
  });
  res.json(r);
}));

// RQF-29 / C5: sugerencias automáticas mientras el cliente redacta el ticket
router.get('/sugerencias', requierePermiso('articulos:consultar'), asyncHandler(async (req, res) => {
  const texto = String(req.query.texto || '').trim();
  if (texto.length < 3) return res.json([]);
  try {
    await verificarMembresiaCliente(req);
  } catch {
    return res.json([]);
  }
  const filtro = { $text: { $search: texto, $language: 'spanish' }, estado: 'publicado' };
  if (req.query.modulo) filtro.modulo = req.query.modulo;
  const datos = await col('articulos')
    .find(filtro, { projection: { titulo: 1, modulo: 1, puntaje: { $meta: 'textScore' }, resumen: { $substrCP: ['$contenido', 0, 160] } } })
    .sort({ puntaje: { $meta: 'textScore' } })
    .limit(5).toArray();
  res.json(datos);
}));

router.get('/:id', requierePermiso('articulos:consultar'), asyncHandler(async (req, res) => {
  await verificarMembresiaCliente(req);
  const [a] = await col('articulos').aggregate([
    { $match: { $and: [{ _id: aId(req.params.id) }, filtroEstado(req)] } },
    { $lookup: { from: 'usuarios', localField: 'autor_id', foreignField: '_id', as: 'autor', pipeline: [{ $project: { nombre: 1 } }] } },
    { $lookup: { from: 'usuarios', localField: 'revisor_id', foreignField: '_id', as: 'revisor', pipeline: [{ $project: { nombre: 1 } }] } },
    { $set: { autor: { $first: '$autor.nombre' }, revisor: { $first: '$revisor.nombre' } } },
  ]).toArray();
  if (!a) throw new HttpError(404, 'Artículo no encontrado');
  res.json(a);
}));

const normalizarEtiquetas = (e) =>
  [...new Set((Array.isArray(e) ? e : String(e || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];

// RQF-28: soporte redacta en borrador
router.post('/', requierePermiso('articulos:redactar'), asyncHandler(async (req, res) => {
  const { titulo, modulo, contenido, etiquetas } = req.body;
  const ahora = new Date();
  const doc = {
    titulo: String(titulo || '').trim(),
    modulo,
    contenido: String(contenido || '').trim(),
    etiquetas: normalizarEtiquetas(etiquetas),
    autor_id: req.usuario._id,
    revisor_id: null,
    estado: 'borrador',
    version: 1,
    resoluciones: 0,
    votos_utiles: 0,
    votos_no_utiles: 0,
    fecha_creacion: ahora,
    fecha_actualizacion: ahora,
    fecha_publicacion: null,
  };
  const { insertedId } = await col('articulos').insertOne(doc);
  await registrar({ req, accion: 'crear_articulo', entidad: 'articulo', documento_id: insertedId, despues: { titulo: doc.titulo } });
  res.status(201).json({ _id: insertedId, ...doc });
}));

// Editar: sube la versión. Si soporte edita uno publicado, vuelve a borrador para revisión
router.put('/:id', requierePermiso('articulos:redactar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const a = await col('articulos').findOne({ _id });
  if (!a) throw new HttpError(404, 'Artículo no encontrado');
  const esAdmin = tieneRol(req, 'administrador');
  if (!esAdmin && String(a.autor_id) !== String(req.usuario._id)) throw new HttpError(403, 'Solo puede editar sus propios artículos');

  const set = { fecha_actualizacion: new Date() };
  if (req.body.titulo !== undefined) set.titulo = String(req.body.titulo).trim();
  if (req.body.modulo !== undefined) set.modulo = req.body.modulo;
  if (req.body.contenido !== undefined) set.contenido = String(req.body.contenido).trim();
  if (req.body.etiquetas !== undefined) set.etiquetas = normalizarEtiquetas(req.body.etiquetas);
  if (!esAdmin && a.estado === 'publicado') set.estado = 'borrador';

  const r = await col('articulos').findOneAndUpdate({ _id }, { $set: set, $inc: { version: 1 } }, { returnDocument: 'after' });
  await registrar({ req, accion: 'editar_articulo', entidad: 'articulo', documento_id: _id, antes: { version: a.version, estado: a.estado }, despues: { version: r.version, estado: r.estado } });
  res.json(r);
}));

// RQF-A9: el administrador aprueba y publica / despublica
router.post('/:id/publicar', requierePermiso('articulos:publicar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const r = await col('articulos').findOneAndUpdate(
    { _id, estado: { $ne: 'publicado' } },
    { $set: { estado: 'publicado', revisor_id: req.usuario._id, fecha_publicacion: new Date(), fecha_actualizacion: new Date() } },
    { returnDocument: 'after' }
  );
  if (!r) throw new HttpError(409, 'El artículo no existe o ya está publicado');
  await registrar({ req, accion: 'publicar_articulo', entidad: 'articulo', documento_id: _id, despues: { estado: 'publicado' } });
  res.json(r);
}));

router.post('/:id/despublicar', requierePermiso('articulos:publicar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  const r = await col('articulos').findOneAndUpdate({ _id, estado: 'publicado' }, { $set: { estado: 'despublicado', fecha_actualizacion: new Date() } }, { returnDocument: 'after' });
  if (!r) throw new HttpError(409, 'El artículo no está publicado');
  await registrar({ req, accion: 'despublicar_articulo', entidad: 'articulo', documento_id: _id, despues: { estado: 'despublicado' } });
  res.json(r);
}));

// RQF-28: nunca se elimina si un ticket lo referencia
router.delete('/:id', requierePermiso('articulos:publicar'), asyncHandler(async (req, res) => {
  const _id = aId(req.params.id);
  if (await col('tickets').countDocuments({ articulo_solucion_id: _id })) {
    throw new HttpError(409, 'El artículo está vinculado a tickets: solo puede despublicarse');
  }
  const r = await col('articulos').findOneAndDelete({ _id });
  if (!r) throw new HttpError(404, 'Artículo no encontrado');
  await registrar({ req, accion: 'eliminar_articulo', entidad: 'articulo', documento_id: _id, antes: { titulo: r.titulo } });
  res.json({ mensaje: 'Artículo eliminado' });
}));

// RQF-30: el cliente vota si el artículo le fue útil
router.post('/:id/votar', requierePermiso('articulos:votar'), asyncHandler(async (req, res) => {
  const campo = req.body.util === false ? 'votos_no_utiles' : 'votos_utiles';
  const r = await col('articulos').findOneAndUpdate({ _id: aId(req.params.id), estado: 'publicado' }, { $inc: { [campo]: 1 } }, { returnDocument: 'after', projection: { votos_utiles: 1, votos_no_utiles: 1 } });
  if (!r) throw new HttpError(404, 'Artículo no encontrado');
  res.json(r);
}));

module.exports = router;
