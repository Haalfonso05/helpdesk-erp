/**
 * Validadores $jsonSchema de cada colección (validationLevel: strict, validationAction: error).
 * El de "tickets" usa oneOf para validar el subdocumento "detalle" según el módulo (polimorfismo).
 */
const C = require('../config/catalogo');

const fecha = { bsonType: 'date' };
const fechaONull = { bsonType: ['date', 'null'] };
const oid = { bsonType: 'objectId' };
const oidONull = { bsonType: ['objectId', 'null'] };
const texto = (min = 1, max = 5000) => ({ bsonType: 'string', minLength: min, maxLength: max });
const enumDe = (valores) => ({ bsonType: 'string', enum: valores });

// Convierte un campo del catálogo en una regla de $jsonSchema
function reglaCampo(campo) {
  switch (campo.tipo) {
    case 'url':
      return { bsonType: 'string', pattern: '^https?://', description: `${campo.etiqueta} (debe iniciar con http:// o https://)` };
    case 'entero':
      return { bsonType: ['int', 'long'], minimum: 0, description: campo.etiqueta };
    case 'decimal':
      return { bsonType: ['int', 'long', 'double', 'decimal'], description: campo.etiqueta };
    case 'opcion':
      return { bsonType: 'string', enum: campo.opciones, description: campo.etiqueta };
    default:
      return { bsonType: 'string', minLength: 1, maxLength: campo.tipo === 'texto_largo' ? 20000 : 300, description: campo.etiqueta };
  }
}

// Una rama del oneOf por cada módulo: { modulo: "x", detalle: { ...campos de x } }
function ramaModulo(clave) {
  const { campos } = C.MODULOS[clave];
  return {
    properties: {
      modulo: { enum: [clave] },
      detalle: {
        bsonType: 'object',
        required: campos.filter((c) => c.requerido).map((c) => c.clave),
        additionalProperties: false,
        properties: Object.fromEntries(campos.map((c) => [c.clave, reglaCampo(c)])),
      },
    },
  };
}

const usuarios = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'usuarios',
    required: ['nombre', 'tipo_documento', 'documento', 'correo', 'password_hash', 'roles', 'estado', 'token_version', 'fecha_creacion'],
    additionalProperties: false,
    properties: {
      _id: oid,
      nombre: texto(3, 100),
      tipo_documento: enumDe(['CC', 'CE', 'TI', 'NIT', 'PAS']),
      documento: { bsonType: 'string', pattern: '^[0-9A-Za-z-]{5,20}$' },
      correo: { bsonType: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
      telefono: { bsonType: ['string', 'null'], pattern: '^[0-9+ ]{7,15}$' },
      password_hash: { bsonType: 'string' },
      password_temporal: { bsonType: 'bool' },
      roles: { bsonType: 'array', minItems: 1, uniqueItems: true, items: enumDe(C.ROLES) },
      estado: enumDe(C.ESTADOS_USUARIO),
      cliente_id: oidONull,
      especialidades: { bsonType: 'array', uniqueItems: true, items: enumDe(C.CLAVES_MODULOS) },
      intentos_fallidos: { bsonType: 'int', minimum: 0 },
      bloqueado_hasta: fechaONull,
      token_version: { bsonType: 'int', minimum: 0 },
      preferencias_notificacion: {
        bsonType: 'object',
        additionalProperties: false,
        properties: {
          frecuencia: enumDe(['inmediata', 'resumen_diario']),
          tickets: { bsonType: 'bool' },
          membresia: { bsonType: 'bool' },
        },
      },
      anonimizado: { bsonType: 'bool' },
      fecha_creacion: fecha,
      fecha_actualizacion: fecha,
      ultimo_acceso: fechaONull,
    },
  },
};

