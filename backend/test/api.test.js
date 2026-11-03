/**
 * Pruebas de integración de la API (requieren MongoDB como replica set).
 * Usan una base aparte: <MONGO_DB>_test. Ejecutar: npm test
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.MONGO_DB = `${process.env.MONGO_DB || 'helpdesk_erp'}_test`;
process.env.MOSTRAR_TOKENS_DEV = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

let servidor;
let base;
let cerrarDB;
const T = {};
const PASS = 'Demo#Helpdesk2026';

async function api(metodo, ruta, { token, body, headers = {} } = {}) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let datos;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { status: r.status, datos };
}
const login = async (correo, password = PASS) => (await api('POST', '/auth/login', { body: { correo, password } })).datos.token;

before(async () => {
  execFileSync('node', [path.join(__dirname, '../src/db/seed.js'), '--demo', '--reset'], { env: process.env, stdio: 'ignore' });
  const db = require('../src/config/db');
  cerrarDB = db.cerrarDB;
  await db.conectarDB();
  const app = require('../src/app');
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}/api`;
  T.admin = await login(process.env.ADMIN_CORREO, process.env.ADMIN_PASSWORD);
  T.maria = await login('maria@comercialandina.co');
  T.laura = await login('laura.soporte@helpdesk.local');
  T.diego = await login('diego.auditor@helpdesk.local');
  T.sofia = await login('sofia.soporte@helpdesk.local');
  T.natalia = await login('natalia@distrinorte.co');
});

after(async () => {
  servidor?.close();
  await cerrarDB?.();
});

test('logins de demo funcionan', () => {
  for (const k of ['admin', 'maria', 'laura', 'diego', 'sofia', 'natalia']) assert.ok(T[k], `sin token para ${k}`);
});

test('meta expone el catálogo de módulos para el formulario dinámico', async () => {
  const r = await api('GET', '/meta');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.datos.modulos), ['ventas_online', 'inventarios', 'compras', 'produccion', 'pos']);
});

const ticketValido = {
  modulo: 'ventas_online', tipo: 'problematica', asunto: 'Pago rechazado en checkout',
  descripcion: 'Los clientes no pueden pagar con PSE desde ayer en la tarde.', severidad: 'alta',
  detalle: { id_pasarela: 'WOMPI-1234', url_error: 'https://tienda.co/checkout', navegador: 'Chrome', campo_extra: 'se descarta' },
};

test('polimorfismo: el validador oneOf de MongoDB rechaza un detalle incompleto', async () => {
  const r = await api('POST', '/tickets', { token: T.maria, body: { ...ticketValido, detalle: { id_pasarela: 'X' } } });
  assert.equal(r.status, 400);
  assert.match(r.datos.error, /jsonSchema/);
});

test('polimorfismo: URL con formato inválido es rechazada por el esquema', async () => {
  const r = await api('POST', '/tickets', { token: T.maria, body: { ...ticketValido, detalle: { ...ticketValido.detalle, url_error: 'tienda.co' } } });
  assert.equal(r.status, 400);
});

test('no se crean tickets de módulos no contratados', async () => {
  const r = await api('POST', '/tickets', { token: T.maria, body: { ...ticketValido, modulo: 'produccion', detalle: { id_maquinaria: 'M1', codigo_lote: 'L1', fase: 'mezclado' } } });
  assert.equal(r.status, 403);
});

test('membresía suspendida: no crea tickets ni consulta la base de conocimientos', async () => {
  const r = await api('POST', '/tickets', { token: T.natalia, body: { modulo: 'compras', asunto: 'Prueba bloqueada', descripcion: 'Debe fallar por membresía', detalle: { proveedor_nit: '900-1', orden_compra: 'OC-1', etapa: 'orden' } } });
  assert.equal(r.status, 403);
  assert.equal((await api('GET', '/articulos?q=orden', { token: T.natalia })).status, 403);
});

test('ciclo completo de un ticket: crear, tomar, pausar SLA, resolver, confirmar, calificar, reabrir', async () => {
  const c = await api('POST', '/tickets', { token: T.maria, body: ticketValido });
  assert.equal(c.status, 201, JSON.stringify(c.datos));
  const id = c.datos._id;
  assert.equal(c.datos.prioridad, 'critica'); // alta + plan premium
  assert.equal(c.datos.detalle.campo_extra, undefined);

  // Transición inválida
  assert.equal((await api('POST', `/tickets/${id}/estado`, { token: T.laura, body: { estado: 'resuelto' } })).status, 409);

  // Soporte lo ve en la cola y lo toma
  const cola = await api('GET', '/tickets?sin_asignar=true&limite=100', { token: T.laura });
  assert.ok(cola.datos.datos.some((t) => t._id === id));
  assert.equal((await api('POST', `/tickets/${id}/tomar`, { token: T.laura })).datos.estado, 'asignado');
  assert.equal((await api('POST', `/tickets/${id}/estado`, { token: T.laura, body: { estado: 'en_proceso' } })).status, 200);

  // Comentario interno: el cliente no lo ve
  await api('POST', `/tickets/${id}/comentarios`, { token: T.laura, body: { texto: 'Nota interna', visibilidad: 'interno' } });
  await api('POST', `/tickets/${id}/comentarios`, { token: T.laura, body: { texto: 'Estamos revisando', visibilidad: 'publico' } });
  const vistaCliente = await api('GET', `/tickets/${id}`, { token: T.maria });
  assert.equal(vistaCliente.datos.comentarios.length, 1);
  assert.equal((await api('POST', `/tickets/${id}/comentarios`, { token: T.maria, body: { texto: 'x', visibilidad: 'interno' } })).status, 403);

  // Pausa del SLA
  const antes = (await api('GET', `/tickets/${id}`, { token: T.laura })).datos.sla.vence_resolucion;
  await api('POST', `/tickets/${id}/estado`, { token: T.laura, body: { estado: 'en_espera_cliente' } });
  await new Promise((r) => setTimeout(r, 50));
  await api('POST', `/tickets/${id}/estado`, { token: T.laura, body: { estado: 'en_proceso' } });
  const despues = (await api('GET', `/tickets/${id}`, { token: T.laura })).datos.sla.vence_resolucion;
  assert.ok(new Date(despues) > new Date(antes), 'el vencimiento se corre por la pausa');

  // Cliente no puede marcar resuelto
  assert.equal((await api('POST', `/tickets/${id}/estado`, { token: T.maria, body: { estado: 'resuelto' } })).status, 403);

  await api('POST', `/tickets/${id}/estado`, { token: T.laura, body: { estado: 'resuelto', nota: 'Se aumentó el timeout' } });
  const arts = await api('GET', '/articulos?q=pasarela timeout', { token: T.laura });
  assert.ok(arts.datos.datos.length > 0);
  assert.equal((await api('PUT', `/tickets/${id}/articulo`, { token: T.laura, body: { articulo_id: arts.datos.datos[0]._id } })).status, 200);

  assert.equal((await api('POST', `/tickets/${id}/estado`, { token: T.maria, body: { estado: 'cerrado' } })).datos.estado, 'cerrado');
  assert.equal((await api('POST', `/tickets/${id}/calificar`, { token: T.maria, body: { puntaje: 5 } })).status, 200);
  assert.equal((await api('POST', `/tickets/${id}/estado`, { token: T.maria, body: { estado: 'reabierto' } })).datos.estado, 'reabierto');
  // Segunda reapertura no permitida
  await api('POST', `/tickets/${id}/estado`, { token: T.laura, body: { estado: 'en_proceso' } });
  await api('POST', `/tickets/${id}/estado`, { token: T.laura, body: { estado: 'resuelto' } });
  await api('POST', `/tickets/${id}/estado`, { token: T.maria, body: { estado: 'cerrado' } });
  const r2 = await api('POST', `/tickets/${id}/estado`, { token: T.maria, body: { estado: 'reabierto' } });
  assert.equal(r2.status, 409);
  assert.equal(r2.datos.crear_enlazado, true);

  const final = (await api('GET', `/tickets/${id}`, { token: T.admin })).datos;
  assert.ok(final.historial_estados.length >= 10);
});

test('escalamiento exige motivo', async () => {
  const c = await api('POST', '/tickets', { token: T.maria, body: { ...ticketValido, asunto: 'Otro problema de pagos' } });
  const id = c.datos._id;
  await api('POST', `/tickets/${id}/tomar`, { token: T.laura });
  assert.equal((await api('POST', `/tickets/${id}/escalar`, { token: T.laura, body: {} })).status, 400);
  assert.equal((await api('POST', `/tickets/${id}/escalar`, { token: T.laura, body: { motivo: 'Requiere desarrollo' } })).datos.estado, 'escalado');
});

test('auditor es solo lectura (también un multi-rol en contexto de auditoría)', async () => {
  assert.equal((await api('GET', '/tickets', { token: T.diego })).status, 200);
  assert.equal((await api('POST', '/articulos', { token: T.diego, body: { titulo: 'x' } })).status, 403);
  const sofiaAuditoria = await api('POST', '/articulos', { token: T.sofia, headers: { 'X-Contexto': 'auditoria' }, body: { titulo: 'Artículo de prueba', modulo: 'pos', contenido: 'Contenido suficientemente largo para validar.' } });
  assert.equal(sofiaAuditoria.status, 403);
  const sofiaSoporte = await api('POST', '/articulos', { token: T.sofia, body: { titulo: 'Artículo de prueba', modulo: 'pos', contenido: 'Contenido suficientemente largo para validar.', etiquetas: 'caja, prueba' } });
  assert.equal(sofiaSoporte.status, 201);
  assert.equal(sofiaSoporte.datos.estado, 'borrador');
  assert.equal((await api('POST', `/articulos/${sofiaSoporte.datos._id}/publicar`, { token: T.sofia })).status, 403);
  assert.equal((await api('POST', `/articulos/${sofiaSoporte.datos._id}/publicar`, { token: T.admin })).datos.estado, 'publicado');
});

test('transacción de pagos: fallo simulado revierte todo; pago fallido suspende; aprobado reactiva', async () => {
  const clientes = await api('GET', '/clientes?q=Andina', { token: T.admin });
  const id = clientes.datos.datos[0]._id;
  const pagosAntes = (await api('GET', `/clientes/${id}/pagos?limite=100`, { token: T.admin })).datos.paginacion.total;

  const sim = await api('POST', `/clientes/${id}/pagos`, { token: T.admin, body: { valor: 1200000, metodo: 'pse', estado: 'fallido', simular_fallo: true } });
  assert.equal(sim.status, 409);
  let det = (await api('GET', `/clientes/${id}`, { token: T.admin })).datos;
  assert.equal(det.membresia.estado, 'activa');
  assert.equal((await api('GET', `/clientes/${id}/pagos?limite=100`, { token: T.admin })).datos.paginacion.total, pagosAntes);

  const f = await api('POST', `/clientes/${id}/pagos`, { token: T.admin, body: { valor: 1200000, metodo: 'pse', estado: 'fallido' } });
  assert.equal(f.status, 201);
  assert.equal(f.datos.membresia.estado, 'suspendida');
  assert.equal((await api('POST', '/tickets', { token: T.maria, body: ticketValido })).status, 403);

  const a = await api('POST', `/clientes/${id}/pagos`, { token: T.admin, body: { valor: 1200000, metodo: 'tarjeta', estado: 'aprobado' } });
  assert.equal(a.datos.membresia.estado, 'activa');
  det = (await api('GET', `/clientes/${id}`, { token: T.admin })).datos;
  assert.ok(det.historial_membresia.length >= 2);
  assert.equal((await api('POST', '/tickets', { token: T.maria, body: ticketValido })).status, 201);
});

test('cliente solo ve su empresa', async () => {
  const r = await api('GET', '/clientes', { token: T.maria });
  assert.equal(r.datos.datos.length, 1);
  const otros = await api('GET', '/clientes?limite=50', { token: T.admin });
  const ajeno = otros.datos.datos.find((c) => c.razon_social !== 'Comercial Andina SAS');
  assert.equal((await api('GET', `/clientes/${ajeno._id}`, { token: T.maria })).status, 403);
});

test('búsqueda de texto en español ordenada por relevancia y sugerencias', async () => {
  const r = await api('GET', '/articulos?q=factura electrónica rechazada', { token: T.maria });
  assert.equal(r.status, 200);
  assert.match(r.datos.datos[0].titulo, /Factura electrónica/);
  assert.ok(r.datos.datos[0].puntaje > 0);
  const s = await api('GET', '/articulos/sugerencias?texto=el cierre de turno no cuadra', { token: T.maria });
  assert.ok(s.datos.length > 0);
});

test('reportes de agregación responden', async () => {
  for (const n of ['modulosIncidencias', 'tiempoPorAgente', 'tiempoPorPlan', 'tasaReapertura', 'cumplimientoSla', 'efectividadArticulos', 'tablero']) {
    const r = await api('GET', `/reportes/${n}`, { token: T.admin });
    assert.equal(r.status, 200, n);
    assert.ok(Array.isArray(r.datos.datos) && r.datos.datos.length > 0, `${n} sin datos`);
  }
  const csv = await api('GET', '/reportes/modulosIncidencias?formato=csv', { token: T.diego });
  assert.match(csv.datos, /modulo/);
  const propio = await api('GET', '/reportes/tiempoPorAgente', { token: T.laura });
  assert.ok(propio.datos.datos.every((d) => d.agente === 'Laura Gómez'));
});

test('explain usa los índices esperados', async () => {
  const esperados = { tickets_cliente_estado: 'cliente_estado_fecha', tickets_responsable: 'responsable_estado', cola_abiertos: 'cola_tickets_abiertos', busqueda_texto: 'busqueda_texto_es', bitacora_reciente: 'fecha_usuario' };
  for (const [clave, indice] of Object.entries(esperados)) {
    const r = await api('GET', `/admin/explain/${clave}`, { token: T.admin });
    assert.equal(r.status, 200, clave);
    assert.equal(r.datos.resumen.indice, indice, `${clave}: ${JSON.stringify(r.datos.resumen)}`);
  }
  const sin = await api('GET', '/admin/explain/sin_indice', { token: T.admin });
  assert.ok(sin.datos.resumen.etapas.includes('COLLSCAN'));
  assert.ok((await api('GET', '/admin/indices', { token: T.admin })).datos.tickets.length >= 6);
});

test('registro, verificación y política de contraseñas', async () => {
  const debil = await api('POST', '/auth/registro', { body: { nombre: 'Prueba', tipo_documento: 'CC', documento: '123456789', correo: 'nuevo@prueba.co', password: 'corta' } });
  assert.equal(debil.status, 400);
  const r = await api('POST', '/auth/registro', { body: { nombre: 'Usuario Nuevo', tipo_documento: 'CC', documento: '123456789', correo: 'nuevo@prueba.co', password: 'Segura#2026abc', nit_cliente: '901555222-3' } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.deepEqual(r.datos.usuario.roles, ['cliente']);
  const tk = await login('nuevo@prueba.co', 'Segura#2026abc');
  // Sin verificar no crea tickets
  assert.equal((await api('POST', '/tickets', { token: tk, body: { ...ticketValido, modulo: 'pos', detalle: { caja_id: 'C1', turno: 'tarde' } } })).status, 403);
  assert.equal((await api('POST', '/auth/verificar', { body: { token: r.datos.token_verificacion_dev } })).status, 200);
  const ok = await api('POST', '/tickets', { token: tk, body: { ...ticketValido, modulo: 'pos', detalle: { caja_id: 'C1', turno: 'tarde' } } });
  assert.equal(ok.status, 201, JSON.stringify(ok.datos));
  // Duplicado de correo
  assert.equal((await api('POST', '/auth/registro', { body: { nombre: 'Otro', tipo_documento: 'CC', documento: '987654321', correo: 'nuevo@prueba.co', password: 'Segura#2026abc' } })).status, 409);
});

test('bloqueo tras 5 intentos fallidos y mensaje genérico', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await api('POST', '/auth/login', { body: { correo: 'julian@comercialandina.co', password: 'mala' } });
    assert.equal(r.status, 401);
  }
  assert.equal((await api('POST', '/auth/login', { body: { correo: 'julian@comercialandina.co', password: PASS } })).status, 423);
  assert.equal((await api('POST', '/auth/login', { body: { correo: 'noexiste@x.co', password: 'x' } })).datos.error, 'Correo o contraseña incorrectos');
});

test('cambio de roles invalida la sesión y no se puede quitar el último admin', async () => {
  const usuarios = await api('GET', '/usuarios?q=camila', { token: T.admin });
  const camila = usuarios.datos.datos[0];
  const tkCamila = await login('camila.soporte@helpdesk.local');
  assert.equal((await api('PUT', `/usuarios/${camila._id}/roles`, { token: T.admin, body: { roles: ['soporte', 'auditor'], motivo: 'Apoyo en auditoría' } })).status, 200);
  assert.equal((await api('GET', '/tickets', { token: tkCamila })).status, 401);

  const yo = (await api('GET', '/auth/yo', { token: T.admin })).datos.usuario;
  const r = await api('PUT', `/usuarios/${yo._id}/roles`, { token: T.admin, body: { roles: ['soporte'], motivo: 'Prueba de último admin' } });
  assert.equal(r.status, 409);
});

test('bitácora registra y exporta; el soporte no puede consultarla', async () => {
  assert.equal((await api('GET', '/bitacora', { token: T.laura })).status, 403);
  const b = await api('GET', '/bitacora?accion=cambio_roles', { token: T.diego });
  assert.ok(b.datos.datos.length >= 1);
  const csv = await api('GET', '/bitacora/exportar?formato=csv', { token: T.diego });
  assert.match(csv.datos, /accion/);
  const ex = await api('GET', '/bitacora?accion=exportar_bitacora', { token: T.diego });
  assert.ok(ex.datos.datos.length >= 1);
});

test('tareas programadas se ejecutan', async () => {
  const r = await api('POST', '/admin/tareas', { token: T.admin });
  assert.equal(r.status, 200);
  assert.ok('ticketsCerrados' in r.datos);
});
