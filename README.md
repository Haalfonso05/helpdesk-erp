# Mesa de Ayuda — Sistema Inteligente de Soporte y Éxito del Cliente (ERP/POS)

Proyecto de aula de **Gestión de Base de Datos (UFPSO)**. Es full-stack:

- **MongoDB Atlas**: modelo híbrido (embebido + referenciado), tickets polimórficos validados con `$jsonSchema` + `oneOf`, índices compuestos, de texto (español), parciales y TTL, reportes con el Framework de Agregación y transacciones multidocumento.
- **Backend (`/backend`)**: API REST con Node.js + Express + driver oficial de MongoDB, JWT con multi-rol, matriz de permisos y bitácora de auditoría.
- **Frontend (`/frontend`)**: React + Vite, con formularios dinámicos según el módulo del ERP y búsqueda en vivo en la base de conocimientos.

Requisitos implementados: documento **RQF_Sistema_Soporte_ERP_v2** (roles Cliente, Soporte, Administrador y Auditor).

---

## 1. Requisitos previos

- Node.js 18 o superior (`node -v`)
- Una cuenta gratuita de **MongoDB Atlas** (el clúster M0 sirve). Atlas ya funciona como *replica set*, que es lo que exigen las transacciones (Anexo B).

## 2. Preparar Atlas

1. En Atlas cree un clúster gratuito (o use el del taller).
2. **Database Access** → cree un usuario de base de datos con contraseña.
3. **Network Access** → *Add Current IP Address* (hágalo también el día de la sustentación si cambia de red).
4. **Connect → Drivers** → copie la cadena `mongodb+srv://...`.

## 3. Backend

```bash
cd backend
npm install
cp .env.example .env        # en Windows: copy .env.example .env
```

Edite `.env`:

- `MONGO_URI`: la cadena de Atlas, **entre comillas**, con su usuario y contraseña.
- `JWT_SECRET`: cualquier cadena larga.
- `ADMIN_*`: datos del administrador inicial. Los valores que tengan `#` deben ir entre comillas.

```bash
npm run db:setup     # crea las colecciones con sus validadores $jsonSchema y todos los índices
npm run seed:demo    # admin inicial + datos de demostración (4 empresas, 12 usuarios, 90 tickets, 13 artículos)
npm run dev          # API en http://localhost:4000/api
```

Con la API corriendo, la **documentación interactiva** (Swagger, como el `/docs` de FastAPI) está en **http://localhost:4000/api/docs**. Primero haga login en `POST /auth/login`, copie el `token` y péguelo en **Authorize**.

Otros comandos útiles:

- `npm run seed`: solo crea el administrador inicial. Es idempotente (RQF-04).
- `npm run seed:reset`: borra los datos, pero no los validadores ni los índices, y vuelve a sembrar la demo.
- `npm test`: 19 pruebas de integración. Usan la base `helpdesk_erp_test`.

## 4. Frontend

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:4000/api
npm run dev                 # http://localhost:5173
```

## 5. Usuarios de demostración

Todos usan la contraseña `Demo#Helpdesk2026`, excepto el administrador, que usa la del `.env` (por defecto `Admin#Helpdesk2026`). En la pantalla de inicio de sesión, el desplegable **Cuentas de demostración** llena el formulario con un clic.

| Rol | Correo | Para mostrar |
|---|---|---|
| Administrador | admin@helpdesk.local | Todo: usuarios, membresías, pagos con transacción, reportes, índices y explain |
| Soporte | laura.soporte@helpdesk.local | Cola por especialidad (Ventas Online y POS), tomar tickets, notas internas |
| Soporte + Auditor | sofia.soporte@helpdesk.local | Multi-rol; el interruptor "Actuar como auditor" deja todo en solo lectura |
| Auditor | diego.auditor@helpdesk.local | Lectura total, bitácora y exportaciones |
| Cliente (contacto principal, premium) | maria@comercialandina.co | Ve todos los tickets de su empresa y crea tickets con formulario dinámico |
| Cliente con membresía suspendida | natalia@distrinorte.co | No puede crear tickets ni consultar la base de conocimientos (RQF-22) |
| Cliente en periodo de gracia | esteban@textilesocana.co | Aún tiene servicio |
| Cliente sin verificar | valentina@laespiga.co | Inicia sesión pero no crea tickets (RQF-16) |

## 6. Estructura

```
backend/
  src/config/catalogo.js     Módulos del ERP y campos de cada tipo de ticket (fuente única del polimorfismo)
  src/config/permisos.js     Anexo A: matriz de permisos por rol
  src/db/esquemas.js         Validadores $jsonSchema (tickets con oneOf por módulo)
  src/db/indices.js          Índices (Anexo B)
  src/db/setup.js            Crea colecciones, validadores e índices (idempotente)
  src/db/seed.js             Admin inicial + datos de demo
  src/middlewares/auth.js    JWT, invalidación de sesiones, permisos, solo lectura del auditor
  src/routes/                auth, usuarios, clientes (membresías y pagos), tickets, articulos, reportes, bitacora, admin
  src/services/membresias.js Transacciones multidocumento (pago + membresía + bitácora)
  src/services/reportes.js   Pipelines de agregación (RQF-A6)
  src/services/tareas.js     Tareas programadas (gracia/suspensión, cierre automático, SLA, cola de correos)
  mongosh/                   Consultas listas para la sustentación y rol de solo anexado para la bitácora
  test/api.test.js           Pruebas de integración
frontend/
  src/paginas/               Inicio, Tickets, NuevoTicket (formulario dinámico), TicketDetalle, Conocimiento,
                             Clientes, Usuarios, Reportes, Bitacora, Indices (explain), Perfil, Acceso
```

