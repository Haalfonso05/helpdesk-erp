const { Router } = require('express');
const { asyncHandler, HttpError } = require('../utils/errores');
const { requierePermiso, tieneRol } = require('../middlewares/auth');
const { pipelines, ejecutar } = require('../services/reportes');
const { registrar } = require('../services/bitacora');

const router = Router();

const aCsv = (filas) => {
  if (!filas.length) return '';
  const cols = Object.keys(filas[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...filas.map((f) => cols.map((c) => esc(typeof f[c] === 'object' ? JSON.stringify(f[c]) : f[c])).join(','))].join('\n');
};

// Soporte solo ve sus propios indicadores (RQF-S7); admin y auditor ven todo
function alcance(req) {
  const global = tieneRol(req, 'administrador') || tieneRol(req, 'auditor');
  return { desde: req.query.desde, hasta: req.query.hasta, responsableId: global ? undefined : req.usuario._id };
}

router.get('/', requierePermiso('reportes:propios'), (_req, res) => res.json(Object.keys(pipelines)));

// GET /api/reportes/:nombre?desde=2026-01-01&hasta=2026-12-31&formato=csv
router.get('/:nombre', requierePermiso('reportes:propios'), asyncHandler(async (req, res) => {
  const { nombre } = req.params;
  if (!pipelines[nombre]) throw new HttpError(404, `Reporte desconocido. Disponibles: ${Object.keys(pipelines).join(', ')}`);
  const global = tieneRol(req, 'administrador') || tieneRol(req, 'auditor');
  if (!global && ['efectividadArticulos', 'tiempoPorPlan'].includes(nombre)) throw new HttpError(403, 'Reporte disponible solo para administración y auditoría');

  const r = await ejecutar(nombre, alcance(req));
  if (req.query.formato === 'csv' || req.query.formato === 'json_descarga') {
    await registrar({ req, accion: 'exportar_reporte', entidad: 'reporte', documento_id: nombre, detalle: req.query.formato });
    if (req.query.formato === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}.csv"`);
      return res.send(`﻿${aCsv(r.datos)}`);
    }
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.json"`);
    return res.json(r.datos);
  }
  res.json(r);
}));

module.exports = router;
module.exports.aCsv = aCsv;
