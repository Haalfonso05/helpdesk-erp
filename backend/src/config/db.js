const { MongoClient } = require('mongodb');

let client;
let db;

async function conectarDB(uri = process.env.MONGO_URI, nombre = process.env.MONGO_DB || 'helpdesk_erp') {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(nombre);
  console.log(`Conectado a MongoDB: ${db.databaseName}`);
  return db;
}

function getDb() {
  if (!db) throw new Error('La base de datos no está conectada');
  return db;
}

function getClient() {
  if (!client) throw new Error('La base de datos no está conectada');
  return client;
}

async function cerrarDB() {
  if (client) await client.close();
  client = undefined;
  db = undefined;
}

// Atajo: col('tickets') → colección
const col = (nombre) => getDb().collection(nombre);

module.exports = { conectarDB, getDb, getClient, cerrarDB, col };
