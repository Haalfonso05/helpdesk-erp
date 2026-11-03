const { ObjectId } = require('mongodb');
const { HttpError } = require('./errores');
const { MODULOS } = require('../config/catalogo');

// Convierte un string en ObjectId o lanza 400
function aId(valor, campo = 'id') {
  if (valor instanceof ObjectId) return valor;
  if (typeof valor !== 'string' || !ObjectId.isValid(valor) || valor.length !== 24) {
    throw new HttpError(400, `El valor de "${campo}" no es un ObjectId válido`);
  }
  return new ObjectId(valor);
}

const aIdONull = (valor, campo) => (valor === null || valor === undefined || valor === '' ? null : aId(valor, campo));

// Paginación + ordenamiento reutilizable (equivalente al plugin "paginar" del taller)
async function paginar(coleccion, filtro = {}, { pagina, limite, orden, proyeccion } = {}) {
  const p = Math.max(parseInt(pagina, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limite, 10) || 10, 1), 100);
  const sort = {};
  String(orden || '-fecha_creacion')
    .split(',')
    .filter(Boolean)
    .forEach((c) => {
      sort[c.replace(/^-/, '')] = c.startsWith('-') ? -1 : 1;
    });
  const [datos, total] = await Promise.all([
    coleccion.find(filtro, { projection: proyeccion }).sort(sort).skip((p - 1) * l).limit(l).toArray(),
    coleccion.countDocuments(filtro),
  ]);
  const totalPaginas = Math.ceil(total / l) || 1;
  return { datos, paginacion: { total, pagina: p, limite: l, totalPaginas, haySiguiente: p < totalPaginas, hayAnterior: p > 1 } };
}

// Escapa texto para usarlo dentro de una expresión regular
const escaparRegex = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// RQF-03: política de contraseñas
function validarPassword(password, { correo, documento } = {}) {
  const errores = [];
  if (typeof password !== 'string' || password.length < 12) errores.push('mínimo 12 caracteres');
  if (!/[A-Z]/.test(password || '')) errores.push('al menos una mayúscula');
  if (!/[a-z]/.test(password || '')) errores.push('al menos una minúscula');
  if (!/[0-9]/.test(password || '')) errores.push('al menos un número');
  if (!/[^A-Za-z0-9]/.test(password || '')) errores.push('al menos un carácter especial');
  const p = String(password || '').toLowerCase();
  if (correo && (p === correo.toLowerCase() || p === correo.split('@')[0].toLowerCase())) errores.push('no puede coincidir con el correo');
  if (documento && p.includes(String(documento).toLowerCase())) errores.push('no puede contener el número de documento');
  if (errores.length) throw new HttpError(400, `La contraseña no cumple la política: ${errores.join(', ')}`);
}

/**
 * Limpia el subdocumento "detalle" según el módulo: deja solo los campos del catálogo,
 * convierte números (los formularios mandan strings) y quita los vacíos.
 * La validación definitiva la hace MongoDB con el $jsonSchema (oneOf).
 */
function limpiarDetalle(modulo, detalle = {}) {
  const def = MODULOS[modulo];
  if (!def) throw new HttpError(400, `Módulo inválido: ${modulo}`);
  const limpio = {};
  for (const campo of def.campos) {
    let v = detalle?.[campo.clave];
    if (v === undefined || v === null || v === '') continue;
    if (campo.tipo === 'entero') {
      const n = Number(v);
      if (!Number.isInteger(n)) throw new HttpError(400, `"${campo.etiqueta}" debe ser un número entero`);
      v = n;
    } else if (campo.tipo === 'decimal') {
      const n = Number(v);
      if (Number.isNaN(n)) throw new HttpError(400, `"${campo.etiqueta}" debe ser numérico`);
      v = n;
    } else {
      v = String(v).trim();
    }
    limpio[campo.clave] = v;
  }
  return limpio;
}

const ipDe = (req) => (req?.headers?.['x-forwarded-for']?.split(',')[0] || req?.ip || null);

module.exports = { aId, aIdONull, paginar, escaparRegex, validarPassword, limpiarDetalle, ipDe };
