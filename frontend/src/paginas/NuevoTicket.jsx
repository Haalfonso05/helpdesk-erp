import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../contexto';
import { Aviso, Campo, useDebounce } from '../componentes/ui';
import { texto } from '../util';

// Dibuja un control según el tipo definido en el catálogo del backend
function CampoDinamico({ def, valor, onChange }) {
  const comun = { value: valor ?? '', onChange: (e) => onChange(e.target.value), required: def.requerido };
  let control;
  if (def.tipo === 'opcion') {
    control = (
      <select {...comun}>
        <option value="">Seleccione…</option>
        {def.opciones.map((o) => <option key={o} value={o}>{texto(o)}</option>)}
      </select>
    );
  } else if (def.tipo === 'texto_largo') {
    control = <textarea rows={4} {...comun} className="mono-area" />;
  } else if (def.tipo === 'entero') {
    control = <input type="number" step="1" min="0" {...comun} />;
  } else if (def.tipo === 'decimal') {
    control = <input type="number" step="any" {...comun} />;
  } else if (def.tipo === 'url') {
    control = <input type="url" placeholder="https://" {...comun} />;
  } else {
    control = <input {...comun} />;
  }
  return <Campo etiqueta={def.etiqueta} requerido={def.requerido}>{control}</Campo>;
}

export default function NuevoTicket() {
  const { meta, yo, tiene } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const esAdmin = tiene('administrador');
  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState('');
  const [f, setF] = useState({ modulo: '', tipo: 'problematica', asunto: '', descripcion: '', severidad: 'media', canal: 'web' });
  const [detalle, setDetalle] = useState({});
  const [sugerencias, setSugerencias] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const origen = params.get('origen');

  useEffect(() => {
    if (esAdmin) api('/clientes?limite=100&estado=activa').then((r) => setClientes(r.datos)).catch(() => {});
  }, [esAdmin]);

  const cliente = esAdmin ? clientes.find((c) => c._id === clienteId) : yo.cliente;
  const modulosDisponibles = cliente?.membresia.modulos_contratados || [];
  const def = meta.modulos[f.modulo];

  // Sugerencias de artículos mientras escribe (RQF-29)
  const textoBusqueda = useDebounce(`${f.asunto} ${f.descripcion}`.trim(), 450);
  useEffect(() => {
    if (textoBusqueda.length < 4) { setSugerencias([]); return; }
    api(`/articulos/sugerencias?texto=${encodeURIComponent(textoBusqueda)}${f.modulo ? `&modulo=${f.modulo}` : ''}`)
      .then(setSugerencias).catch(() => setSugerencias([]));
  }, [textoBusqueda, f.modulo]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cambiarModulo = (e) => { setF({ ...f, modulo: e.target.value }); setDetalle({}); };

  const bloqueo = useMemo(() => {
    if (!esAdmin && yo.usuario.estado !== 'activo') return 'Verifique su cuenta para poder crear tickets.';
    if (!cliente && !esAdmin) return 'Su usuario no está asociado a una empresa cliente.';
    if (cliente && !['activa', 'en_gracia'].includes(cliente.membresia.estado)) return `La membresía está ${cliente.membresia.estado}: no se pueden crear tickets nuevos.`;
    return null;
  }, [cliente, esAdmin, yo]);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const t = await api('/tickets', { method: 'POST', body: { ...f, detalle, cliente_id: esAdmin ? clienteId : undefined, ticket_origen_id: origen || undefined } });
      nav(`/tickets/${t._id}`, { state: { creado: true } });
    } catch (err) {
      setError(err);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="pagina pagina-angosta">
      <header className="cabecera">
        <h1>Reportar un problema o sugerencia</h1>
        <p className="tenue">Los campos cambian según el módulo del ERP: cada tipo de ticket guarda solo los datos que necesita.</p>
      </header>

      {bloqueo && <div className="aviso aviso-error">{bloqueo}</div>}
      {origen && <div className="aviso aviso-alerta">Este ticket quedará enlazado al ticket anterior que ya no se podía reabrir.</div>}

      <div className="formulario-con-lateral">
        <form onSubmit={enviar} className="pila tarjeta">
          <Aviso error={error} />
          {esAdmin && (
            <Campo etiqueta="Empresa cliente" requerido>
              <select required value={clienteId} onChange={(e) => { setClienteId(e.target.value); setF({ ...f, modulo: '' }); }}>
                <option value="">Seleccione…</option>
                {clientes.map((c) => <option key={c._id} value={c._id}>{c.razon_social}</option>)}
              </select>
            </Campo>
          )}
          <div className="fila-2">
            <Campo etiqueta="Módulo afectado" requerido>
              <select required value={f.modulo} onChange={cambiarModulo}>
                <option value="">Seleccione…</option>
                {modulosDisponibles.map((m) => <option key={m} value={m}>{meta.modulos[m].nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Tipo de reporte">
              <select value={f.tipo} onChange={set('tipo')}>
                <option value="problematica">Problema (incidente técnico)</option>
                <option value="acierto">Sugerencia de mejora</option>
              </select>
            </Campo>
          </div>
          <Campo etiqueta="Asunto" requerido><input required minLength={5} maxLength={150} value={f.asunto} onChange={set('asunto')} placeholder="Ej.: La factura electrónica es rechazada" /></Campo>
          <Campo etiqueta="Descripción" requerido><textarea required minLength={10} rows={5} value={f.descripcion} onChange={set('descripcion')} placeholder="¿Qué pasó, desde cuándo y qué estaba haciendo?" /></Campo>
          <div className="fila-2">
            <Campo etiqueta="Severidad" ayuda="La prioridad final también depende del plan de su empresa.">
              <select value={f.severidad} onChange={set('severidad')}>
                {meta.severidades.map((s) => <option key={s} value={s}>{texto(s)}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Canal">
              <select value={f.canal} onChange={set('canal')}>
                {meta.canales.map((c) => <option key={c} value={c}>{texto(c)}</option>)}
              </select>
            </Campo>
          </div>

          {def && (
            <fieldset className="detalle-modulo">
              <legend>Datos de {def.nombre}</legend>
              <div className="rejilla-campos">
                {def.campos.map((c) => (
                  <CampoDinamico key={c.clave} def={c} valor={detalle[c.clave]} onChange={(v) => setDetalle({ ...detalle, [c.clave]: v })} />
                ))}
              </div>
            </fieldset>
          )}

          <button className="btn" disabled={enviando || !!bloqueo}>{enviando ? 'Enviando…' : 'Crear ticket'}</button>
        </form>

        <aside className="sugerencias" aria-live="polite">
          <h2>¿Ya tiene solución?</h2>
          {sugerencias.length === 0 ? (
            <p className="tenue">Mientras describe el problema, aquí aparecen artículos de la base de conocimientos que podrían resolverlo.</p>
          ) : (
            <ul>
              {sugerencias.map((s) => (
                <li key={s._id}>
                  <Link to={`/conocimiento/${s._id}`} target="_blank">{s.titulo}</Link>
                  <p className="tenue">{s.resumen}…</p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