const clientes = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'clientes (empresas corporativas)',
    required: ['razon_social', 'nit', 'correo', 'telefono', 'membresia', 'fecha_creacion'],
    additionalProperties: false,
    properties: {
      _id: oid,
      razon_social: texto(2, 150),
      nit: { bsonType: 'string', pattern: '^[0-9-]{5,20}$' },
      correo: { bsonType: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
      telefono: { bsonType: 'string', pattern: '^[0-9+ ]{7,15}$' },
      contacto_principal_id: oidONull,
      // Membresía EMBEBIDA: relación 1 a 1, siempre se lee junto con la empresa y no crece
      membresia: {
        bsonType: 'object',
        required: ['plan', 'estado', 'modulos_contratados', 'fecha_inicio', 'fecha_renovacion'],
        additionalProperties: false,
        properties: {
          plan: enumDe(C.PLANES),
          estado: enumDe(C.ESTADOS_MEMBRESIA),
          modulos_contratados: { bsonType: 'array', minItems: 1, uniqueItems: true, items: enumDe(C.CLAVES_MODULOS) },
          metodo_pago: enumDe(C.METODOS_PAGO),
          fecha_inicio: fecha,
          fecha_renovacion: fecha,
          fecha_ultimo_cambio: fecha,
        },
      },
      fecha_creacion: fecha,
    },
  },
};

const pagos = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['cliente_id', 'valor', 'metodo', 'estado', 'fecha'],
    additionalProperties: false,
    properties: {
      _id: oid,
      cliente_id: oid,
      valor: { bsonType: ['int', 'long', 'double', 'decimal'], minimum: 0, exclusiveMinimum: true },
      metodo: enumDe(C.METODOS_PAGO),
      estado: enumDe(C.ESTADOS_PAGO),
      referencia: { bsonType: 'string' },
      fecha: fecha,
      registrado_por: oidONull,
    },
  },
};

const tickets = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'tickets (colección polimórfica)',
    required: [
      'codigo', 'cliente_id', 'usuario_id', 'modulo', 'tipo', 'asunto', 'descripcion', 'canal',
      'severidad', 'prioridad', 'estado', 'responsable_id', 'fecha_creacion', 'fecha_actualizacion',
      'fecha_cierre', 'detalle', 'historial_estados', 'sla',
    ],
    additionalProperties: false,
    properties: {
      _id: oid,
      codigo: { bsonType: 'string', pattern: '^TK-[0-9]{6}$' },
      cliente_id: oid,
      usuario_id: oid,
      modulo: enumDe(C.CLAVES_MODULOS),
      tipo: enumDe(C.TIPOS_TICKET),
      asunto: texto(5, 150),
      descripcion: texto(10, 5000),
      canal: enumDe(C.CANALES),
      severidad: enumDe(C.SEVERIDADES),
      prioridad: enumDe(C.PRIORIDADES),
      estado: enumDe(C.ESTADOS_TICKET),
      responsable_id: oidONull,
      membresia: {
        bsonType: 'object',
        properties: { plan: enumDe(C.PLANES), estado: enumDe(C.ESTADOS_MEMBRESIA) },
      },
      detalle: { bsonType: 'object' }, // la forma exacta la define el oneOf de abajo
      sla: {
        bsonType: 'object',
        required: ['vence_respuesta', 'vence_resolucion'],
        properties: {
          vence_respuesta: fecha,
          vence_resolucion: fecha,
          pausado_desde: fechaONull,
          minutos_pausa: { bsonType: ['int', 'long', 'double'], minimum: 0 },
          notificado_incumplimiento: { bsonType: 'bool' },
        },
      },
      // Historial EMBEBIDO: crece poco (algunas transiciones) y siempre se consulta con el ticket
      historial_estados: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['de', 'a', 'fecha', 'usuario_id'],
          properties: {
            de: { bsonType: ['string', 'null'] },
            a: enumDe(C.ESTADOS_TICKET),
            fecha: fecha,
            usuario_id: oidONull,
            nota: { bsonType: 'string' },
          },
        },
      },
      comentarios: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['_id', 'usuario_id', 'texto', 'visibilidad', 'fecha'],
          properties: {
            _id: oid,
            usuario_id: oid,
            autor: { bsonType: 'string' },
            texto: texto(1, 5000),
            visibilidad: enumDe(['publico', 'interno']),
            fecha: fecha,
          },
        },
      },
      escalamiento: {
        bsonType: 'object',
        properties: { motivo: texto(5, 1000), fecha: fecha, por: oid },
      },
      articulo_solucion_id: oidONull,
      calificacion: {
        bsonType: 'object',
        required: ['puntaje', 'fecha'],
        properties: { puntaje: { bsonType: 'int', minimum: 1, maximum: 5 }, comentario: { bsonType: 'string' }, fecha: fecha },
      },
      reaperturas: { bsonType: 'int', minimum: 0, maximum: 1 },
      ticket_origen_id: oidONull,
      fecha_creacion: fecha,
      fecha_actualizacion: fecha,
      fecha_primera_respuesta: fechaONull,
      fecha_resolucion: fechaONull,
      fecha_cierre: fechaONull,
    },
    oneOf: C.CLAVES_MODULOS.map(ramaModulo),
  },
};

