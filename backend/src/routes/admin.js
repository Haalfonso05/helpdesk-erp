/**
 * RQF-A7: revisión de índices y planes de ejecución (.explain("executionStats")).
 */
const { Router } = require('express');
const { col } = require('../config/db');
const { asyncHandler, HttpError } = require('../utils/errores');
const { requierePermiso } = require('../middlewares/auth');
const { ejecutarTareas } = require('../services/tareas');
const { ESTADOS_ABIERTOS } = require('../config/catalogo');
const { registrar } = require('../services/bitacora');

const router = Router();

const COLECCIONES = ['usuarios', 'clientes', 'pagos', 'tickets', 'articulos', 'bitacora', 'notificaciones', 'tokens'];

router.get('/indices', requierePermiso('indices:configurar'), asyncHandler(async (_req, res) => {
  const r = {};
  for (const c of COLECCIONES) {
    const [indices, stats] = await Promise.all([
      col(c).indexes(),
      col(c).aggregate([{ $indexStats: {} }]).toArray().catch(() => []),
    ]);
    r[c] = indices.map((i) => ({
      nombre: i.name,
      llaves: i.key,
      unico: !!i.unique,
      parcial: i.partialFilterExpression || null,
      ttl: i.expireAfterSeconds ?? null,
      idioma: i.default_language || null,
      usos: stats.find((s) => s.name === i.name)?.accesses?.ops ?? null,
    }));
  }
  res.json(r);
}));

// Consultas de ejemplo para demostrar cada índice
async function consultasDemo() {
  const t = await col('tickets').findOne({ responsable_id: { $ne: null } });
  const clienteId = t?.cliente_id;
  const responsableId = t?.responsable_id;
  return {
    tickets_cliente_estado: {
      descripcion: 'Tickets de un cliente por estado, más recientes primero (índice compuesto cliente_estado_fecha)',
      mongosh: 'db.tickets.find({ cliente_id: ObjectId("…"), estado: "nuevo" }).sort({ fecha_creacion: -1 }).explain("executionStats")',
      ejecutar: () => col('tickets').find({ cliente_id: clienteId, estado: 'nuevo' }).sort({ fecha_creacion: -1 }).explain('executionStats'),
    },
    tickets_responsable: {
      descripcion: 'Tickets en proceso de un agente (índice compuesto responsable_estado)',
      mongosh: 'db.tickets.find({ responsable_id: ObjectId("…"), estado: "en_proceso" }).explain("executionStats")',
      ejecutar: () => col('tickets').find({ responsable_id: responsableId, estado: 'en_proceso' }).explain('executionStats'),
    },
    cola_abiertos: {
      descripcion: 'Cola de tickets abiertos de un módulo y prioridad (índice parcial cola_tickets_abiertos). Ojo: para usar un índice parcial la consulta debe incluir la misma condición del partialFilterExpression',
      mongosh: `db.tickets.find({ estado: { $in: ${JSON.stringify(ESTADOS_ABIERTOS)} }, modulo: "pos", prioridad: "alta" }).explain("executionStats")`,
      ejecutar: () => col('tickets').find({ estado: { $in: ESTADOS_ABIERTOS }, modulo: 'pos', prioridad: 'alta' }).explain('executionStats'),
    },
    busqueda_texto: {
      descripcion: 'Búsqueda en lenguaje natural en la base de conocimientos (índice de texto en español)',
      mongosh: 'db.articulos.find({ $text: { $search: "factura electrónica rechazada" } }, { score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } }).explain("executionStats")',
      ejecutar: () => col('articulos').find({ $text: { $search: 'factura electrónica rechazada', $language: 'spanish' } }, { projection: { s: { $meta: 'textScore' } } }).sort({ s: { $meta: 'textScore' } }).explain('executionStats'),
    },
    bitacora_reciente: {
      descripcion: 'Últimos eventos de la bitácora (índice fecha_usuario)',
      mongosh: 'db.bitacora.find().sort({ fecha: -1 }).limit(20).explain("executionStats")',
      ejecutar: () => col('bitacora').find().sort({ fecha: -1 }).limit(20).explain('executionStats'),
    },
    sin_indice: {
      descripcion: 'Contraejemplo: filtro por un campo sin índice (asunto) → COLLSCAN',
      mongosh: 'db.tickets.find({ asunto: /factura/i }).explain("executionStats")',
      ejecutar: () => col('tickets').find({ asunto: /factura/i }).explain('executionStats'),
    },
  };
}

// Busca la etapa ganadora (IXSCAN, COLLSCAN, TEXT_MATCH…) y el índice usado
function resumirPlan(plan) {
  const etapas = [];
  let indice = null;
  const recorrer = (n) => {
    if (!n) return;
    if (n.stage) etapas.push(n.stage);
    if (n.indexName) indice = n.indexName;
    recorrer(n.inputStage);
    (n.inputStages || []).forEach(recorrer);
  };
  recorrer(plan);
  return { etapas, indice };
}

router.get('/explain', requierePermiso('indices:configurar'), asyncHandler(async (_req, res) => {
  const c = await consultasDemo();
  res.json(Object.entries(c).map(([clave, v]) => ({ clave, descripcion: v.descripcion, mongosh: v.mongosh })));
}));

router.get('/explain/:clave', requierePermiso('indices:configurar'), asyncHandler(async (req, res) => {
  const consultas = await consultasDemo();
  const q = consultas[req.params.clave];
  if (!q) throw new HttpError(404, 'Consulta de ejemplo no encontrada');
  const e = await q.ejecutar();
  const stats = e.executionStats;
  const plan = e.queryPlanner?.winningPlan?.queryPlan || e.queryPlanner?.winningPlan;
  res.json({
    descripcion: q.descripcion,
    mongosh: q.mongosh,
    resumen: {
      ...resumirPlan(plan),
      nReturned: stats.nReturned,
      totalKeysExamined: stats.totalKeysExamined,
      totalDocsExamined: stats.totalDocsExamined,
      executionTimeMillis: stats.executionTimeMillis,
    },
    explain: { queryPlanner: e.queryPlanner, executionStats: { ...stats, executionStages: undefined } },
  });
}));

// Ejecuta a mano las tareas programadas (útil en la sustentación)
router.post('/tareas', requierePermiso('indices:configurar'), asyncHandler(async (req, res) => {
  const r = await ejecutarTareas();
  await registrar({ req, accion: 'ejecutar_tareas', entidad: 'sistema', despues: r });
  res.json(r);
}));

router.get('/notificaciones', requierePermiso('indices:configurar'), asyncHandler(async (_req, res) => {
  res.json(await col('notificaciones').find().sort({ fecha_creacion: -1 }).limit(50).toArray());
}));

module.exports = router;
