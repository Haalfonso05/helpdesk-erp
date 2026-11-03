// Catálogo público: el frontend arma el formulario dinámico con esto
const { Router } = require('express');
const C = require('../config/catalogo');

const router = Router();
router.get('/', (_req, res) =>
  res.json({
    modulos: C.MODULOS,
    roles: C.ROLES,
    planes: C.PLANES,
    estadosMembresia: C.ESTADOS_MEMBRESIA,
    metodosPago: C.METODOS_PAGO,
    estadosPago: C.ESTADOS_PAGO,
    tiposTicket: C.TIPOS_TICKET,
    canales: C.CANALES,
    severidades: C.SEVERIDADES,
    prioridades: C.PRIORIDADES,
    estadosTicket: C.ESTADOS_TICKET,
    transiciones: C.TRANSICIONES,
    sla: C.SLA_HORAS,
  })
);
module.exports = router;
