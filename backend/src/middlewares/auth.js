const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { col } = require('../config/db');
const { HttpError } = require('../utils/errores');
const { rolesEfectivos, puede } = require('../config/permisos');

function firmarToken(usuario) {
  return jwt.sign(
    { sub: String(usuario._id), roles: usuario.roles, tv: usuario.token_version },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRA || '8h' } // RQF-18: máximo 8 horas
  );
}

/**
 * Verifica el JWT y carga el usuario. Rechaza el token si:
 *  - el usuario está inactivo, o
 *  - su token_version cambió (cambio de contraseña, de roles o deshabilitación → RQF-18).
 */
async function autenticar(req, _res, next) {
  try {
    const encabezado = req.headers.authorization || '';
    const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
    if (!token) throw new HttpError(401, 'Debe iniciar sesión');

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new HttpError(401, 'Sesión inválida o expirada');
    }

    const usuario = await col('usuarios').findOne(
      { _id: new ObjectId(payload.sub) },
      { projection: { password_hash: 0 } }
    );
    if (!usuario || usuario.estado === 'inactivo') throw new HttpError(401, 'La cuenta no está habilitada');
    if (usuario.token_version !== payload.tv) throw new HttpError(401, 'La sesión fue cerrada; inicie sesión de nuevo');

    req.usuario = usuario;
    req.roles = rolesEfectivos(usuario, req.headers['x-contexto']);
    next();
  } catch (e) {
    next(e);
  }
}

// Exige un permiso de la matriz (Anexo A)
const requierePermiso = (permiso) => (req, _res, next) => {
  if (!puede(req.roles || [], permiso)) {
    return next(new HttpError(403, `No tiene permiso para esta operación (${permiso})`));
  }
  next();
};

// RQF-AU4: actuando como auditor no se puede modificar nada
function soloLecturaAuditor(req, _res, next) {
  const escritura = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (escritura && req.roles?.length === 1 && req.roles[0] === 'auditor') {
    return next(new HttpError(403, 'El rol Auditor es de solo lectura'));
  }
  next();
}

const tieneRol = (req, rol) => (req.roles || []).includes(rol);

module.exports = { firmarToken, autenticar, requierePermiso, soloLecturaAuditor, tieneRol };
