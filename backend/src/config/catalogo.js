/**
 * Catálogo único de módulos del ERP y de los campos propios de cada tipo de ticket.
 * Es la "fuente única de verdad" del polimorfismo:
 *  - El validador $jsonSchema (oneOf) de la colección tickets se genera a partir de aquí.
 *  - El backend limpia y convierte los datos del subdocumento "detalle" con estas reglas.
 *  - El frontend pide este catálogo (GET /api/meta) y dibuja el formulario dinámico.
 *
 * tipos: texto | texto_largo | url | entero | decimal | opcion
 */
const MODULOS = {
  ventas_online: {
    nombre: 'Ventas Online (E-commerce)',
    campos: [
      { clave: 'id_pasarela', etiqueta: 'ID de la pasarela de pago', tipo: 'texto', requerido: true },
      { clave: 'url_error', etiqueta: 'URL donde ocurrió el error', tipo: 'url', requerido: true },
      { clave: 'navegador', etiqueta: 'Navegador web', tipo: 'opcion', opciones: ['Chrome', 'Firefox', 'Edge', 'Safari', 'Otro'], requerido: true },
      { clave: 'log_api', etiqueta: 'Log de la API', tipo: 'texto_largo', requerido: false },
    ],
  },
  inventarios: {
    nombre: 'Manejo de Inventarios',
    campos: [
      { clave: 'bodega', etiqueta: 'Bodega', tipo: 'texto', requerido: true },
      { clave: 'codigo_barras', etiqueta: 'Código de barras del producto', tipo: 'texto', requerido: true },
      { clave: 'tipo_alerta', etiqueta: 'Tipo de novedad', tipo: 'opcion', opciones: ['stock_minimo', 'descuadre', 'codigo_ilegible', 'otro'], requerido: true },
      { clave: 'cantidad_sistema', etiqueta: 'Cantidad en el sistema', tipo: 'entero', requerido: false },
      { clave: 'cantidad_fisica', etiqueta: 'Cantidad física contada', tipo: 'entero', requerido: false },
    ],
  },
  compras: {
    nombre: 'Compras',
    campos: [
      { clave: 'proveedor_nit', etiqueta: 'NIT del proveedor', tipo: 'texto', requerido: true },
      { clave: 'orden_compra', etiqueta: 'Número de orden de compra', tipo: 'texto', requerido: true },
      { clave: 'etapa', etiqueta: 'Etapa del proceso', tipo: 'opcion', opciones: ['cotizacion', 'orden', 'recepcion', 'cuentas_por_pagar'], requerido: true },
      { clave: 'valor_orden', etiqueta: 'Valor de la orden', tipo: 'decimal', requerido: false },
    ],
  },
  produccion: {
    nombre: 'Producción (Manufactura)',
    campos: [
      { clave: 'id_maquinaria', etiqueta: 'ID de la maquinaria', tipo: 'texto', requerido: true },
      { clave: 'codigo_lote', etiqueta: 'Código de lote', tipo: 'texto', requerido: true },
      { clave: 'fase', etiqueta: 'Fase del proceso', tipo: 'opcion', opciones: ['mezclado', 'coccion', 'envasado', 'empaque'], requerido: true },
      { clave: 'temperatura_sensor', etiqueta: 'Temperatura del sensor (°C)', tipo: 'decimal', requerido: false },
    ],
  },
  pos: {
    nombre: 'Ventas en Sitio (Caja/POS)',
    campos: [
      { clave: 'caja_id', etiqueta: 'ID de la caja', tipo: 'texto', requerido: true },
      { clave: 'turno', etiqueta: 'Turno del cajero', tipo: 'opcion', opciones: ['manana', 'tarde', 'noche'], requerido: true },
      { clave: 'numero_factura', etiqueta: 'Número de factura', tipo: 'texto', requerido: false },
      { clave: 'medio_pago', etiqueta: 'Medio de pago', tipo: 'opcion', opciones: ['efectivo', 'tarjeta', 'transferencia', 'mixto'], requerido: false },
    ],
  },
};

const CLAVES_MODULOS = Object.keys(MODULOS);

const ROLES = ['cliente', 'soporte', 'administrador', 'auditor'];

const ESTADOS_USUARIO = ['pendiente_verificacion', 'activo', 'inactivo'];

const PLANES = ['basico', 'estandar', 'premium'];
const ESTADOS_MEMBRESIA = ['activa', 'en_gracia', 'suspendida', 'vencida', 'cancelada'];
const METODOS_PAGO = ['tarjeta', 'pse', 'transferencia', 'efectivo'];
const ESTADOS_PAGO = ['aprobado', 'pendiente', 'fallido'];

const TIPOS_TICKET = ['problematica', 'acierto']; // incidente técnico / sugerencia de mejora
const CANALES = ['web', 'correo', 'telefono', 'chat'];
const SEVERIDADES = ['baja', 'media', 'alta', 'critica'];
const PRIORIDADES = ['baja', 'media', 'alta', 'critica'];

const ESTADOS_TICKET = ['nuevo', 'asignado', 'en_proceso', 'en_espera_cliente', 'escalado', 'resuelto', 'cerrado', 'reabierto'];
const ESTADOS_ABIERTOS = ['nuevo', 'asignado', 'en_proceso', 'en_espera_cliente', 'escalado', 'reabierto'];

// RQF-24: transiciones permitidas de la máquina de estados
const TRANSICIONES = {
  nuevo: ['asignado', 'escalado'],
  asignado: ['en_proceso', 'escalado'],
  en_proceso: ['en_espera_cliente', 'resuelto', 'escalado'],
  en_espera_cliente: ['en_proceso', 'resuelto'],
  escalado: ['asignado', 'en_proceso'],
  resuelto: ['cerrado', 'reabierto'],
  cerrado: ['reabierto'],
  reabierto: ['asignado', 'en_proceso', 'escalado'],
};

// RQF-25: tiempos objetivo (horas) por prioridad
const SLA_HORAS = {
  critica: { respuesta: 1, resolucion: 8 },
  alta: { respuesta: 4, resolucion: 24 },
  media: { respuesta: 8, resolucion: 48 },
  baja: { respuesta: 24, resolucion: 72 },
};

const DIAS_CIERRE_AUTOMATICO = 5; // RQF-24
const DIAS_PLAZO_REAPERTURA = 15; // RQF-24
const DIAS_GRACIA_MEMBRESIA = Number(process.env.DIAS_GRACIA_MEMBRESIA || 5); // RQF-21

const ESTADOS_ARTICULO = ['borrador', 'publicado', 'despublicado'];

module.exports = {
  MODULOS,
  CLAVES_MODULOS,
  ROLES,
  ESTADOS_USUARIO,
  PLANES,
  ESTADOS_MEMBRESIA,
  METODOS_PAGO,
  ESTADOS_PAGO,
  TIPOS_TICKET,
  CANALES,
  SEVERIDADES,
  PRIORIDADES,
  ESTADOS_TICKET,
  ESTADOS_ABIERTOS,
  TRANSICIONES,
  SLA_HORAS,
  DIAS_CIERRE_AUTOMATICO,
  DIAS_PLAZO_REAPERTURA,
  DIAS_GRACIA_MEMBRESIA,
  ESTADOS_ARTICULO,
};
