const express = require('express');
const cors = require('cors');
const logger = require('./middlewares/logger');
const { autenticar, soloLecturaAuditor } = require('./middlewares/auth');
const { manejadorErrores } = require('./utils/errores');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./docs/openapi');

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: (process.env.FRONTEND_URL || 'http://localhost:5173').split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(logger);

app.get('/api', (_req, res) => res.json({ mensaje: 'API Helpdesk & Customer Success ERP/POS', documentacion: '/api/docs' }));

// Documentación interactiva (como el /docs de FastAPI)
app.get('/api/openapi.json', (_req, res) => res.json(openapi));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
  customSiteTitle: 'API Mesa de Ayuda',
  swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tryItOutEnabled: true },
}));
app.use('/api/meta', require('./routes/meta'));
app.use('/api/auth', require('./routes/auth'));

// De aquí en adelante todo exige JWT y el auditor queda en solo lectura
const protegidas = [autenticar, soloLecturaAuditor];
app.use('/api/usuarios', protegidas, require('./routes/usuarios'));
app.use('/api/clientes', protegidas, require('./routes/clientes'));
app.use('/api/tickets', protegidas, require('./routes/tickets'));
app.use('/api/articulos', protegidas, require('./routes/articulos'));
app.use('/api/reportes', protegidas, require('./routes/reportes'));
app.use('/api/bitacora', protegidas, require('./routes/bitacora'));
app.use('/api/admin', protegidas, require('./routes/admin'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(manejadorErrores);

module.exports = app;
