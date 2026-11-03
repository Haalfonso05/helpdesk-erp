/**
 * Documentación OpenAPI 3 de la API (se ve en http://localhost:4000/api/docs, como el /docs de FastAPI).
 * Los esquemas del "detalle" de cada ticket se generan del mismo catálogo que usa el $jsonSchema.
 */
const C = require('../config/catalogo');

const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema, example) => ({ content: { 'application/json': { schema, ...(example ? { example } : {}) } } });
const ok = (descripcion = 'OK', schema = { type: 'object' }) => ({ description: descripcion, ...json(schema) });
const id = (nombre = 'id', descripcion = 'ObjectId') => ({ name: nombre, in: 'path', required: true, schema: { type: 'string', example: '6ae6d5adeaa16718758f6340' }, description: descripcion });
const q = (name, descripcion, schema = { type: 'string' }) => ({ name, in: 'query', required: false, description: descripcion, schema });
const pag = [q('pagina', 'Número de página', { type: 'integer', default: 1 }), q('limite', 'Resultados por página (máx. 100)', { type: 'integer', default: 10 }), q('orden', 'Campo de orden; "-" = descendente. Ej: -fecha_creacion')];
const errores = { 400: { description: 'Datos inválidos o rechazados por el $jsonSchema' }, 401: { description: 'Sin token o sesión inválida' }, 403: { description: 'Sin permiso (matriz del Anexo A)' }, 404: { description: 'No encontrado' }, 409: { description: 'Conflicto (transición no permitida, duplicado…)' } };
const op = (tag, summary, extra = {}) => ({ tags: [tag], summary, responses: { 200: ok(), ...errores }, ...extra });
const cuerpo = (props, required = [], example) => ({ requestBody: { required: true, ...json({ type: 'object', properties: props, required }, example) } });

// Esquema del detalle de cada módulo (polimorfismo)
function esquemaCampo(c) {
  if (c.tipo === 'opcion') return { type: 'string', enum: c.opciones, description: c.etiqueta };
  if (c.tipo === 'entero') return { type: 'integer', minimum: 0, description: c.etiqueta };
  if (c.tipo === 'decimal') return { type: 'number', description: c.etiqueta };
  if (c.tipo === 'url') return { type: 'string', format: 'uri', pattern: '^https?://', description: c.etiqueta };
  return { type: 'string', description: c.etiqueta };
}
const detalles = Object.fromEntries(Object.entries(C.MODULOS).map(([k, m]) => [
  `Detalle_${k}`,
  { type: 'object', title: m.nombre, additionalProperties: false, required: m.campos.filter((c) => c.requerido).map((c) => c.clave), properties: Object.fromEntries(m.campos.map((c) => [c.clave, esquemaCampo(c)])) },
]));

