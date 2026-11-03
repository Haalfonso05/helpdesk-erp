/**
 * Índices del sistema (Anexo B del RQF v2 + los que necesitan las consultas frecuentes).
 */
const { ESTADOS_ABIERTOS } = require('../config/catalogo');

module.exports = {
  usuarios: [
    { key: { correo: 1 }, name: 'correo_unico', unique: true },
    { key: { documento: 1 }, name: 'documento' },
    { key: { cliente_id: 1 }, name: 'cliente' },
    { key: { roles: 1, estado: 1 }, name: 'roles_estado' }, // índice multikey (roles es un arreglo)
  ],
  clientes: [
    { key: { nit: 1 }, name: 'nit_unico', unique: true },
    { key: { 'membresia.estado': 1, 'membresia.fecha_renovacion': 1 }, name: 'estado_renovacion_membresia' },
  ],
  pagos: [{ key: { cliente_id: 1, fecha: -1 }, name: 'cliente_fecha' }],
  tickets: [
    { key: { codigo: 1 }, name: 'codigo_unico', unique: true },
    // Compuestos exigidos por el Anexo B
    { key: { cliente_id: 1, estado: 1, fecha_creacion: -1 }, name: 'cliente_estado_fecha' },
    { key: { responsable_id: 1, estado: 1 }, name: 'responsable_estado' },
    // Parcial: solo indexa los tickets abiertos (la cola de trabajo), así el índice es más pequeño
    {
      key: { modulo: 1, prioridad: 1, fecha_creacion: 1 },
      name: 'cola_tickets_abiertos',
      partialFilterExpression: { estado: { $in: ESTADOS_ABIERTOS } },
    },
    { key: { fecha_creacion: -1 }, name: 'fecha_creacion' },
  ],
  articulos: [
    // Índice de texto en español con pesos: el título pesa más que el contenido
    {
      key: { titulo: 'text', etiquetas: 'text', contenido: 'text' },
      name: 'busqueda_texto_es',
      default_language: 'spanish',
      weights: { titulo: 10, etiquetas: 5, contenido: 1 },
    },
    { key: { modulo: 1, estado: 1 }, name: 'modulo_estado' },
  ],
  bitacora: [
    { key: { fecha: -1, usuario_id: 1 }, name: 'fecha_usuario' },
    { key: { entidad: 1, documento_id: 1 }, name: 'entidad_documento' },
    { key: { accion: 1, fecha: -1 }, name: 'accion_fecha' },
  ],
  notificaciones: [{ key: { estado: 1, fecha_creacion: 1 }, name: 'cola_envio' }],
  tokens: [
    { key: { token_hash: 1 }, name: 'token' },
    // TTL: MongoDB borra solo los tokens vencidos
    { key: { expira: 1 }, name: 'ttl_expira', expireAfterSeconds: 0 },
  ],
};
