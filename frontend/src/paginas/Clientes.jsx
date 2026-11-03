import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useApp } from '../contexto';
import { Aviso, Cargando, Campo, Membresia, Paginador } from '../componentes/ui';
import { fecha, fechaHora, pesos, texto } from '../util';

export default function Clientes() {
  const { meta, tiene, roles, yo } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', estado: '', plan: '' });
  const [pagina, setPagina] = useState(1);
  const [r, setR] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ razon_social: '', nit: '', correo: '', telefono: '', plan: 'estandar', modulos_contratados: [] });
  const [error, setError] = useState(null);
  const soloCliente = roles.length === 1 && roles[0] === 'cliente';

  useEffect(() => {
    if (soloCliente && yo.usuario.cliente_id) { nav(`/clientes/${yo.usuario.cliente_id}`, { replace: true }); return; }
    api(`/clientes${qs({ ...f, pagina, limite: 20 })}`).then(setR).catch(setError);
  }, [f, pagina, soloCliente]); // eslint-disable-line react-hooks/exhaustive-deps

  const crear = async (e) => {
    e.preventDefault();
    try {
      const c = await api('/clientes', { method: 'POST', body: form });
      nav(`/clientes/${c._id}`);
    } catch (err) { setError(err); }
  };
  const toggleModulo = (m) => setForm({ ...form, modulos_contratados: form.modulos_contratados.includes(m) ? form.modulos_contratados.filter((x) => x !== m) : [...form.modulos_contratados, m] });

  if (soloCliente && !yo.usuario.cliente_id) return <div className="pagina"><p>Su usuario no está asociado a ninguna empresa.</p></div>;

  return (
    <div className="pagina">
      <header className="cabecera cabecera-accion">
        <h1>Clientes y membresías</h1>
        {tiene('administrador') && <button className="btn" onClick={() => setNuevo(!nuevo)}>{nuevo ? 'Cancelar' : 'Registrar empresa'}</button>}
      </header>
      <Aviso error={error} />
      {nuevo && (
        <form className="tarjeta pila" onSubmit={crear}>
          <div className="fila-2">
            <Campo etiqueta="Razón social" requerido><input required value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} /></Campo>
            <Campo etiqueta="NIT" requerido><input required value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} placeholder="900123456-1" /></Campo>
            <Campo etiqueta="Correo" requerido><input type="email" required value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} /></Campo>
            <Campo etiqueta="Teléfono" requerido><input required value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></Campo>
          </div>
          <Campo etiqueta="Plan">
            <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>{meta.planes.map((p) => <option key={p} value={p}>{texto(p)}</option>)}</select>
          </Campo>
          <fieldset className="casillas"><legend>Módulos contratados</legend>
            {Object.entries(meta.modulos).map(([k, m]) => <label key={k}><input type="checkbox" checked={form.modulos_contratados.includes(k)} onChange={() => toggleModulo(k)} /> {m.nombre}</label>)}
          </fieldset>
          <button className="btn">Registrar empresa</button>
        </form>
      )}
      <div className="filtros">
        <input placeholder="Buscar por razón social o NIT" value={f.q} onChange={(e) => { setPagina(1); setF({ ...f, q: e.target.value }); }} aria-label="Buscar" />
        <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })} aria-label="Estado de membresía">
          <option value="">Toda membresía</option>
          {meta.estadosMembresia.map((e) => <option key={e} value={e}>{texto(e)}</option>)}
        </select>
        <select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} aria-label="Plan">
          <option value="">Todo plan</option>
          {meta.planes.map((p) => <option key={p} value={p}>{texto(p)}</option>)}
        </select>
      </div>
      {!r ? <Cargando /> : (
        <div className="tabla-envoltura">
          <table className="tabla tabla-clic">
            <thead><tr><th>Empresa</th><th>NIT</th><th>Plan</th><th>Membresía</th><th>Módulos</th><th>Renovación</th></tr></thead>
            <tbody>
              {r.datos.map((c) => (
                <tr key={c._id} onClick={() => nav(`/clientes/${c._id}`)}>
                  <td><Link to={`/clientes/${c._id}`}>{c.razon_social}</Link></td>
                  <td><code className="codigo">{c.nit}</code></td>
                  <td>{texto(c.membresia.plan)}</td>
                  <td><Membresia valor={c.membresia.estado} /></td>
                  <td>{c.membresia.modulos_contratados.length}</td>
                  <td className="tenue">{fecha(c.membresia.fecha_renovacion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginador paginacion={r?.paginacion} onPagina={setPagina} />
    </div>
  );
}

export function ClienteDetalle() {
  const { id } = useParams();
  const { meta, tiene } = useApp();
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [pago, setPago] = useState({ valor: '', metodo: 'pse', estado: 'aprobado', simular_fallo: false });
  const [cambio, setCambio] = useState({ estado: 'suspendida', motivo: '' });
  const esAdmin = tiene('administrador');

  const cargar = () => api(`/clientes/${id}`).then(setC).catch(setError);
  useEffect(() => { cargar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const registrarPago = async (e) => {
    e.preventDefault();
    setError(null); setOk(null);
    try {
      const r = await api(`/clientes/${id}/pagos`, { method: 'POST', body: { ...pago, valor: Number(pago.valor) } });
      setOk(`Pago ${r.pago.estado} registrado. Membresía: ${r.membresia.estado}. (Pago, membresía y bitácora se guardaron en una sola transacción.)`);
    } catch (err) { setError(err); }
    cargar();
  };
  const cambiarEstado = async (e) => {
    e.preventDefault();
    setError(null); setOk(null);
    try {
      const r = await api(`/clientes/${id}/membresia`, { method: 'PATCH', body: cambio });
      setOk(`Membresía: ${r.antes} → ${r.despues}`);
      setCambio({ ...cambio, motivo: '' });
    } catch (err) { setError(err); }
    cargar();
  };
  const contacto = async (uid) => {
    try { await api(`/clientes/${id}`, { method: 'PUT', body: { contacto_principal_id: uid } }); setOk('Contacto principal actualizado'); cargar(); } catch (err) { setError(err); }
  };

  if (!c) return <div className="pagina">{error ? <Aviso error={error} /> : <Cargando />}</div>;
  const m = c.membresia;

  return (
    <div className="pagina">
      {!(tiene('cliente') && !tiene('soporte', 'administrador', 'auditor')) && <p className="miga"><Link to="/clientes">Clientes</Link></p>}
      <header className="cabecera">
        <h1>{c.razon_social}</h1>
        <p className="tenue">NIT <code className="codigo">{c.nit}</code> · {c.correo} · {c.telefono}</p>
      </header>
      <Aviso error={error} ok={ok} onCerrar={() => { setError(null); setOk(null); }} />

      <div className="dos-col">
        <section className="bloque">
          <h2>Membresía</h2>
          <dl className="datos">
            <div><dt>Estado</dt><dd><Membresia valor={m.estado} /></dd></div>
            <div><dt>Plan</dt><dd>{texto(m.plan)}</dd></div>
            <div><dt>Inicio</dt><dd>{fecha(m.fecha_inicio)}</dd></div>
            <div><dt>Renovación</dt><dd>{fecha(m.fecha_renovacion)}</dd></div>
            <div className="dato-ancho"><dt>Módulos contratados</dt><dd>{m.modulos_contratados.map((x) => meta.modulos[x]?.nombre).join(', ')}</dd></div>
          </dl>
        </section>

        {esAdmin && (
          <section className="bloque">
            <h2>Registrar pago</h2>
            <p className="tenue">Un pago fallido suspende la membresía; uno aprobado la reactiva. Todo ocurre en una transacción multidocumento.</p>
            <form className="pila-chica" onSubmit={registrarPago}>
              <div className="fila-2">
                <Campo etiqueta="Valor (COP)"><input type="number" min="1" required value={pago.valor} onChange={(e) => setPago({ ...pago, valor: e.target.value })} /></Campo>
                <Campo etiqueta="Método"><select value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}>{meta.metodosPago.map((x) => <option key={x} value={x}>{texto(x)}</option>)}</select></Campo>
              </div>
              <Campo etiqueta="Resultado del pago">
                <select value={pago.estado} onChange={(e) => setPago({ ...pago, estado: e.target.value })}>{meta.estadosPago.map((x) => <option key={x} value={x}>{texto(x)}</option>)}</select>
              </Campo>
              <label className="interruptor"><input type="checkbox" checked={pago.simular_fallo} onChange={(e) => setPago({ ...pago, simular_fallo: e.target.checked })} /> Simular un error a mitad de la transacción (para demostrar el rollback)</label>
              <button className="btn">Registrar pago</button>
            </form>
            <details>
              <summary>Cambiar estado manualmente</summary>
              <form className="pila-chica" onSubmit={cambiarEstado}>
                <select value={cambio.estado} onChange={(e) => setCambio({ ...cambio, estado: e.target.value })} aria-label="Nuevo estado">{meta.estadosMembresia.map((x) => <option key={x} value={x}>{texto(x)}</option>)}</select>
                <input required placeholder="Motivo" value={cambio.motivo} onChange={(e) => setCambio({ ...cambio, motivo: e.target.value })} aria-label="Motivo" />
                <button className="btn btn-sec">Aplicar</button>
              </form>
            </details>
          </section>
        )}
      </div>

      <section className="bloque">
        <h2>Usuarios de la empresa</h2>
        <table className="tabla">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Estado</th><th>Contacto principal</th></tr></thead>
          <tbody>
            {c.usuarios.map((u) => (
              <tr key={u._id}>
                <td>{u.nombre}</td><td>{u.correo}</td><td>{texto(u.estado)}</td>
                <td>{String(c.contacto_principal_id) === String(u._id) ? 'Sí' : esAdmin ? <button className="btn btn-fantasma" onClick={() => contacto(u._id)}>Designar</button> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="dos-col">
        <section className="bloque">
          <h2>Pagos</h2>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Valor</th><th>Método</th><th>Resultado</th></tr></thead>
            <tbody>{c.pagos.map((p) => <tr key={p._id}><td>{fecha(p.fecha)}</td><td>{pesos(p.valor)}</td><td>{texto(p.metodo)}</td><td><span className={`chip pago-${p.estado}`}>{texto(p.estado)}</span></td></tr>)}</tbody>
          </table>
        </section>
        <section className="bloque">
          <h2>Historial de la membresía</h2>
          {c.historial_membresia.length === 0 ? <p className="tenue">Sin cambios registrados.</p> : (
            <ol className="linea-tiempo">
              {c.historial_membresia.map((h) => (
                <li key={h._id}>
                  <span className="lt-fecha tenue">{fechaHora(h.fecha)}</span>
                  <span>{texto(h.accion)}{h.antes?.estado && h.despues?.estado && h.antes.estado !== h.despues.estado ? `: ${h.antes.estado} → ${h.despues.estado}` : ''}</span>
                  <span className="tenue">{h.correo}{h.detalle ? ` · ${h.detalle}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
