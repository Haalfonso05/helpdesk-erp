import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useApp } from '../contexto';
import { Aviso, Cargando, Campo, Paginador } from '../componentes/ui';
import { fecha, texto } from '../util';

function EditorRoles({ u, meta, onListo, onError }) {
  const [roles, setRoles] = useState(u.roles);
  const [motivo, setMotivo] = useState('');
  const [esp, setEsp] = useState(u.especialidades || []);
  const alternar = (lista, set, v) => set(lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  const guardar = async (e) => {
    e.preventDefault();
    try {
      await api(`/usuarios/${u._id}/roles`, { method: 'PUT', body: { roles, motivo } });
      if (roles.includes('soporte')) await api(`/usuarios/${u._id}`, { method: 'PUT', body: { especialidades: esp } });
      onListo('Roles actualizados. Las sesiones abiertas de ese usuario se cerraron.');
    } catch (err) { onError(err); }
  };
  return (
    <form className="pila-chica editor-roles" onSubmit={guardar}>
      <fieldset className="casillas"><legend>Roles</legend>
        {meta.roles.map((r) => <label key={r}><input type="checkbox" checked={roles.includes(r)} onChange={() => alternar(roles, setRoles, r)} /> {texto(r)}</label>)}
      </fieldset>
      {roles.includes('soporte') && (
        <fieldset className="casillas"><legend>Especialidades (módulos que atiende)</legend>
          {Object.entries(meta.modulos).map(([k, m]) => <label key={k}><input type="checkbox" checked={esp.includes(k)} onChange={() => alternar(esp, setEsp, k)} /> {m.nombre}</label>)}
        </fieldset>
      )}
      <input required minLength={5} placeholder="Motivo del cambio (queda en la bitácora)" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo" />
      <button className="btn">Guardar roles</button>
    </form>
  );
}

export default function Usuarios() {
  const { meta, tiene } = useApp();
  const [f, setF] = useState({ q: '', rol: '', estado: '' });
  const [pagina, setPagina] = useState(1);
  const [r, setR] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ nombre: '', tipo_documento: 'CC', documento: '', correo: '', telefono: '', roles: ['soporte'] });
  const [clientes, setClientes] = useState([]);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const esAdmin = tiene('administrador');

  const cargar = () => api(`/usuarios${qs({ ...f, pagina, limite: 15, orden: 'nombre' })}`).then(setR).catch(setError);
  useEffect(() => { cargar(); }, [f, pagina]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api('/clientes?limite=100').then((x) => setClientes(x.datos)).catch(() => {}); }, []);

  const accion = async (u, ruta, metodo, msg, body) => {
    setError(null); setOk(null);
    try { await api(`/usuarios/${u._id}${ruta}`, { method: metodo, body }); setOk(msg); cargar(); } catch (err) { setError(err); }
  };
  const crear = async (e) => {
    e.preventDefault();
    try {
      const x = await api('/usuarios', { method: 'POST', body: form });
      setOk(`Usuario creado. Contraseña temporal${x.password_temporal_dev ? `: ${x.password_temporal_dev}` : ' enviada por correo'} (debe cambiarla al ingresar).`);
      setNuevo(false);
      cargar();
    } catch (err) { setError(err); }
  };
  const nombreCliente = (id) => clientes.find((c) => c._id === id)?.razon_social;

  return (
    <div className="pagina">
      <header className="cabecera cabecera-accion">
        <h1>Usuarios</h1>
        {esAdmin && <button className="btn" onClick={() => setNuevo(!nuevo)}>{nuevo ? 'Cancelar' : 'Crear usuario'}</button>}
      </header>
      <Aviso error={error} ok={ok} onCerrar={() => { setError(null); setOk(null); }} />
      {nuevo && (
        <form className="tarjeta pila" onSubmit={crear}>
          <div className="fila-2">
            <Campo etiqueta="Nombre" requerido><input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Correo" requerido><input type="email" required value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} /></Campo>
            <Campo etiqueta="Documento" requerido><input required value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} /></Campo>
            <Campo etiqueta="Rol inicial">
              <select value={form.roles[0]} onChange={(e) => setForm({ ...form, roles: [e.target.value] })}>{meta.roles.map((x) => <option key={x} value={x}>{texto(x)}</option>)}</select>
            </Campo>
          </div>
          {form.roles[0] === 'cliente' && (
            <Campo etiqueta="Empresa">
              <select value={form.cliente_id || ''} onChange={(e) => setForm({ ...form, cliente_id: e.target.value || undefined })}>
                <option value="">Seleccione…</option>
                {clientes.map((c) => <option key={c._id} value={c._id}>{c.razon_social}</option>)}
              </select>
            </Campo>
          )}
          <button className="btn">Crear usuario</button>
        </form>
      )}
      <div className="filtros">
        <input placeholder="Buscar por nombre, correo o documento" value={f.q} onChange={(e) => { setPagina(1); setF({ ...f, q: e.target.value }); }} aria-label="Buscar" />
        <select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })} aria-label="Rol"><option value="">Todos los roles</option>{meta.roles.map((x) => <option key={x} value={x}>{texto(x)}</option>)}</select>
        <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} aria-label="Estado"><option value="">Todo estado</option>{['activo', 'pendiente_verificacion', 'inactivo'].map((x) => <option key={x} value={x}>{texto(x)}</option>)}</select>
      </div>
      {!r ? <Cargando /> : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Roles</th><th>Empresa</th><th>Estado</th><th>Creado</th>{esAdmin && <th />}</tr></thead>
            <tbody>
              {r.datos.map((u) => [
                <tr key={u._id}>
                  <td>{u.nombre}</td>
                  <td>{u.correo}</td>
                  <td>{u.roles.map(texto).join(' + ')}</td>
                  <td>{nombreCliente(u.cliente_id) || <span className="tenue">—</span>}</td>
                  <td><span className={`chip usr-${u.estado}`}>{texto(u.estado)}</span></td>
                  <td className="tenue">{fecha(u.fecha_creacion)}</td>
                  {esAdmin && (
                    <td className="celda-acciones">
                      {!u.anonimizado && <button className="btn btn-fantasma" onClick={() => setAbierto(abierto === u._id ? null : u._id)}>Roles</button>}
                      {u.estado !== 'inactivo' && <button className="btn btn-fantasma" onClick={() => accion(u, '/deshabilitar', 'PATCH', 'Usuario deshabilitado')}>Deshabilitar</button>}
                      {u.estado === 'inactivo' && !u.anonimizado && <button className="btn btn-fantasma" onClick={() => accion(u, '/habilitar', 'PATCH', 'Usuario habilitado')}>Habilitar</button>}
                      {!u.anonimizado && <button className="btn btn-fantasma peligro" onClick={() => window.confirm(`¿Anonimizar a ${u.nombre}? No se puede deshacer.`) && accion(u, '/anonimizar', 'POST', 'Usuario anonimizado')}>Anonimizar</button>}
                    </td>
                  )}
                </tr>,
                abierto === u._id && (
                  <tr key={`${u._id}-ed`} className="fila-editor"><td colSpan={7}>
                    <EditorRoles u={u} meta={meta} onListo={(m) => { setOk(m); setAbierto(null); cargar(); }} onError={setError} />
                  </td></tr>
                ),
              ])}
            </tbody>
          </table>
        </div>
      )}
      <Paginador paginacion={r?.paginacion} onPagina={setPagina} />
    </div>
  );
}
