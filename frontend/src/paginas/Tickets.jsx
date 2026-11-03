import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import { useApp } from '../contexto';
import { Aviso, Cargando, Estado, Paginador, Prioridad, Sla, Vacio, useDebounce } from '../componentes/ui';
import { fecha, texto } from '../util';

export default function Tickets() {
  const { meta, tiene } = useApp();
  const nav = useNavigate();
  const esSoporte = tiene('soporte') && !tiene('administrador');
  const [vista, setVista] = useState(esSoporte ? 'mios' : 'todos');
  const [f, setF] = useState({ estado: '', modulo: '', prioridad: '', q: '', orden: '-fecha_creacion' });
  const [pagina, setPagina] = useState(1);
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const q = useDebounce(f.q);

  useEffect(() => {
    const extra = vista === 'mios' ? { responsable_id: 'yo' } : vista === 'cola' ? { sin_asignar: 'true' } : {};
    setError(null);
    api(`/tickets${qs({ ...f, q, ...extra, pagina, limite: 15 })}`).then(setR).catch(setError);
  }, [f.estado, f.modulo, f.prioridad, f.orden, q, vista, pagina]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => { setPagina(1); setF({ ...f, [k]: e.target.value }); };

  return (
    <div className="pagina">
      <header className="cabecera cabecera-accion">
        <h1>Tickets</h1>
        {tiene('cliente', 'administrador') && <Link className="btn" to="/tickets/nuevo">Reportar un problema</Link>}
      </header>

      {tiene('soporte') && (
        <div className="pestanas" role="tablist">
          {[['mios', 'Asignados a mí'], ['cola', 'Cola sin asignar'], ['todos', 'Todos los visibles']].map(([v, t]) => (
            <button key={v} role="tab" aria-selected={vista === v} className={vista === v ? 'activa' : ''} onClick={() => { setPagina(1); setVista(v); }}>{t}</button>
          ))}
        </div>
      )}

      <div className="filtros">
        <input placeholder="Buscar por código o asunto" value={f.q} onChange={set('q')} aria-label="Buscar" />
        <select value={f.estado} onChange={set('estado')} aria-label="Estado">
          <option value="">Todos los estados</option>
          {meta.estadosTicket.map((e) => <option key={e} value={e}>{texto(e)}</option>)}
        </select>
        <select value={f.modulo} onChange={set('modulo')} aria-label="Módulo">
          <option value="">Todos los módulos</option>
          {Object.entries(meta.modulos).map(([k, m]) => <option key={k} value={k}>{m.nombre}</option>)}
        </select>
        <select value={f.prioridad} onChange={set('prioridad')} aria-label="Prioridad">
          <option value="">Toda prioridad</option>
          {meta.prioridades.map((p) => <option key={p} value={p}>{texto(p)}</option>)}
        </select>
        <select value={f.orden} onChange={set('orden')} aria-label="Orden">
          <option value="-fecha_creacion">Más recientes</option>
          <option value="fecha_creacion">Más antiguos</option>
          <option value="sla.vence_resolucion">Vencen primero</option>
          <option value="-fecha_actualizacion">Actualizados recientemente</option>
        </select>
      </div>

      <Aviso error={error} />
      {!r ? <Cargando /> : r.datos.length === 0 ? (
        <Vacio>
          <p>No hay tickets con estos filtros.</p>
          {tiene('cliente') && <Link className="btn" to="/tickets/nuevo">Reportar un problema</Link>}
        </Vacio>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla tabla-clic">
            <thead>
              <tr><th>Código</th><th>Asunto</th><th>Módulo</th><th>Estado</th><th>Prioridad</th><th>SLA</th>{!tiene('cliente') || tiene('soporte', 'administrador') ? <th>Empresa</th> : null}<th>Responsable</th><th>Creado</th></tr>
            </thead>
            <tbody>
              {r.datos.map((t) => (
                <tr key={t._id} onClick={() => nav(`/tickets/${t._id}`)}>
                  <td><Link to={`/tickets/${t._id}`} className="codigo">{t.codigo}</Link></td>
                  <td className="celda-asunto">{t.asunto}{t.tipo === 'acierto' && <span className="chip chip-acierto">Sugerencia</span>}</td>
                  <td>{meta.modulos[t.modulo]?.nombre}</td>
                  <td><Estado valor={t.estado} /></td>
                  <td><Prioridad valor={t.prioridad} /></td>
                  <td><Sla valor={t.estado_sla} /></td>
                  {!tiene('cliente') || tiene('soporte', 'administrador') ? <td>{t.cliente}</td> : null}
                  <td>{t.responsable || <span className="tenue">Sin asignar</span>}</td>
                  <td className="tenue">{fecha(t.fecha_creacion)}</td>
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