## 7. Decisiones de modelado (embeber o referenciar)

| Colección | Embebido | Referenciado | Por qué |
|---|---|---|---|
| `clientes` | `membresia` (plan, estado, módulos, fechas) | — | Es 1 a 1, siempre se lee con la empresa y no crece |
| `usuarios` | `roles[]`, `especialidades[]`, preferencias | `cliente_id` | Los roles son pocos y se leen en cada petición; una empresa tiene muchos usuarios |
| `tickets` | `detalle` (polimórfico), `historial_estados[]`, `comentarios[]`, `sla` | `cliente_id`, `usuario_id`, `responsable_id`, `articulo_solucion_id` | El historial y los comentarios se leen siempre con el ticket y crecen poco; las personas y artículos se comparten entre muchos tickets |
| `pagos` | — | `cliente_id` | Crecen sin límite (uno por mes por cliente) |
| `bitacora` | `antes` / `despues` | `usuario_id`, `documento_id` | Solo anexado; crece sin límite |
| `articulos` | `etiquetas[]` | `autor_id`, `revisor_id` | — |

## 8. Dónde está cada requisito clave

| Requisito | Implementación |
|---|---|
| Polimorfismo (RQF-15) | `esquemas.js` genera un `oneOf` con una rama por módulo; el front pide `/api/meta` y dibuja los campos |
| Transacciones (RQF-23) | `services/membresias.js` → `session.withTransaction(...)`. En la pantalla del cliente está la opción **Simular un error** para mostrar el rollback |
| Índices (Anexo B) | `db/indices.js`. La pantalla **Índices y explain** ejecuta `.explain("executionStats")` y muestra IXSCAN o COLLSCAN |
| Búsqueda en lenguaje natural (RQF-29) | Índice de texto `busqueda_texto_es` con pesos; resultados ordenados por `textScore`; sugerencias al redactar un ticket |
| Máquina de estados (RQF-24) | `catalogo.js` → `TRANSICIONES`; `routes/tickets.js` → `transicionar()` con control de concurrencia |
| SLA (RQF-25) | La prioridad sale de la severidad y el plan; se pausa en `en_espera_cliente` |
| Roles y JWT (RQF-06/07/18/19) | `middlewares/auth.js` + `config/permisos.js`. Cambiar roles o contraseña invalida los tokens (`token_version`) |
| Seguridad (RQF-03/17) | bcrypt con costo 12, política de contraseñas, bloqueo tras 5 intentos, límite por IP, mensajes genéricos |
| Bitácora (RQF-34/35/36) | `services/bitacora.js` (solo `insertOne`), consulta con filtros y exportación CSV/JSON auditada |
| Reportes (RQF-A6) | `services/reportes.js`. En la pantalla **Reportes**, el botón **Ver pipeline** muestra el `aggregate` exacto |

### Agregaciones usadas (punto 1 del parcial)

| Etapa | Dónde se usa |
|---|---|
| `$match` | Todos los reportes (rango de fechas, tipo de ticket); detalle de ticket y de cliente |
| `$group` | Tickets por módulo, tiempo por agente y por plan, tasa de reapertura, SLA por prioridad, tablero |
| `$project` | Forma de salida de cada reporte; proyecciones en los `$lookup` |
| `$sort` | Ranking de módulos, agentes y artículos; pagos recientes |
| `$lookup` | Ticket → cliente, creador, responsable y artículo; cliente → usuarios y pagos; agente → usuarios; plan → clientes; artículos → tickets |
| Además | `$unwind`, `$facet` (tablero), `$addFields`/`$switch` (SLA), `$indexStats` |

## 9. Guion sugerido para la sustentación

1. **Polimorfismo**: entrar como María y crear un ticket. Al cambiar el módulo, el formulario cambia. Luego, en mongosh, mostrar `db.getCollectionInfos({name:'tickets'})` y el `oneOf`.
2. **Validación**: intentar un `insertOne` inválido en mongosh (archivo `backend/mongosh/consultas-sustentacion.js`).
3. **Búsqueda**: en la Base de conocimientos escribir "la factura sale rechazada" y comentar el orden por relevancia.
4. **Flujo de soporte**: entrar como Laura, tomar el ticket, dejar una nota interna, pasarlo a "en espera" (el SLA se pausa), resolverlo y vincular un artículo. Volver como María, confirmar y calificar.
5. **Transacción**: entrar como admin, abrir *Clientes → Comercial Andina* y registrar un pago fallido. La membresía queda suspendida y María ya no puede crear tickets. Después marcar *Simular error* y mostrar que no cambió nada.
6. **Índices**: en *Índices y explain*, ejecutar todos y comparar el COLLSCAN con los IXSCAN.
7. **Reportes**: en *Reportes*, usar **Ver pipeline** y correr el mismo pipeline en mongosh.
8. **Auditoría**: entrar como Diego y revisar la *Bitácora* (cambios de rol, pagos, exportaciones).

## 10. Simplificaciones conocidas

- **Correos**: se encolan en la colección `notificaciones` (pendiente → enviada, con reintentos) y el "envío" se imprime en la consola del backend. Para enviarlos de verdad basta cambiar `enviarCorreo` en `services/notificaciones.js` por nodemailer.
- **Desarrollo**: con `MOSTRAR_TOKENS_DEV=true` los códigos de verificación y recuperación también se devuelven en la respuesta. En producción se pone en `false`.
- **Adjuntos (RQF-26)**: no se implementó la subida de archivos.
- **Tareas programadas**: corren dentro del proceso de la API cada hora. También se pueden lanzar desde *Índices y explain → Ejecutar ahora*.
