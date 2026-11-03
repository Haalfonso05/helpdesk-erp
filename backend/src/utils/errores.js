// Envuelve controladores async para mandar los errores a next()
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Saca un resumen legible del error 121 (Document failed validation) de MongoDB
function resumirValidacion(errInfo) {
  const detalles = [];
  const recorrer = (nodo, ruta = '') => {
    if (!nodo || typeof nodo !== 'object') return;
    if (Array.isArray(nodo)) return nodo.forEach((n) => recorrer(n, ruta));
    // En un oneOf (tickets polimórficos) solo interesa la rama del módulo elegido:
    // se descartan las ramas que fallaron únicamente porque el módulo no coincide.
    if (nodo.operatorName === 'oneOf' && Array.isArray(nodo.schemasNotSatisfied)) {
      const fallaModulo = (c) => JSON.stringify(c).includes('"propertyName":"modulo"');
      const relevantes = nodo.schemasNotSatisfied.filter((c) => !fallaModulo(c));
      return recorrer(relevantes.length ? relevantes : nodo.schemasNotSatisfied, ruta);
    }
    if (nodo.propertyName) ruta = ruta ? `${ruta}.${nodo.propertyName}` : nodo.propertyName;
    if (nodo.operatorName && nodo.reason) detalles.push({ campo: ruta || '(documento)', regla: nodo.operatorName, motivo: nodo.reason });
    if (nodo.missingProperties) detalles.push({ campo: ruta || '(documento)', regla: 'required', motivo: `faltan: ${nodo.missingProperties.join(', ')}` });
    if (nodo.additionalProperties) detalles.push({ campo: ruta || '(documento)', regla: 'additionalProperties', motivo: `campos no permitidos: ${nodo.additionalProperties.join(', ')}` });
    for (const v of Object.values(nodo)) if (typeof v === 'object') recorrer(v, ruta);
  };
  recorrer(errInfo?.details);
  const vistos = new Set();
  return detalles.filter((d) => {
    const k = JSON.stringify(d);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  }).slice(0, 15);
}

// Middleware final de errores
function manejadorErrores(err, req, res, _next) {
  if (err.code === 121) {
    return res.status(400).json({
      error: 'El documento no cumple el esquema ($jsonSchema) de la colección',
      detalles: resumirValidacion(err.errInfo),
    });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Valor duplicado', campo: Object.keys(err.keyValue || err.keyPattern || {}) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido' });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message, ...(err.extra || {}) });
}

module.exports = { asyncHandler, HttpError, manejadorErrores };
