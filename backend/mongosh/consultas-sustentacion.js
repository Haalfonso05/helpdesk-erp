// ─────────────────────────────────────────────────────────────────────────────
// Consultas para la sustentación en vivo (mongosh o la pestaña "Mongosh" de Compass)
// Uso:  mongosh "<cadena de Atlas>/helpdesk_erp" consultas-sustentacion.js
//   o   copiar y pegar bloque por bloque.
// ─────────────────────────────────────────────────────────────────────────────
use('helpdesk_erp');

// 1) Ver el validador $jsonSchema (con oneOf) de la colección polimórfica
printjson(db.getCollectionInfos({ name: 'tickets' })[0].options.validator.$jsonSchema.oneOf.map((r) => r.properties.modulo));

// 2) Polimorfismo: mismos tickets, estructuras distintas
db.tickets.find({ modulo: 'produccion' }, { codigo: 1, detalle: 1 }).limit(2);
db.tickets.find({ modulo: 'ventas_online' }, { codigo: 1, detalle: 1 }).limit(2);
// Tickets que tienen un campo propio de un módulo, sin importar el resto
db.tickets.find({ 'detalle.temperatura_sensor': { $exists: true } }, { codigo: 1, 'detalle.temperatura_sensor': 1 }).limit(3);
// Solo los que tienen la temperatura numérica ($type)
db.tickets.countDocuments({ 'detalle.temperatura_sensor': { $type: 'number' } });

// 3) El validador rechaza un ticket de POS con datos de producción
try {
  db.tickets.insertOne({ codigo: 'TK-999999', modulo: 'pos', detalle: { id_maquinaria: 'M1' } });
} catch (e) { print('Rechazado por $jsonSchema:', e.errInfo ? 'sí' : e.message); }

// 4) AGREGACIONES ($match, $group, $sort, $project, $lookup)
// 4.1 ¿Qué módulo falla más?  ($match + $group + $sort + $project)
db.tickets.aggregate([
  { $match: { tipo: 'problematica' } },
  { $group: { _id: '$modulo', total: { $sum: 1 }, criticos: { $sum: { $cond: [{ $eq: ['$prioridad', 'critica'] }, 1, 0] } } } },
  { $sort: { total: -1 } },
  { $project: { _id: 0, modulo: '$_id', total: 1, criticos: 1 } },
]);

// 4.2 Tiempo medio de resolución por agente ($lookup a usuarios)
db.tickets.aggregate([
  { $match: { fecha_resolucion: { $ne: null }, responsable_id: { $ne: null } } },
  { $group: { _id: '$responsable_id', tickets: { $sum: 1 }, horas: { $avg: { $divide: [{ $subtract: ['$fecha_resolucion', '$fecha_creacion'] }, 3600000] } } } },
  { $lookup: { from: 'usuarios', localField: '_id', foreignField: '_id', as: 'agente' } },
  { $unwind: '$agente' },
  { $project: { _id: 0, agente: '$agente.nombre', tickets: 1, horas: { $round: ['$horas', 1] } } },
  { $sort: { horas: 1 } },
]);

// 4.3 Clientes con membresía activa y algún pago fallido ($lookup con pipeline)
db.clientes.aggregate([
  { $match: { 'membresia.estado': { $in: ['activa', 'en_gracia', 'suspendida'] } } },
  { $lookup: { from: 'pagos', localField: '_id', foreignField: 'cliente_id', as: 'fallidos', pipeline: [{ $match: { estado: 'fallido' } }] } },
  { $match: { 'fallidos.0': { $exists: true } } },
  { $project: { razon_social: 1, 'membresia.estado': 1, pagos_fallidos: { $size: '$fallidos' } } },
]);

// 4.4 Efectividad de artículos ($lookup a tickets)
db.articulos.aggregate([
  { $match: { estado: 'publicado' } },
  { $lookup: { from: 'tickets', localField: '_id', foreignField: 'articulo_solucion_id', as: 't' } },
  { $project: { titulo: 1, resueltos: { $size: '$t' }, votos_utiles: 1 } },
  { $sort: { resueltos: -1 } },
  { $limit: 5 },
]);

// 5) Búsqueda en lenguaje natural (índice de texto en español)
db.articulos.find(
  { $text: { $search: 'factura electrónica rechazada' } },
  { titulo: 1, score: { $meta: 'textScore' } }
).sort({ score: { $meta: 'textScore' } });

// 6) Eficiencia de índices: comparar totalDocsExamined vs nReturned
const cli = db.tickets.findOne().cliente_id;
db.tickets.find({ cliente_id: cli, estado: 'cerrado' }).sort({ fecha_creacion: -1 }).explain('executionStats').executionStats;
db.tickets.find({ asunto: /factura/i }).explain('executionStats').executionStats; // COLLSCAN (sin índice)
db.tickets.getIndexes();

// 7) Transacción multidocumento: pago fallido → membresía suspendida + bitácora (todo o nada)
const s = db.getMongo().startSession();
s.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
try {
  const sdb = s.getDatabase('helpdesk_erp');
  const c = sdb.clientes.findOne({ nit: '900123456-1' });
  sdb.pagos.insertOne({ cliente_id: c._id, valor: 1200000, metodo: 'pse', estado: 'fallido', fecha: new Date(), registrado_por: null });
  sdb.clientes.updateOne({ _id: c._id }, { $set: { 'membresia.estado': 'suspendida', 'membresia.fecha_ultimo_cambio': new Date() } });
  sdb.bitacora.insertOne({ fecha: new Date(), usuario_id: null, accion: 'pago_fallido', entidad: 'membresia', documento_id: c._id, resultado: 'exito' });
  s.abortTransaction(); // ← cambie por s.commitTransaction() para confirmar; abort demuestra el rollback
} catch (e) { s.abortTransaction(); throw e; } finally { s.endSession(); }
db.clientes.findOne({ nit: '900123456-1' }, { 'membresia.estado': 1 }); // sigue igual porque se abortó
