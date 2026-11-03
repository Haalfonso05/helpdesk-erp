// RQF-34: refuerzo a nivel de usuario de base de datos.
// Crea un rol que puede INSERTAR y LEER la bitácora pero no actualizar ni borrar.
// En MongoDB local (mongosh, con un usuario administrador):
use('helpdesk_erp');
db.createRole({
  role: 'appHelpdesk',
  privileges: [
    { resource: { db: 'helpdesk_erp', collection: 'bitacora' }, actions: ['find', 'insert'] },
    ...['usuarios', 'clientes', 'pagos', 'tickets', 'articulos', 'notificaciones', 'tokens', 'contadores'].map((c) => ({
      resource: { db: 'helpdesk_erp', collection: c },
      actions: ['find', 'insert', 'update', 'remove', 'createIndex'],
    })),
  ],
  roles: [],
});
// db.createUser({ user: 'app_helpdesk', pwd: passwordPrompt(), roles: ['appHelpdesk'] });
//
// En MongoDB Atlas: Database Access → Custom Roles → "Add New Custom Role" con las mismas acciones
// (find + insert sobre bitacora; find/insert/update/remove sobre el resto) y asígnelo al usuario de la app.