const ejemplosTicket = {
  ventas_online: { summary: 'Ventas Online', value: { modulo: 'ventas_online', tipo: 'problematica', asunto: 'La pasarela rechaza pagos', descripcion: 'Desde hoy los pagos con tarjeta devuelven error 502.', severidad: 'alta', canal: 'web', detalle: { id_pasarela: 'WOMPI-1234', url_error: 'https://tienda.co/checkout', navegador: 'Chrome' } } },
  produccion: { summary: 'Producción', value: { modulo: 'produccion', tipo: 'problematica', asunto: 'Sensor de temperatura fuera de rango', descripcion: 'La máquina de cocción marca 400 °C, parece un error de lectura.', severidad: 'media', detalle: { id_maquinaria: 'MAQ-3', codigo_lote: 'L2026123', fase: 'coccion', temperatura_sensor: 400 } } },
  pos: { summary: 'Caja/POS', value: { modulo: 'pos', tipo: 'problematica', asunto: 'La impresora no imprime', descripcion: 'La impresora térmica de la caja 2 dejó de imprimir tiquetes.', severidad: 'baja', detalle: { caja_id: 'CAJA-2', turno: 'tarde' } } },
  invalido: { summary: 'Inválido (lo rechaza el oneOf)', value: { modulo: 'pos', asunto: 'Prueba inválida', descripcion: 'Detalle con campos de otro módulo', detalle: { id_maquinaria: 'MAQ-1' } } },
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'API Mesa de Ayuda ERP/POS',
    version: '1.0.0',
    description: [
      'Sistema Inteligente de Soporte y Éxito del Cliente — MongoDB + Express.',
      '',
      '**Cómo probar:** ejecute `POST /auth/login` con una cuenta de demo (ej. `admin@helpdesk.local` / `Admin#Helpdesk2026`, o `maria@comercialandina.co` / `Demo#Helpdesk2026`), copie el `token` y péguelo en el botón **Authorize**.',
    ].join('\n'),
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'Auth', description: 'Registro, verificación, login con JWT y recuperación' },
    { name: 'Tickets', description: 'Tickets polimórficos, máquina de estados y SLA' },
    { name: 'Base de conocimientos', description: 'Búsqueda de texto en español' },
    { name: 'Clientes y membresías', description: 'Pagos con transacción multidocumento' },
    { name: 'Usuarios', description: 'Administración de usuarios y roles' },
    { name: 'Reportes', description: 'Framework de Agregación' },
    { name: 'Bitácora', description: 'Auditoría de solo anexado' },
    { name: 'Admin', description: 'Índices, explain y tareas programadas' },
    { name: 'Meta', description: 'Catálogo de módulos para el formulario dinámico' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      ...detalles,
      TicketNuevo: {
        type: 'object',
        required: ['modulo', 'asunto', 'descripcion', 'detalle'],
        properties: {
          modulo: { type: 'string', enum: C.CLAVES_MODULOS },
          tipo: { type: 'string', enum: C.TIPOS_TICKET, default: 'problematica' },
          asunto: { type: 'string', minLength: 5, maxLength: 150 },
          descripcion: { type: 'string', minLength: 10 },
          severidad: { type: 'string', enum: C.SEVERIDADES, default: 'media' },
          canal: { type: 'string', enum: C.CANALES, default: 'web' },
          cliente_id: { type: 'string', description: 'Solo el administrador (crear a nombre de una empresa)' },
          ticket_origen_id: { type: 'string', description: 'Ticket cerrado al que se enlaza' },
          detalle: { oneOf: C.CLAVES_MODULOS.map((k) => ref(`Detalle_${k}`)), description: 'Su forma depende de "modulo" (validado en MongoDB con $jsonSchema + oneOf)' },
        },
      },
      Login: { type: 'object', required: ['correo', 'password'], properties: { correo: { type: 'string', example: 'admin@helpdesk.local' }, password: { type: 'string', example: 'Admin#Helpdesk2026' } } },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/meta': { get: op('Meta', 'Catálogo de módulos, roles, estados y transiciones', { security: [] }) },

    '/auth/login': { post: op('Auth', 'Iniciar sesión (devuelve el JWT)', { security: [], requestBody: { required: true, ...json(ref('Login')) } }) },
    '/auth/registro': { post: op('Auth', 'Registrarse (entra como cliente pendiente de verificación)', { security: [], ...cuerpo({ nombre: { type: 'string' }, tipo_documento: { type: 'string', enum: ['CC', 'CE', 'TI', 'PAS'] }, documento: { type: 'string' }, correo: { type: 'string' }, telefono: { type: 'string' }, password: { type: 'string' }, nit_cliente: { type: 'string' } }, ['nombre', 'documento', 'correo', 'password'], { nombre: 'Usuario Nuevo', tipo_documento: 'CC', documento: '123456789', correo: 'nuevo@prueba.co', password: 'Segura#2026abc', nit_cliente: '901555222-3' }) }) },
    '/auth/verificar': { post: op('Auth', 'Verificar la cuenta con el código', { security: [], ...cuerpo({ token: { type: 'string' } }, ['token']) }) },
    '/auth/reenviar-verificacion': { post: op('Auth', 'Reenviar el código (máx. 3 por hora)') },
    '/auth/yo': { get: op('Auth', 'Usuario autenticado, roles efectivos y su empresa') },
    '/auth/renovar': { post: op('Auth', 'Renovar el token') },
    '/auth/logout': { post: op('Auth', 'Cerrar sesión (invalida los tokens vigentes)') },
    '/auth/recuperar': { post: op('Auth', 'Pedir código para restablecer la contraseña', { security: [], ...cuerpo({ correo: { type: 'string' } }, ['correo']) }) },
    '/auth/restablecer': { post: op('Auth', 'Restablecer la contraseña con el código', { security: [], ...cuerpo({ token: { type: 'string' }, password: { type: 'string' } }, ['token', 'password']) }) },
    '/auth/password': { put: op('Auth', 'Cambiar la propia contraseña', cuerpo({ actual: { type: 'string' }, nueva: { type: 'string' } }, ['actual', 'nueva'])) },
    '/auth/perfil': { put: op('Auth', 'Actualizar el propio perfil y preferencias', cuerpo({ nombre: { type: 'string' }, telefono: { type: 'string' }, preferencias_notificacion: { type: 'object' } })) },

    '/tickets': {
      get: op('Tickets', 'Listar tickets visibles para mi rol', { parameters: [q('modulo', 'Uno o varios separados por coma'), q('estado', 'Uno o varios separados por coma'), q('prioridad', 'Prioridad'), q('tipo', 'problematica | acierto'), q('responsable_id', 'ObjectId o "yo"'), q('sin_asignar', 'true = cola sin asignar'), q('desde', 'Fecha AAAA-MM-DD'), q('hasta', 'Fecha AAAA-MM-DD'), q('q', 'Busca en código o asunto'), ...pag] }),
      post: op('Tickets', 'Crear ticket (polimórfico según el módulo)', { requestBody: { required: true, content: { 'application/json': { schema: ref('TicketNuevo'), examples: ejemplosTicket } } }, responses: { 201: ok('Creado'), ...errores } }),
    },
    '/tickets/{id}': { get: op('Tickets', 'Detalle del ticket (con $lookup de cliente, creador, responsable y artículo)', { parameters: [id()] }) },
    '/tickets/{id}/historial-cliente': { get: op('Tickets', 'Tickets anteriores de la misma empresa', { parameters: [id()] }) },
    '/tickets/{id}/tomar': { post: op('Tickets', 'Soporte toma el ticket de la cola', { parameters: [id()] }) },
    '/tickets/{id}/asignar': { put: op('Tickets', 'Administrador asigna o reasigna', { parameters: [id()], ...cuerpo({ responsable_id: { type: 'string' }, nota: { type: 'string' } }, ['responsable_id']) }) },
    '/tickets/{id}/estado': { post: op('Tickets', 'Cambiar de estado según la máquina de estados', { parameters: [id()], ...cuerpo({ estado: { type: 'string', enum: C.ESTADOS_TICKET }, nota: { type: 'string' } }, ['estado'], { estado: 'en_proceso', nota: 'Revisando logs' }) }) },
    '/tickets/{id}/escalar': { post: op('Tickets', 'Escalar al administrador (motivo obligatorio)', { parameters: [id()], ...cuerpo({ motivo: { type: 'string' } }, ['motivo']) }) },
    '/tickets/{id}/comentarios': { post: op('Tickets', 'Agregar comentario público o interno', { parameters: [id()], ...cuerpo({ texto: { type: 'string' }, visibilidad: { type: 'string', enum: ['publico', 'interno'] } }, ['texto']) }) },
    '/tickets/{id}/articulo': { put: op('Tickets', 'Vincular el artículo que solucionó el ticket', { parameters: [id()], ...cuerpo({ articulo_id: { type: 'string' } }, ['articulo_id']) }) },
    '/tickets/{id}/calificar': { post: op('Tickets', 'Calificar la atención (1 a 5)', { parameters: [id()], ...cuerpo({ puntaje: { type: 'integer', minimum: 1, maximum: 5 }, comentario: { type: 'string' } }, ['puntaje']) }) },

    '/articulos': {
      get: op('Base de conocimientos', 'Buscar artículos en lenguaje natural ($text, ordenado por relevancia)', { parameters: [q('q', 'Texto libre. Ej: factura electrónica rechazada'), q('modulo', 'Filtrar por módulo'), q('estado', 'borrador | publicado | despublicado'), ...pag.slice(0, 2)] }),
      post: op('Base de conocimientos', 'Redactar artículo (queda en borrador)', cuerpo({ titulo: { type: 'string' }, modulo: { type: 'string', enum: C.CLAVES_MODULOS }, contenido: { type: 'string' }, etiquetas: { type: 'array', items: { type: 'string' } } }, ['titulo', 'modulo', 'contenido'])),
    },
    '/articulos/sugerencias': { get: op('Base de conocimientos', 'Sugerencias mientras se redacta un ticket', { parameters: [q('texto', 'Texto escrito por el cliente'), q('modulo', 'Módulo')] }) },
    '/articulos/{id}': {
      get: op('Base de conocimientos', 'Ver artículo', { parameters: [id()] }),
      put: op('Base de conocimientos', 'Editar artículo (sube la versión)', { parameters: [id()], ...cuerpo({ titulo: { type: 'string' }, contenido: { type: 'string' }, etiquetas: { type: 'array', items: { type: 'string' } } }) }),
      delete: op('Base de conocimientos', 'Eliminar (solo si ningún ticket lo referencia)', { parameters: [id()] }),
    },
    '/articulos/{id}/publicar': { post: op('Base de conocimientos', 'Aprobar y publicar (admin)', { parameters: [id()] }) },
    '/articulos/{id}/despublicar': { post: op('Base de conocimientos', 'Despublicar (admin)', { parameters: [id()] }) },
    '/articulos/{id}/votar': { post: op('Base de conocimientos', 'Votar utilidad (cliente)', { parameters: [id()], ...cuerpo({ util: { type: 'boolean' } }) }) },

    '/clientes': {
      get: op('Clientes y membresías', 'Listar empresas', { parameters: [q('q', 'Razón social o NIT'), q('estado', 'Estado de membresía'), q('plan', 'Plan'), q('modulo', 'Módulo contratado'), ...pag] }),
      post: op('Clientes y membresías', 'Registrar empresa con su membresía', cuerpo({ razon_social: { type: 'string' }, nit: { type: 'string' }, correo: { type: 'string' }, telefono: { type: 'string' }, plan: { type: 'string', enum: C.PLANES }, modulos_contratados: { type: 'array', items: { type: 'string', enum: C.CLAVES_MODULOS } } }, ['razon_social', 'nit', 'correo', 'telefono', 'plan', 'modulos_contratados'])),
    },
    '/clientes/{id}': {
      get: op('Clientes y membresías', 'Detalle: membresía, usuarios, pagos e historial', { parameters: [id()] }),
      put: op('Clientes y membresías', 'Actualizar datos, plan, módulos o contacto principal', { parameters: [id()], ...cuerpo({ plan: { type: 'string', enum: C.PLANES }, modulos_contratados: { type: 'array', items: { type: 'string' } }, contacto_principal_id: { type: 'string' } }) }),
    },
    '/clientes/{id}/pagos': {
      get: op('Clientes y membresías', 'Pagos de la empresa', { parameters: [id(), ...pag.slice(0, 2)] }),
      post: op('Clientes y membresías', 'Registrar pago → TRANSACCIÓN (pago + membresía + bitácora)', { parameters: [id()], ...cuerpo({ valor: { type: 'number' }, metodo: { type: 'string', enum: C.METODOS_PAGO }, estado: { type: 'string', enum: C.ESTADOS_PAGO }, simular_fallo: { type: 'boolean', description: 'true = error a mitad de la transacción para demostrar el rollback' } }, ['valor', 'metodo', 'estado'], { valor: 1200000, metodo: 'pse', estado: 'fallido', simular_fallo: false }) }),
    },
    '/clientes/{id}/membresia': { patch: op('Clientes y membresías', 'Cambiar estado de la membresía (transaccional)', { parameters: [id()], ...cuerpo({ estado: { type: 'string', enum: C.ESTADOS_MEMBRESIA }, motivo: { type: 'string' } }, ['estado', 'motivo']) }) },

    '/usuarios': {
      get: op('Usuarios', 'Listar usuarios', { parameters: [q('rol', 'Rol'), q('estado', 'Estado'), q('cliente_id', 'Empresa'), q('q', 'Nombre, correo o documento'), ...pag] }),
      post: op('Usuarios', 'Crear usuario con contraseña temporal (admin)', cuerpo({ nombre: { type: 'string' }, tipo_documento: { type: 'string' }, documento: { type: 'string' }, correo: { type: 'string' }, roles: { type: 'array', items: { type: 'string', enum: C.ROLES } }, cliente_id: { type: 'string' }, especialidades: { type: 'array', items: { type: 'string', enum: C.CLAVES_MODULOS } } }, ['nombre', 'documento', 'correo'])),
    },
    '/usuarios/{id}': {
      get: op('Usuarios', 'Ver usuario', { parameters: [id()] }),
      put: op('Usuarios', 'Actualizar usuario', { parameters: [id()], ...cuerpo({ nombre: { type: 'string' }, telefono: { type: 'string' }, especialidades: { type: 'array', items: { type: 'string' } } }) }),
      delete: op('Usuarios', 'Eliminar (solo sin tickets ni bitácora)', { parameters: [id()] }),
    },
    '/usuarios/{id}/roles': { put: op('Usuarios', 'Asignar o revocar roles (multi-rol; invalida sus sesiones)', { parameters: [id()], ...cuerpo({ roles: { type: 'array', items: { type: 'string', enum: C.ROLES } }, motivo: { type: 'string' } }, ['roles', 'motivo'], { roles: ['soporte', 'auditor'], motivo: 'Apoyo en auditoría' }) }) },
    '/usuarios/{id}/deshabilitar': { patch: op('Usuarios', 'Deshabilitar (borrado lógico)', { parameters: [id()] }) },
    '/usuarios/{id}/habilitar': { patch: op('Usuarios', 'Volver a habilitar', { parameters: [id()] }) },
    '/usuarios/{id}/anonimizar': { post: op('Usuarios', 'Anonimizar datos personales', { parameters: [id()] }) },

    '/reportes': { get: op('Reportes', 'Lista de reportes disponibles') },
    '/reportes/{nombre}': { get: op('Reportes', 'Ejecutar un reporte (devuelve datos + el pipeline usado)', { parameters: [{ name: 'nombre', in: 'path', required: true, schema: { type: 'string', enum: ['modulosIncidencias', 'tiempoPorAgente', 'tiempoPorPlan', 'tasaReapertura', 'cumplimientoSla', 'efectividadArticulos', 'tablero'] } }, q('desde', 'AAAA-MM-DD'), q('hasta', 'AAAA-MM-DD'), q('formato', 'csv | json_descarga')] }) },

    '/bitacora': { get: op('Bitácora', 'Consultar la bitácora', { parameters: [q('accion', 'Acción(es)'), q('entidad', 'Entidad'), q('correo', 'Correo del usuario'), q('resultado', 'exito | fallo'), q('desde', 'AAAA-MM-DD'), q('hasta', 'AAAA-MM-DD'), ...pag] }) },
    '/bitacora/acciones': { get: op('Bitácora', 'Tipos de acción registrados') },
    '/bitacora/exportar': { get: op('Bitácora', 'Exportar CSV/JSON (queda auditado)', { parameters: [q('formato', 'csv | json')] }) },

    '/admin/indices': { get: op('Admin', 'Índices de cada colección y cuántas veces se han usado') },
    '/admin/explain': { get: op('Admin', 'Consultas de ejemplo disponibles para explain') },
    '/admin/explain/{clave}': { get: op('Admin', 'Ejecutar .explain("executionStats")', { parameters: [{ name: 'clave', in: 'path', required: true, schema: { type: 'string', enum: ['tickets_cliente_estado', 'tickets_responsable', 'cola_abiertos', 'busqueda_texto', 'bitacora_reciente', 'sin_indice'] } }] }) },
    '/admin/tareas': { post: op('Admin', 'Ejecutar ahora las tareas programadas') },
    '/admin/notificaciones': { get: op('Admin', 'Últimas notificaciones encoladas') },
  },
};
