/**
 * RQF-A6: reportes analíticos con el Framework de Agregación de MongoDB.
 * Cada función devuelve el pipeline para poder mostrarlo también en la sustentación.
 * Etapas usadas: $match, $group, $lookup, $project, $sort, $unwind, $facet, $addFields.
 */
const { col } = require('../config/db');
const { ESTADOS_ABIERTOS, MODULOS } = require('../config/catalogo');

// Filtro común: rango de fechas y (opcional) un responsable
function filtroBase({ desde, hasta, responsableId } = {}) {
  const m = {};
  if (desde || hasta) {
    m.fecha_creacion = {};
    if (desde) m.fecha_creacion.$gte = new Date(desde);
    if (hasta) m.fecha_creacion.$lte = new Date(`${hasta}T23:59:59.999Z`);
  }
  if (responsableId) m.responsable_id = responsableId;
  return m;
}

// Horas de resolución descontando el tiempo en espera del cliente
const horasResolucion = {
  $divide: [
    { $subtract: [{ $subtract: ['$fecha_resolucion', '$fecha_creacion'] }, { $multiply: [{ $ifNull: ['$sla.minutos_pausa', 0] }, 60000] }] },
    3600000,
  ],
};

const pipelines = {
  // 1. ¿Qué módulo del ERP falla más? ($match + $group + $sort + $project)
  modulosIncidencias: (f) => [
    { $match: { ...filtroBase(f), tipo: 'problematica' } },
    {
      $group: {
        _id: '$modulo',
        total: { $sum: 1 },
        abiertos: { $sum: { $cond: [{ $in: ['$estado', ESTADOS_ABIERTOS] }, 1, 0] } },
        criticos: { $sum: { $cond: [{ $eq: ['$prioridad', 'critica'] }, 1, 0] } },
      },
    },
    { $sort: { total: -1 } },
    { $project: { _id: 0, modulo: '$_id', total: 1, abiertos: 1, criticos: 1 } },
  ],

  // 2. Tiempo medio de resolución por agente ($lookup a usuarios)
  tiempoPorAgente: (f) => [
    { $match: { fecha_resolucion: { $ne: null }, responsable_id: { $ne: null }, ...filtroBase(f) } },
    { $group: { _id: '$responsable_id', tickets: { $sum: 1 }, horas_promedio: { $avg: horasResolucion } } },
    { $lookup: { from: 'usuarios', localField: '_id', foreignField: '_id', as: 'agente' } },
    { $unwind: '$agente' },
    { $project: { _id: 0, agente_id: '$_id', agente: '$agente.nombre', tickets: 1, horas_promedio: { $round: ['$horas_promedio', 1] } } },
    { $sort: { horas_promedio: 1 } },
  ],

  // 3. Tiempo medio de resolución por plan de membresía ($lookup a clientes)
  tiempoPorPlan: (f) => [
    { $match: { ...filtroBase(f), fecha_resolucion: { $ne: null } } },
    { $lookup: { from: 'clientes', localField: 'cliente_id', foreignField: '_id', as: 'cliente', pipeline: [{ $project: { 'membresia.plan': 1 } }] } },
    { $unwind: '$cliente' },
    { $group: { _id: '$cliente.membresia.plan', tickets: { $sum: 1 }, horas_promedio: { $avg: horasResolucion } } },
    { $project: { _id: 0, plan: '$_id', tickets: 1, horas_promedio: { $round: ['$horas_promedio', 1] } } },
    { $sort: { horas_promedio: 1 } },
  ],

  // 4. Tasa de reapertura (sobre los tickets que llegaron a resolverse)
  tasaReapertura: (f) => [
    { $match: { ...filtroBase(f), $or: [{ fecha_resolucion: { $ne: null } }, { reaperturas: { $gt: 0 } }, { estado: 'cerrado' }] } },
    { $group: { _id: null, resueltos: { $sum: 1 }, reabiertos: { $sum: { $cond: [{ $gt: ['$reaperturas', 0] }, 1, 0] } } } },
    { $project: { _id: 0, resueltos: 1, reabiertos: 1, tasa: { $round: [{ $multiply: [{ $cond: [{ $eq: ['$resueltos', 0] }, 0, { $divide: ['$reabiertos', '$resueltos'] }] }, 100] }, 1] } } },
  ],

  // 5. Cumplimiento de acuerdos de servicio por prioridad
  cumplimientoSla: (f) => [
    { $match: filtroBase(f) },
    {
      $addFields: {
        resultado_sla: {
          $switch: {
            branches: [
              { case: { $ne: ['$fecha_resolucion', null] }, then: { $cond: [{ $lte: ['$fecha_resolucion', '$sla.vence_resolucion'] }, 'cumplido', 'incumplido'] } },
              { case: { $and: [{ $in: ['$estado', ESTADOS_ABIERTOS] }, { $lt: ['$sla.vence_resolucion', '$$NOW'] }, { $eq: ['$sla.pausado_desde', null] }] }, then: 'incumplido' },
            ],
            default: 'en_curso',
          },
        },
      },
    },
    {
      $group: {
        _id: '$prioridad',
        total: { $sum: 1 },
        cumplidos: { $sum: { $cond: [{ $eq: ['$resultado_sla', 'cumplido'] }, 1, 0] } },
        incumplidos: { $sum: { $cond: [{ $eq: ['$resultado_sla', 'incumplido'] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0, prioridad: '$_id', total: 1, cumplidos: 1, incumplidos: 1,
        porcentaje: { $round: [{ $multiply: [{ $cond: [{ $eq: [{ $add: ['$cumplidos', '$incumplidos'] }, 0] }, 0, { $divide: ['$cumplidos', { $add: ['$cumplidos', '$incumplidos'] }] }] }, 100] }, 1] },
      },
    },
    { $sort: { porcentaje: 1 } },
  ],

  // 6. Efectividad de los artículos de la base de conocimientos ($lookup a tickets)
  efectividadArticulos: () => [
    { $match: { estado: 'publicado' } },
    { $lookup: { from: 'tickets', localField: '_id', foreignField: 'articulo_solucion_id', as: 'tickets', pipeline: [{ $project: { reaperturas: 1 } }] } },
    {
      $project: {
        _id: 0, articulo_id: '$_id', titulo: 1, modulo: 1,
        tickets_resueltos: { $size: '$tickets' },
        votos_utiles: 1, votos_no_utiles: 1,
        utilidad: {
          $round: [{ $multiply: [{ $cond: [{ $eq: [{ $add: ['$votos_utiles', '$votos_no_utiles'] }, 0] }, 0, { $divide: ['$votos_utiles', { $add: ['$votos_utiles', '$votos_no_utiles'] }] }] }, 100] }, 1],
        },
      },
    },
    { $sort: { tickets_resueltos: -1, utilidad: -1 } },
    { $limit: 15 },
  ],

  // Tablero: varios conteos en una sola pasada con $facet
  tablero: (f) => [
    { $match: filtroBase(f) },
    {
      $facet: {
        porEstado: [{ $group: { _id: '$estado', total: { $sum: 1 } } }, { $sort: { total: -1 } }],
        porPrioridad: [{ $group: { _id: '$prioridad', total: { $sum: 1 } } }],
        porTipo: [{ $group: { _id: '$tipo', total: { $sum: 1 } } }],
        porMes: [
          { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$fecha_creacion' } }, total: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $limit: 12 },
        ],
        calificacion: [{ $match: { calificacion: { $exists: true } } }, { $group: { _id: null, promedio: { $avg: '$calificacion.puntaje' }, total: { $sum: 1 } } }],
        totales: [{ $group: { _id: null, total: { $sum: 1 }, abiertos: { $sum: { $cond: [{ $in: ['$estado', ESTADOS_ABIERTOS] }, 1, 0] } } } }],
      },
    },
  ],
};

const COLECCION = { efectividadArticulos: 'articulos' };

async function ejecutar(nombre, filtros) {
  const pipeline = pipelines[nombre](filtros);
  const datos = await col(COLECCION[nombre] || 'tickets').aggregate(pipeline).toArray();
  if (nombre === 'modulosIncidencias') datos.forEach((d) => { d.nombre = MODULOS[d.modulo]?.nombre || d.modulo; });
  return { datos, pipeline, coleccion: COLECCION[nombre] || 'tickets' };
}

module.exports = { pipelines, ejecutar };
