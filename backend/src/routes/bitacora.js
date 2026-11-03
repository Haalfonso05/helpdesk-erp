const { Router } = require('express');
const { col } = require('../config/db');
const { asyncHandler } = require('../utils/errores');
const { aId, paginar } = require('../utils/ayudas');
const { requierePermiso } = require('../middlewares/auth');
const { registrar } = require('../services/bitacora');
const { aCsv } = require('./reportes');

const router = Router();

// RQF-36: filtros por fechas, usuario, tipo de acción y entidad. Orden cronológico.
function construirFiltro({ desde, hasta, usuario_id, correo, accion, entidad, documento_id, resultado }) {
  const f = {};
  if (desde || hasta) {
    f.fecha = {};
    if (desde) f.fecha.$gte = new Date(desde);
    if (hasta) f.fecha.$lte = new Date(`${hasta}T23:59:59.999Z`);
  }
  if (usuario_id) f.usuario_id = aId(usuario_id, 'usuario_id');
  if (correo) f.correo = String(correo).toLowerCase();
  if (accion) f.accion = { $in: String(accion).split(',') };
  if (entidad) f.entidad = entidad;
  if (documento_id) f.documento_id = /^[a-f0-9]{24}$/i.test(documento_id) ? aId(documento_id) : documento_id;
  if (resultado) f.resultado = resultado;
  return f;
}

router.get('/', requierePermiso('bitacora:consultar'), asyncHandler(async (req, res) => {
  const { pagina, limite, orden } = req.query;
  res.json(await paginar(col('bitacora'), construirFiltro(req.query), { pagina, limite, orden: orden || '-fecha' }));
}));

router.get('/acciones', requierePermiso('bitacora:consultar'), asyncHandler(async (_req, res) => {
  res.json(await col('bitacora').distinct('accion'));
}));

// Exportación CSV/JSON (máx. 5000 registros); la propia exportación queda auditada
router.get('/exportar', requierePermiso('bitacora:consultar'), asyncHandler(async (req, res) => {
  const filtro = construirFiltro(req.query);
  const datos = await col('bitacora').find(filtro).sort({ fecha: -1 }).limit(5000).toArray();
  await registrar({ req, accion: 'exportar_bitacora', entidad: 'bitacora', detalle: `${datos.length} registros (${req.query.formato || 'json'})` });
  if (req.query.formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bitacora.csv"');
    return res.send(`﻿${aCsv(datos.map((d) => ({ ...d, fecha: d.fecha.toISOString() })))}`);
  }
  res.setHeader('Content-Disposition', 'attachment; filename="bitacora.json"');
  res.json(datos);
}));

module.exports = router;
