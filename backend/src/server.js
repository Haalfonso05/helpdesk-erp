require('dotenv').config();
const app = require('./app');
const { conectarDB } = require('./config/db');
const { prepararBaseDeDatos } = require('./db/setup');
const { iniciarTareas } = require('./services/tareas');

const PORT = process.env.PORT || 4000;

if (!process.env.JWT_SECRET) {
  console.error('Error: falta JWT_SECRET en el archivo .env');
  process.exit(1);
}

conectarDB()
  .then(async (db) => {
    await prepararBaseDeDatos(db, { silencioso: true }); // asegura validadores e índices
    iniciarTareas();
    app.listen(PORT, () => {
      console.log(`API en http://localhost:${PORT}/api`);
      console.log(`Documentación en http://localhost:${PORT}/api/docs`);
    });
  })
  .catch((err) => {
    console.error('Error: no se pudo conectar a MongoDB:', err.message);
    process.exit(1);
  });