const articulos = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'articulos (base de conocimientos)',
    required: ['titulo', 'modulo', 'contenido', 'etiquetas', 'autor_id', 'estado', 'version', 'resoluciones', 'votos_utiles', 'votos_no_utiles', 'fecha_creacion'],
    additionalProperties: false,
    properties: {
      _id: oid,
      titulo: texto(5, 200),
      modulo: enumDe(C.CLAVES_MODULOS),
      contenido: texto(20, 50000),
      etiquetas: { bsonType: 'array', uniqueItems: true, items: { bsonType: 'string', minLength: 1, maxLength: 40 } },
      autor_id: oid,
      revisor_id: oidONull,
      estado: enumDe(C.ESTADOS_ARTICULO),
      version: { bsonType: 'int', minimum: 1 },
      resoluciones: { bsonType: 'int', minimum: 0 },
      votos_utiles: { bsonType: 'int', minimum: 0 },
      votos_no_utiles: { bsonType: 'int', minimum: 0 },
      fecha_creacion: fecha,
      fecha_actualizacion: fecha,
      fecha_publicacion: fechaONull,
    },
  },
};

const bitacora = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'bitacora (solo anexado)',
    required: ['fecha', 'accion', 'entidad', 'resultado'],
    properties: {
      _id: oid,
      fecha: fecha,
      usuario_id: oidONull,
      correo: { bsonType: ['string', 'null'] },
      rol: { bsonType: ['string', 'null'] },
      accion: texto(3, 80),
      entidad: texto(3, 40),
      documento_id: {},
      antes: {},
      despues: {},
      ip: { bsonType: ['string', 'null'] },
      resultado: enumDe(['exito', 'fallo']),
      detalle: { bsonType: 'string' },
    },
  },
};

const notificaciones = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['usuario_id', 'correo', 'tipo', 'asunto', 'cuerpo', 'estado', 'intentos', 'fecha_creacion'],
    properties: {
      usuario_id: oidONull,
      correo: { bsonType: 'string' },
      tipo: texto(3, 60),
      asunto: texto(1, 200),
      cuerpo: { bsonType: 'string' },
      estado: enumDe(['pendiente', 'enviada', 'fallida']),
      intentos: { bsonType: 'int', minimum: 0 },
      fecha_creacion: fecha,
      fecha_envio: fechaONull,
    },
  },
};

const tokens = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['usuario_id', 'tipo', 'token_hash', 'expira', 'usado'],
    properties: {
      usuario_id: oid,
      tipo: enumDe(['verificacion', 'recuperacion']),
      token_hash: { bsonType: 'string' },
      expira: fecha,
      usado: { bsonType: 'bool' },
      fecha_creacion: fecha,
    },
  },
};

module.exports = { usuarios, clientes, pagos, tickets, articulos, bitacora, notificaciones, tokens };
