/**
 * Siembra de datos.
 *   npm run seed            → crea el Administrador inicial desde el .env (RQF-04). Idempotente.
 *   npm run seed:demo       → además carga datos de demostración (empresas, usuarios, tickets, artículos…)
 *   npm run seed:demo -- --reset  → borra los datos (no los validadores ni índices) y vuelve a sembrar
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { conectarDB, cerrarDB } = require('../config/db');
const { prepararBaseDeDatos } = require('./setup');
const C = require('../config/catalogo');
const { calcularPrioridad, calcularSla } = require('../services/tickets');

const DEMO_PASSWORD = 'Demo#Helpdesk2026';
const HORA = 3600e3;
const DIA = 24 * HORA;

// Generador pseudoaleatorio con semilla: los datos de demo salen iguales siempre
let semilla = 20261103;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const elegir = (arr) => arr[Math.floor(azar() * arr.length)];
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));

async function crearAdminInicial(db) {
  const existe = await db.collection('usuarios').findOne({ roles: 'administrador' });
  if (existe) {
    console.log(`Ya existe un administrador (${existe.correo}); no se crea otro.`);
    return existe;
  }
  const { ADMIN_CORREO, ADMIN_PASSWORD, ADMIN_NOMBRE, ADMIN_DOCUMENTO } = process.env;
  if (!ADMIN_CORREO || !ADMIN_PASSWORD) throw new Error('Defina ADMIN_CORREO y ADMIN_PASSWORD en el .env');
  const ahora = new Date();
  const admin = {
    nombre: ADMIN_NOMBRE || 'Administrador',
    tipo_documento: 'CC',
    documento: ADMIN_DOCUMENTO || '1000000000',
    correo: ADMIN_CORREO.toLowerCase(),
    telefono: null,
    password_hash: await bcrypt.hash(ADMIN_PASSWORD, 12),
    roles: ['administrador'],
    estado: 'activo',
    cliente_id: null,
    especialidades: [],
    intentos_fallidos: 0,
    bloqueado_hasta: null,
    token_version: 0,
    preferencias_notificacion: { frecuencia: 'inmediata', tickets: true, membresia: true },
    fecha_creacion: ahora,
    fecha_actualizacion: ahora,
    ultimo_acceso: null,
  };
  const { insertedId } = await db.collection('usuarios').insertOne(admin);
  await db.collection('bitacora').insertOne({ fecha: ahora, usuario_id: null, correo: 'sistema', rol: 'sistema', accion: 'crear_admin_inicial', entidad: 'usuario', documento_id: insertedId, antes: null, despues: { correo: admin.correo }, ip: null, resultado: 'exito' });
  console.log(`Administrador inicial creado: ${admin.correo}`);
  return { ...admin, _id: insertedId };
}

// ───────────────────────────── Datos de demostración ─────────────────────────────

const EMPRESAS = [
  { razon_social: 'Comercial Andina SAS', nit: '900123456-1', correo: 'contacto@comercialandina.co', telefono: '3001234567', plan: 'premium', estado: 'activa', modulos: ['ventas_online', 'inventarios', 'pos'] },
  { razon_social: 'Panadería La Espiga', nit: '901555222-3', correo: 'gerencia@laespiga.co', telefono: '3157654321', plan: 'estandar', estado: 'activa', modulos: ['produccion', 'pos', 'inventarios'] },
  { razon_social: 'Distribuidora del Norte', nit: '800777888-5', correo: 'admin@distrinorte.co', telefono: '3209876543', plan: 'basico', estado: 'suspendida', modulos: ['compras', 'inventarios'] },
  { razon_social: 'Textiles Ocaña', nit: '902333444-7', correo: 'info@textilesocana.co', telefono: '3014567890', plan: 'estandar', estado: 'en_gracia', modulos: ['produccion', 'compras', 'ventas_online'] },
];

const PERSONAL = [
  { nombre: 'Laura Gómez', correo: 'laura.soporte@helpdesk.local', roles: ['soporte'], especialidades: ['ventas_online', 'pos'] },
  { nombre: 'Andrés Pérez', correo: 'andres.soporte@helpdesk.local', roles: ['soporte'], especialidades: ['inventarios', 'compras'] },
  { nombre: 'Camila Rojas', correo: 'camila.soporte@helpdesk.local', roles: ['soporte'], especialidades: ['produccion', 'inventarios'] },
  { nombre: 'Diego Martínez', correo: 'diego.auditor@helpdesk.local', roles: ['auditor'], especialidades: [] },
  { nombre: 'Sofía Herrera', correo: 'sofia.soporte@helpdesk.local', roles: ['soporte', 'auditor'], especialidades: ['ventas_online', 'compras', 'pos'] },
];

const CLIENTES_USUARIOS = [
  { empresa: 0, nombre: 'María Fernanda Ruiz', correo: 'maria@comercialandina.co', principal: true },
  { empresa: 0, nombre: 'Julián Castro', correo: 'julian@comercialandina.co' },
  { empresa: 1, nombre: 'Carlos Quintero', correo: 'carlos@laespiga.co', principal: true },
  { empresa: 2, nombre: 'Natalia Pabón', correo: 'natalia@distrinorte.co', principal: true },
  { empresa: 3, nombre: 'Esteban Navarro', correo: 'esteban@textilesocana.co', principal: true },
  { empresa: 1, nombre: 'Valentina Ortiz', correo: 'valentina@laespiga.co', pendiente: true },
];

const ASUNTOS = {
  ventas_online: [
    ['problematica', 'La pasarela rechaza pagos con tarjeta débito', 'Desde esta mañana los clientes reportan que al pagar con tarjeta débito la pasarela devuelve error 502 y el pedido queda pendiente.'],
    ['problematica', 'El carrito de compras se vacía al iniciar sesión', 'Cuando el comprador agrega productos sin sesión y luego inicia sesión, el carrito aparece vacío y se pierden los productos.'],
    ['problematica', 'Los precios de la tienda web no se sincronizan', 'Actualizamos precios en el ERP pero la tienda web sigue mostrando los valores anteriores después de varias horas.'],
    ['acierto', 'Sugerencia: permitir cupones por categoría', 'Sería muy útil poder crear cupones de descuento que apliquen solo a una categoría de productos en la tienda online.'],
    ['problematica', 'Timeout al confirmar pedidos con muchos ítems', 'Los pedidos con más de 40 productos generan timeout en la API al confirmar el pago.'],
  ],
  inventarios: [
    ['problematica', 'Descuadre de stock en la bodega principal', 'El conteo físico no coincide con las existencias del sistema para varios productos de la bodega principal.'],
    ['problematica', 'La alerta de stock mínimo no se dispara', 'Configuramos stock mínimo en 10 unidades y el producto llegó a 2 sin que el sistema generara la alerta.'],
    ['problematica', 'El lector no reconoce códigos de barras EAN-13', 'Al escanear productos con código EAN-13 el sistema dice que el código no existe aunque está registrado.'],
    ['acierto', 'Sugerencia: reporte de rotación de inventario', 'Nos gustaría un reporte que muestre qué productos rotan más lento para planear promociones.'],
  ],
  compras: [
    ['problematica', 'No se puede aprobar la orden de compra', 'Al intentar aprobar una orden de compra el botón queda cargando y nunca cambia de estado.'],
    ['problematica', 'Cuentas por pagar duplicadas al recibir mercancía', 'Cada vez que registramos la recepción parcial se crea una cuenta por pagar duplicada al proveedor.'],
    ['problematica', 'Error al registrar un proveedor nuevo con NIT', 'El sistema rechaza el NIT del proveedor indicando formato inválido aunque incluye el dígito de verificación.'],
    ['acierto', 'Sugerencia: comparar cotizaciones de proveedores', 'Proponemos una vista para comparar varias cotizaciones de distintos proveedores lado a lado.'],
  ],
  produccion: [
    ['problematica', 'El sensor de temperatura reporta valores fuera de rango', 'La máquina de cocción reporta temperaturas de 400 °C, lo cual es imposible; parece un error de lectura del sensor.'],
    ['problematica', 'No se descuenta la materia prima al cerrar el lote', 'Al cerrar un lote de producción la receta no descuenta la materia prima del inventario.'],
    ['problematica', 'El costo de fabricación del lote sale en cero', 'El reporte de costos de fabricación muestra cero para los lotes de la última semana.'],
    ['acierto', 'Sugerencia: alertas de mantenimiento preventivo', 'Sería ideal recibir alertas cuando una maquinaria complete cierto número de horas de uso.'],
  ],
  pos: [
    ['problematica', 'La factura electrónica es rechazada por la DIAN', 'Las facturas generadas en caja son rechazadas con el error de validación del CUFE.'],
    ['problematica', 'El cierre de turno no cuadra con el efectivo', 'Al cerrar el turno el sistema muestra un faltante que no coincide con el dinero contado en caja.'],
    ['problematica', 'La impresora térmica no imprime el tiquete', 'Después de la actualización la impresora térmica de la caja 2 dejó de imprimir los tiquetes de venta.'],
    ['problematica', 'El POS se congela al aplicar descuentos', 'Cuando el cajero aplica un descuento manual la pantalla se congela por varios segundos.'],
    ['acierto', 'Sugerencia: atajos de teclado en caja', 'Los cajeros piden atajos de teclado para las acciones más comunes y así agilizar la atención.'],
  ],
};

function detalleDemo(modulo) {
  switch (modulo) {
    case 'ventas_online':
      return { id_pasarela: elegir(['WOMPI-', 'PAYU-', 'EPAYCO-']) + entre(1000, 9999), url_error: `https://tienda.ejemplo.co/checkout/${entre(100, 999)}`, navegador: elegir(['Chrome', 'Firefox', 'Edge', 'Safari']), log_api: `POST /api/pagos → 502 Bad Gateway (upstream timeout ${entre(30, 60)}s)` };
    case 'inventarios':
      return { bodega: elegir(['Principal', 'Norte', 'Sur']), codigo_barras: `770${entre(1000000000, 9999999999)}`, tipo_alerta: elegir(['stock_minimo', 'descuadre', 'codigo_ilegible']), cantidad_sistema: entre(0, 200), cantidad_fisica: entre(0, 200) };
    case 'compras':
      return { proveedor_nit: `${entre(800000000, 999999999)}-${entre(0, 9)}`, orden_compra: `OC-${entre(1000, 9999)}`, etapa: elegir(['cotizacion', 'orden', 'recepcion', 'cuentas_por_pagar']), valor_orden: entre(500, 20000) * 1000 };
    case 'produccion':
      return { id_maquinaria: `MAQ-${entre(1, 20)}`, codigo_lote: `L${entre(2026001, 2026999)}`, fase: elegir(['mezclado', 'coccion', 'envasado', 'empaque']), temperatura_sensor: Math.round((entre(150, 4000) / 10) * 10) / 10 };
    default:
      return { caja_id: `CAJA-${entre(1, 6)}`, turno: elegir(['manana', 'tarde', 'noche']), numero_factura: `FE-${entre(10000, 99999)}`, medio_pago: elegir(['efectivo', 'tarjeta', 'transferencia', 'mixto']) };
  }
}

const ARTICULOS = [
  ['ventas_online', 'Error 502 o timeout de la pasarela al confirmar pagos', 'Cuando la pasarela de pago responde con error 502 o timeout, verifique primero el estado del proveedor. Luego aumente el tiempo de espera de la conexión en Configuración > Ventas Online > Pasarela a 90 segundos y active los reintentos automáticos. Para pedidos grandes divida el lote de confirmación.', ['pasarela', 'timeout', 'pagos', '502']],
  ['ventas_online', 'Sincronizar precios entre el ERP y la tienda web', 'La sincronización de precios corre cada 30 minutos. Si los precios no se actualizan, ejecute la sincronización manual desde Ventas Online > Sincronizar catálogo y revise que la lista de precios web esté marcada como predeterminada.', ['precios', 'sincronizacion', 'catalogo']],
  ['ventas_online', 'El carrito se vacía al iniciar sesión', 'Active la opción "Fusionar carrito de invitado" en la configuración de la tienda. Así los productos agregados antes de iniciar sesión se conservan en el carrito del usuario autenticado.', ['carrito', 'sesion']],
  ['inventarios', 'Cómo corregir un descuadre de inventario', 'Para corregir un descuadre realice un conteo cíclico, registre el ajuste de inventario con el motivo y adjunte el acta. El sistema genera el movimiento de ajuste y actualiza el costo promedio automáticamente.', ['descuadre', 'stock', 'ajuste', 'conteo']],
  ['inventarios', 'Configurar alertas de stock mínimo', 'Las alertas de stock mínimo se configuran por producto y por bodega. Verifique que la bodega tenga activada la opción de alertas y que el usuario tenga habilitadas las notificaciones de inventario.', ['stock', 'alertas', 'minimo', 'bodega']],
  ['inventarios', 'El lector no reconoce códigos EAN-13', 'Revise que el producto tenga el código registrado sin espacios y que el lector esté configurado para enviar Enter al final. Los códigos EAN-13 deben tener exactamente 13 dígitos incluyendo el dígito de control.', ['codigo de barras', 'ean13', 'lector']],
  ['compras', 'La orden de compra no se puede aprobar', 'Si el botón de aprobar queda cargando, verifique que el usuario tenga el nivel de aprobación suficiente para el valor de la orden y que el proveedor no esté bloqueado. Limpie la caché del navegador e intente de nuevo.', ['orden de compra', 'aprobacion']],
  ['compras', 'Cuentas por pagar duplicadas en recepciones parciales', 'Las recepciones parciales deben registrarse sobre la misma orden marcando "recepción parcial". No cree una nueva recepción completa, porque eso duplica la cuenta por pagar. Para corregir anule la cuenta duplicada.', ['cuentas por pagar', 'recepcion', 'duplicado']],
  ['produccion', 'Lecturas anómalas del sensor de temperatura', 'Lecturas fuera de rango suelen indicar un sensor descalibrado o un cable suelto. Reinicie el módulo de adquisición de datos, verifique la calibración y, si persiste, reemplace el sensor. Los datos anómalos pueden marcarse como inválidos en el lote.', ['sensor', 'temperatura', 'maquinaria']],
  ['produccion', 'La materia prima no se descuenta al cerrar el lote', 'Verifique que la receta del producto esté activa y vinculada a la bodega de materias primas. Al cerrar el lote el sistema descuenta según la receta; si no lo hizo, reabra el lote y ciérrelo de nuevo.', ['lote', 'receta', 'materia prima']],
  ['pos', 'Factura electrónica rechazada por error de CUFE', 'El rechazo por CUFE ocurre cuando la resolución de facturación está vencida o la clave técnica es incorrecta. Actualice la resolución en Configuración > Facturación electrónica y reenvíe las facturas rechazadas desde el monitor.', ['factura electronica', 'dian', 'cufe', 'rechazo']],
  ['pos', 'El cierre de turno no cuadra con el efectivo', 'Antes de cerrar el turno revise los retiros parciales y las devoluciones en efectivo. El arqueo debe incluir la base inicial. Si el faltante persiste, genere el reporte detallado de movimientos del turno.', ['cierre de turno', 'arqueo', 'efectivo', 'caja']],
  ['pos', 'La impresora térmica no imprime después de actualizar', 'Reinstale el controlador de la impresora térmica, seleccione el puerto correcto (USB o red) y realice una impresión de prueba desde Configuración > Dispositivos de caja.', ['impresora', 'tiquete', 'caja']],
];

async function sembrarDemo(db, admin) {
  const ahora = Date.now();
  const hashDemo = await bcrypt.hash(DEMO_PASSWORD, 12);
  const usuarioBase = (o) => ({
    tipo_documento: 'CC',
    documento: String(entre(1000000000, 1199999999)),
    telefono: `3${entre(100000000, 299999999)}`,
    password_hash: hashDemo,
    estado: o.pendiente ? 'pendiente_verificacion' : 'activo',
    cliente_id: null,
    especialidades: [],
    intentos_fallidos: 0,
    bloqueado_hasta: null,
    token_version: 0,
    preferencias_notificacion: { frecuencia: 'inmediata', tickets: true, membresia: true },
    fecha_creacion: new Date(ahora - 200 * DIA),
    fecha_actualizacion: new Date(ahora - 200 * DIA),
    ultimo_acceso: null,
    nombre: o.nombre,
    correo: o.correo,
    roles: o.roles || ['cliente'],
  });

  // Empresas con su membresía embebida
  const empresas = [];
  for (const e of EMPRESAS) {
    const renovacion = new Date(ahora + (e.estado === 'activa' ? 20 : -2) * DIA);
    const doc = {
      razon_social: e.razon_social, nit: e.nit, correo: e.correo, telefono: e.telefono,
      contacto_principal_id: null,
      membresia: { plan: e.plan, estado: e.estado, modulos_contratados: e.modulos, metodo_pago: 'pse', fecha_inicio: new Date(ahora - 210 * DIA), fecha_renovacion: renovacion, fecha_ultimo_cambio: new Date(ahora - 5 * DIA) },
      fecha_creacion: new Date(ahora - 210 * DIA),
    };
    doc._id = (await db.collection('clientes').insertOne(doc)).insertedId;
    empresas.push(doc);
    // Pagos mensuales; Distribuidora del Norte con el último pago fallido
    const pagos = [];
    for (let m = 6; m >= 0; m--) {
      const fallido = e.estado === 'suspendida' && m === 0;
      if (e.estado === 'en_gracia' && m === 0) continue;
      pagos.push({ cliente_id: doc._id, valor: { basico: 350000, estandar: 750000, premium: 1200000 }[e.plan], metodo: 'pse', estado: fallido ? 'fallido' : 'aprobado', referencia: `PAY-DEMO-${e.nit.slice(0, 4)}-${m}`, fecha: new Date(ahora - m * 30 * DIA - 3 * DIA), registrado_por: admin._id });
    }
    await db.collection('pagos').insertMany(pagos);
  }

  // Personal de soporte y auditoría
  const personal = [];
  for (const p of PERSONAL) {
    const doc = { ...usuarioBase(p), especialidades: p.especialidades };
    doc._id = (await db.collection('usuarios').insertOne(doc)).insertedId;
    personal.push(doc);
  }
  const agentes = personal.filter((p) => p.roles.includes('soporte'));

  // Usuarios de las empresas
  const clientes = [];
  for (const c of CLIENTES_USUARIOS) {
    const doc = { ...usuarioBase(c), cliente_id: empresas[c.empresa]._id };
    doc._id = (await db.collection('usuarios').insertOne(doc)).insertedId;
    clientes.push({ ...doc, empresa: c.empresa });
    if (c.principal) await db.collection('clientes').updateOne({ _id: empresas[c.empresa]._id }, { $set: { contacto_principal_id: doc._id } });
  }

  // Artículos de la base de conocimientos
  const articulos = ARTICULOS.map(([modulo, titulo, contenido, etiquetas], i) => ({
    titulo, modulo, contenido, etiquetas,
    autor_id: elegir(agentes)._id,
    revisor_id: i === 12 ? null : admin._id,
    estado: i === 12 ? 'borrador' : 'publicado',
    version: entre(1, 3),
    resoluciones: 0,
    votos_utiles: entre(0, 40),
    votos_no_utiles: entre(0, 8),
    fecha_creacion: new Date(ahora - entre(60, 190) * DIA),
    fecha_actualizacion: new Date(ahora - entre(1, 50) * DIA),
    fecha_publicacion: i === 12 ? null : new Date(ahora - entre(50, 59) * DIA),
  }));
  const idsArticulos = Object.values((await db.collection('articulos').insertMany(articulos)).insertedIds);
  articulos.forEach((a, i) => { a._id = idsArticulos[i]; });

  // Tickets (polimórficos)
  const distribucion = [
    ['cerrado', 40], ['resuelto', 10], ['en_proceso', 12], ['asignado', 8], ['nuevo', 14], ['en_espera_cliente', 6], ['escalado', 5], ['reabierto', 5],
  ];
  const elegirEstado = () => {
    let r = azar() * 100;
    for (const [e, p] of distribucion) { if ((r -= p) < 0) return e; }
    return 'nuevo';
  };
  const tickets = [];
  const usadosArticulo = {};
  for (let n = 1; n <= 90; n++) {
    const usuario = elegir(clientes.filter((c) => c.estado === 'activo'));
    const empresa = empresas[usuario.empresa];
    const modulo = elegir(empresa.membresia.modulos_contratados);
    const [tipo, asunto, descripcion] = elegir(ASUNTOS[modulo]);
    const severidad = tipo === 'acierto' ? 'baja' : elegir(['baja', 'media', 'media', 'alta', 'alta', 'critica']);
    const prioridad = calcularPrioridad(severidad, empresa.membresia.plan);
    const reciente = empresa.membresia.estado !== 'activa';
    let estado = elegirEstado();
    if (reciente && estado !== 'cerrado') estado = 'cerrado'; // empresas sin servicio: solo historial
    const horasSla = C.SLA_HORAS[prioridad].resolucion;
    // ~75 % se resuelve dentro del acuerdo de servicio
    const horasRes = azar() < 0.75 ? entre(Math.ceil(horasSla * 0.1), Math.floor(horasSla * 0.9)) : entre(horasSla + 2, horasSla * 3);
    // Los abiertos son recientes; los resueltos, de los últimos días (si no, el cierre automático los cierra)
    const abierto = C.ESTADOS_ABIERTOS.includes(estado);
    const horasAtras = abierto
      ? entre(1, Math.max(2, Math.round(horasSla * (azar() < 0.8 ? 0.7 : 1.6))))
      : estado === 'resuelto' ? horasRes + entre(6, 72) : (entre(12, 170) * 24 + entre(0, 23));
    const creado = new Date(ahora - horasAtras * HORA);

    const conResponsable = estado !== 'nuevo';
    const candidatos = agentes.filter((a) => a.especialidades.includes(modulo));
    const responsable = conResponsable ? elegir(candidatos.length ? candidatos : agentes) : null;
    const sla = calcularSla(prioridad, creado);

    const hist = [{ de: null, a: 'nuevo', fecha: creado, usuario_id: usuario._id }];
    let t = creado.getTime();
    const paso = (de, a, horas, quien, nota) => {
      t += horas * HORA;
      hist.push({ de, a, fecha: new Date(t), usuario_id: quien, ...(nota ? { nota } : {}) });
    };
    let fechaResolucion = null;
    let fechaCierre = null;
    let reaperturas = 0;
    const r = responsable?._id;
    if (conResponsable) paso('nuevo', 'asignado', Math.max(1, Math.floor(horasRes * 0.1)), r, `Tomado por ${responsable.nombre}`);
    if (['en_proceso', 'en_espera_cliente', 'resuelto', 'cerrado', 'reabierto'].includes(estado)) paso('asignado', 'en_proceso', 1, r);
    if (estado === 'escalado') paso('asignado', 'escalado', 2, r, 'Requiere revisión del equipo de desarrollo');
    if (estado === 'en_espera_cliente') paso('en_proceso', 'en_espera_cliente', 2, r, 'Se solicitó información adicional al cliente');
    if (['resuelto', 'cerrado', 'reabierto'].includes(estado)) {
      paso('en_proceso', 'resuelto', Math.max(1, horasRes - (t - creado.getTime()) / HORA), r);
      fechaResolucion = new Date(t);
    }
    if (estado === 'cerrado') {
      paso('resuelto', 'cerrado', entre(4, 60), usuario._id, 'El cliente confirmó la solución');
      fechaCierre = new Date(t);
      if (azar() < 0.12) {
        paso('cerrado', 'reabierto', entre(10, 72), usuario._id, 'El problema volvió a presentarse');
        paso('reabierto', 'en_proceso', 2, r);
        paso('en_proceso', 'resuelto', entre(3, 20), r);
        fechaResolucion = new Date(t);
        paso('resuelto', 'cerrado', entre(4, 30), usuario._id);
        fechaCierre = new Date(t);
        reaperturas = 1;
      }
    }
    if (estado === 'reabierto') {
      paso('resuelto', 'reabierto', entre(4, 40), usuario._id, 'La solución no funcionó');
      fechaResolucion = null;
      reaperturas = 1;
    }
    if (t > ahora) t = ahora - HORA;

    const comentarios = [];
    if (conResponsable) {
      comentarios.push({ _id: new ObjectId(), usuario_id: r, autor: responsable.nombre, texto: 'Hola, ya estamos revisando su caso. Le escribiremos con novedades.', visibilidad: 'publico', fecha: hist[1].fecha });
      if (azar() < 0.5) comentarios.push({ _id: new ObjectId(), usuario_id: r, autor: responsable.nombre, texto: 'Revisar logs del servidor de la empresa antes de responder.', visibilidad: 'interno', fecha: hist[1].fecha });
    }
    let articuloId = null;
    if (fechaResolucion && azar() < 0.55) {
      const a = articulos.find((x) => x.modulo === modulo && x.estado === 'publicado' && azar() < 0.7);
      if (a) {
        articuloId = a._id;
        usadosArticulo[a._id] = (usadosArticulo[a._id] || 0) + 1;
      }
    }

    const ticket = {
      codigo: `TK-${String(n).padStart(6, '0')}`,
      cliente_id: empresa._id,
      usuario_id: usuario._id,
      modulo, tipo, asunto, descripcion,
      canal: elegir(['web', 'web', 'web', 'correo', 'telefono', 'chat']),
      severidad, prioridad, estado,
      responsable_id: r || null,
      membresia: { plan: empresa.membresia.plan, estado: 'activa' },
      detalle: detalleDemo(modulo),
      sla: { ...sla, notificado_incumplimiento: false },
      historial_estados: hist,
      comentarios,
      articulo_solucion_id: articuloId,
      reaperturas,
      ticket_origen_id: null,
      fecha_creacion: creado,
      fecha_actualizacion: new Date(Math.min(t, ahora)),
      fecha_primera_respuesta: conResponsable ? hist[1].fecha : null,
      fecha_resolucion: estado === 'reabierto' ? null : fechaResolucion,
      fecha_cierre: fechaCierre,
    };
    if (estado === 'en_espera_cliente') ticket.sla.pausado_desde = hist[hist.length - 1].fecha;
    if (estado === 'escalado') ticket.escalamiento = { motivo: 'Requiere revisión del equipo de desarrollo', fecha: hist[hist.length - 1].fecha, por: r };
    if (estado === 'cerrado' && azar() < 0.7) ticket.calificacion = { puntaje: entre(3, 5), fecha: fechaCierre, ...(azar() < 0.4 ? { comentario: '¡Muy buena atención!' } : {}) };
    tickets.push(ticket);
  }
  await db.collection('tickets').insertMany(tickets);
  await db.collection('contadores').updateOne({ _id: 'tickets' }, { $set: { valor: tickets.length } }, { upsert: true });
  for (const [id, n] of Object.entries(usadosArticulo)) {
    await db.collection('articulos').updateOne({ _id: new ObjectId(id) }, { $set: { resoluciones: n } });
  }

  await db.collection('bitacora').insertOne({ fecha: new Date(), usuario_id: null, correo: 'sistema', rol: 'sistema', accion: 'seed_demo', entidad: 'sistema', documento_id: null, antes: null, despues: { empresas: empresas.length, usuarios: personal.length + clientes.length, tickets: tickets.length, articulos: articulos.length }, ip: null, resultado: 'exito' });

  console.log(`Demo: ${empresas.length} empresas, ${personal.length + clientes.length} usuarios, ${tickets.length} tickets, ${articulos.length} artículos`);
  console.log(`\nContraseña de todos los usuarios demo: ${DEMO_PASSWORD}`);
  console.log('   Soporte:   laura.soporte@helpdesk.local · andres.soporte@helpdesk.local · camila.soporte@helpdesk.local');
  console.log('   Soporte+Auditor: sofia.soporte@helpdesk.local   Auditor: diego.auditor@helpdesk.local');
  console.log('   Clientes:  maria@comercialandina.co (contacto principal, premium) · carlos@laespiga.co · natalia@distrinorte.co (membresía suspendida) · esteban@textilesocana.co (en gracia)');
}

async function main() {
  const db = await conectarDB();
  await prepararBaseDeDatos(db, { silencioso: true });
  const demo = process.argv.includes('--demo');
  const reset = process.argv.includes('--reset');

  if (reset) {
    for (const c of ['usuarios', 'clientes', 'pagos', 'tickets', 'articulos', 'bitacora', 'notificaciones', 'tokens', 'contadores']) {
      await db.collection(c).deleteMany({});
    }
    console.log('Datos borrados (validadores e índices intactos)');
  }
  const admin = await crearAdminInicial(db);
  if (demo) {
    if (await db.collection('clientes').countDocuments()) {
      console.log('Ya hay datos; use "npm run seed:demo -- --reset" para empezar de cero.');
    } else {
      await sembrarDemo(db, admin);
    }
  }
}

main()
  .catch((e) => {
    console.error('Error:', e.message, e.errInfo ? JSON.stringify(e.errInfo).slice(0, 1500) : '');
    process.exitCode = 1;
  })
  .finally(cerrarDB);
