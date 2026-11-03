/**
 * Crea (o actualiza) las colecciones con sus validadores $jsonSchema y todos los índices.
 * Uso: npm run db:setup   (es idempotente: se puede correr varias veces)
 */
require('dotenv').config();
const { conectarDB, cerrarDB } = require('../config/db');
const esquemas = require('./esquemas');
const indices = require('./indices');

async function prepararBaseDeDatos(db, { silencioso = false } = {}) {
  const log = silencioso ? () => {} : console.log;
  const existentes = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  for (const [nombre, validator] of Object.entries(esquemas)) {
    const opciones = { validator, validationLevel: 'strict', validationAction: 'error' };
    if (existentes.has(nombre)) {
      await db.command({ collMod: nombre, ...opciones });
      log(`Validador actualizado: ${nombre}`);
    } else {
      await db.createCollection(nombre, opciones);
      log(`Colección creada: ${nombre}`);
    }
  }

  for (const [nombre, lista] of Object.entries(indices)) {
    await db.collection(nombre).createIndexes(lista);
    log(`${lista.length} índice(s) en ${nombre}: ${lista.map((i) => i.name).join(', ')}`);
  }

  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName) {
    console.warn('Aviso: MongoDB NO está corriendo como replica set: las transacciones (RQF-23) fallarán. Atlas sí lo es.');
  }
}

if (require.main === module) {
  conectarDB()
    .then((db) => prepararBaseDeDatos(db))
    .then(() => console.log('Base de datos lista'))
    .catch((e) => {
      console.error('Error:', e.message);
      process.exitCode = 1;
    })
    .finally(cerrarDB);
}

module.exports = { prepararBaseDeDatos };
