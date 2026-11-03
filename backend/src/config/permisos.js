/**
 * Anexo A — Matriz de permisos por rol (fuente única de verdad del control de acceso, RQF-19).
 * Todo endpoint valida el permiso en el servidor; ocultar botones en el frontend no es seguridad.
 * El "alcance" (propios, asignados, todos) se aplica después dentro de cada ruta.
 */
const MATRIZ = {
  'usuarios:crear': ['administrador'],
  'usuarios:consultar': ['soporte', 'administrador', 'auditor'], // soporte solo ve datos de contacto
  'usuarios:actualizar': ['administrador'],
  'usuarios:deshabilitar': ['administrador'],
  'usuarios:roles': ['administrador'],

  'tickets:crear': ['cliente', 'administrador'],
  'tickets:consultar': ['cliente', 'soporte', 'administrador', 'auditor'],
  'tickets:tomar': ['soporte', 'administrador'],
  'tickets:reasignar': ['administrador'],
  'tickets:estado': ['cliente', 'soporte', 'administrador'], // cliente: solo confirmar o reabrir
  'tickets:comentar': ['cliente', 'soporte', 'administrador'],
  'tickets:comentario_interno': ['soporte', 'administrador'],
  'tickets:escalar': ['soporte', 'administrador'],
  'tickets:calificar': ['cliente'],

  'membresias:consultar': ['cliente', 'soporte', 'administrador', 'auditor'],
  'membresias:gestionar': ['administrador'],

  'articulos:consultar': ['cliente', 'soporte', 'administrador', 'auditor'],
  'articulos:redactar': ['soporte', 'administrador'],
  'articulos:publicar': ['administrador'],
  'articulos:votar': ['cliente'],

  'bitacora:consultar': ['administrador', 'auditor'],
  'reportes:propios': ['soporte', 'administrador', 'auditor'],
  'reportes:globales': ['administrador', 'auditor'],
  'reportes:exportar': ['soporte', 'administrador', 'auditor'],
  'indices:configurar': ['administrador'],
};

/**
 * Roles con los que el usuario actúa en esta petición (RQF-07).
 * Si envía el encabezado "X-Contexto: auditoria" y tiene el rol auditor, actúa SOLO como auditor:
 * las restricciones de solo lectura no se anulan por acumular otros roles (RQF-AU4).
 */
function rolesEfectivos(usuario, contexto) {
  if (contexto === 'auditoria' && usuario.roles.includes('auditor')) return ['auditor'];
  return usuario.roles;
}

const puede = (roles, permiso) => (MATRIZ[permiso] || []).some((r) => roles.includes(r));

module.exports = { MATRIZ, rolesEfectivos, puede };
