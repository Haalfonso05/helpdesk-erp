import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../contexto';
import { Aviso, Cargando, Campo, Estado, Prioridad, Sla, useDebounce } from '../componentes/ui';
import { fecha, fechaHora, restante, texto } from '../util';

const ACCION_ESTADO = {
  en_proceso: 'Empezar a trabajar',
  en_espera_cliente: 'Esperar respuesta del cliente',
  resuelto: 'Marcar como resuelto',
  cerrado: 'Cerrar',
  reabierto: 'Reabrir',
};

function BarraSla({ t }) {
  const ini = new Date(t.fecha_creacion).getTime();
  const fin = new Date(t.sla.vence_resolucion).getTime();
  const hasta = t.fecha_resolucion ? new Date(t.fecha_resolucion).getTime() : t.sla.pausado_desde ? new Date(t.sla.pausado_desde).getTime() : Date.now();
  const pct = Math.min(100, Math.max(2, ((hasta - ini) / (fin - ini)) * 100));
  return (
    <div className={`barra-sla sla-${t.estado_sla}`}>
      <div className="barra-sla-pista"><span style={{ width: `${pct}%` }} /></div>
      <div className="barra-sla-txt">
        <Sla valor={t.estado_sla} />
        <span className="tenue">
          {t.fecha_resolucion ? `resuelto el ${fechaHora(t.fecha_resolucion)}` : t.sla.pausado_desde ? 'reloj detenido mientras se espera al cliente' : restante(t.sla.vence_resolucion)}
          {t.sla.minutos_pausa > 0 && ` · ${t.sla.minutos_pausa} min en pausa`}
        </span>
      </div>
    </div>
  );
}

function VincularArticulo({ t, onHecho }) {
  const [q, setQ] = useState(t.asunto);
  const [res, setRes] = useState([]);
  const dq = useDebounce(q);
  useEffect(() => {
    if (dq.length < 3) return;
    api(`/articulos?q=${encodeURIComponent(dq)}&modulo=${t.modulo}&estado=publicado&limite=5`).then((r) => setRes(r.datos)).catch(() => {});
  }, [dq, t.modulo]);
  return (
    <div className="pila-chica">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar artículo" aria-label="Buscar artículo para vincular" />
      {res.map((a) => (
        <button key={a._id} className="btn btn-sec btn-izq" onClick={() => onHecho(a._id)}>{a.titulo}</button>
      ))}
    </div>
  );
}

export default function TicketDetalle() {
  const { id } = useParams();
  const loc = useLocation();
  const { meta, tiene, yo } = useApp();
  const [t, setT] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(loc.state?.creado ? 'Ticket creado. Le avisaremos por correo cada vez que cambie.' : null);
  const [comentario, setComentario] = useState('');
  const [visibilidad, setVisibilidad] = useState('publico');
  const [nota, setNota] = useState('');
  const [motivo, setMotivo] = useState('');
  const [agentes, setAgentes] = useState([]);
  const [previos, setPrevios] = useState(null);
  const [puntaje, setPuntaje] = useState(5);

  const staff = tiene('soporte', 'administrador');
  const esAdmin = tiene('administrador');
  const soloLectura = !tiene('cliente', 'soporte', 'administrador');

  const cargar = useCallback(() => api(`/tickets/${id}`).then(setT).catch(setError), [id]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (esAdmin) api('/usuarios?rol=soporte&estado=activo&limite=50').then((r) => setAgentes(r.datos)).catch(() => {});
  }, [esAdmin]);

  const hacer = async (fn, mensaje) => {
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(mensaje);
      setNota('');
      await cargar();
    } catch (err) {
      setError(err);
    }
  };
  const post = (ruta, body, metodo = 'POST') => api(`/tickets/${id}${ruta}`, { method: metodo, body });

  if (!t) return <div className="pagina">{error ? <Aviso error={error} /> : <Cargando />}</div>;

  const def = meta.modulos[t.modulo];
  const esResponsable = String(t.responsable_id) === String(yo.usuario._id);
  const puedeMover = esAdmin || (tiene('soporte') && (esResponsable || !t.responsable_id));
  const transicionesStaff = (t.transiciones_posibles || []).filter((e) => !['asignado', 'escalado'].includes(e));
  const esCreador = String(t.usuario_id) === String(yo.usuario._id);
  const accionesCliente = tiene('cliente') && !staff && (['resuelto', 'cerrado'].includes(t.estado) || t.calificacion);
  const hayAcciones = staff || accionesCliente;

  return (
    <div className="pagina">
      <p className="miga"><Link to="/tickets">Tickets</Link></p>

      <article className="tiquete tiquete-ticket">
        <div className="tiquete-cuerpo">
          <div className="tiquete-fila">
            <code className="codigo codigo-grande">{t.codigo}</code>
            <Estado valor={t.estado} />
            <Prioridad valor={t.prioridad} />
            {t.tipo === 'acierto' && <span className="chip chip-acierto">Sugerencia</span>}
          </div>
          <h1>{t.asunto}</h1>
          <p className="tiquete-meta">
            {def?.nombre} · {t.cliente?.razon_social} (plan {t.membresia?.plan}) · reportado por {t.creador?.nombre} el {fechaHora(t.fecha_creacion)} vía {t.canal}
          </p>
        </div>
        <div className="tiquete-talon">
          <span className="tenue">Responsable</span>
          <strong>{t.responsable?.nombre || 'Sin asignar'}</strong>
          <span className="tenue">Severidad reportada</span>
          <strong>{texto(t.severidad)}</strong>
        </div>
      </article>

      <BarraSla t={t} />
      <Aviso error={error} ok={ok} onCerrar={() => { setError(null); setOk(null); }} />
      {error?.datos?.crear_enlazado && <Link className="btn" to={`/tickets/nuevo?origen=${t._id}`}>Crear ticket enlazado</Link>}

      <div className="detalle-rejilla">
        <div className="pila">
          <section className="bloque">
            <h2>Descripción</h2>
            <p className="parrafo">{t.descripcion}</p>
            <h3>Datos de {def?.nombre}</h3>
            <dl className="datos">
              {def?.campos.map((c) => t.detalle[c.clave] !== undefined && (
                <div key={c.clave} className={c.tipo === 'texto_largo' ? 'dato-ancho' : ''}>
                  <dt>{c.etiqueta}</dt>
                  <dd>{c.tipo === 'texto_largo' ? <pre>{t.detalle[c.clave]}</pre> : c.tipo === 'url' ? <a href={t.detalle[c.clave]} target="_blank" rel="noreferrer">{t.detalle[c.clave]}</a> : texto(String(t.detalle[c.clave]))}</dd>
                </div>
              ))}
            </dl>
            {t.escalamiento && <p className="aviso aviso-alerta">Escalado el {fechaHora(t.escalamiento.fecha)}: {t.escalamiento.motivo}</p>}
            {t.articulo && <p>Solucionado con el artículo <Link to={`/conocimiento/${t.articulo._id}`}>{t.articulo.titulo}</Link></p>}
            {t.ticket_origen_id && <p><Link to={`/tickets/${t.ticket_origen_id}`}>Ver ticket anterior enlazado</Link></p>}
          </section>

          <section className="bloque">
            <h2>Conversación</h2>
            {t.comentarios.length === 0 && <p className="tenue">Aún no hay mensajes.</p>}
            <ol className="hilo">
              {t.comentarios.map((c) => (
                <li key={c._id} className={c.visibilidad === 'interno' ? 'interno' : ''}>
                  <div className="hilo-cab"><strong>{c.autor}</strong><span className="tenue">{fechaHora(c.fecha)}</span>{c.visibilidad === 'interno' && <span className="chip">Nota interna</span>}</div>
                  <p>{c.texto}</p>
                </li>
              ))}
            </ol>
            {!soloLectura && t.estado !== 'cerrado' && (
              <form className="pila-chica" onSubmit={(e) => { e.preventDefault(); hacer(() => post('/comentarios', { texto: comentario, visibilidad }), 'Mensaje enviado').then(() => setComentario('')); }}>
                <textarea rows={3} required value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Escriba un mensaje" aria-label="Mensaje" />
                <div className="fila-acciones">
                  {staff && (
                    <select value={visibilidad} onChange={(e) => setVisibilidad(e.target.value)} aria-label="Visibilidad">
                      <option value="publico">Visible para el cliente</option>
                      <option value="interno">Nota interna (solo equipo)</option>
                    </select>
                  )}
                  <button className="btn">Enviar mensaje</button>
                </div>
              </form>
            )}
          </section>
        </div>

        <div className="pila">
          {!soloLectura && hayAcciones && (
            <section className="bloque acciones">
              <h2>Acciones</h2>

              {tiene('soporte') && !t.responsable_id && (
                <button className="btn" onClick={() => hacer(() => post('/tomar'), 'Ticket tomado')}>Tomar este ticket</button>
              )}

              {esAdmin && (
                <Campo etiqueta={t.responsable_id ? 'Reasignar a' : 'Asignar a'}>
                  <select value="" onChange={(e) => e.target.value && hacer(() => post('/asignar', { responsable_id: e.target.value }, 'PUT'), 'Responsable actualizado')}>
                    <option value="">Seleccione un agente…</option>
                    {agentes.filter((a) => a._id !== t.responsable_id).map((a) => <option key={a._id} value={a._id}>{a.nombre}{a.especialidades?.includes(t.modulo) ? ' (especialista)' : ''}</option>)}
                  </select>
                </Campo>
              )}

              {staff && puedeMover && t.responsable_id && transicionesStaff.length > 0 && (
                <div className="pila-chica">
                  <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota para el historial (opcional)" aria-label="Nota" />
                  <div className="botonera">
                    {transicionesStaff.map((e) => (
                      <button key={e} className={`btn ${e === 'resuelto' ? '' : 'btn-sec'}`} onClick={() => hacer(() => post('/estado', { estado: e, nota: nota || undefined }), `Ticket ${texto(e).toLowerCase()}`)}>{ACCION_ESTADO[e] || texto(e)}</button>
                    ))}
                  </div>
                </div>
              )}

              {staff && puedeMover && (t.transiciones_posibles || []).includes('escalado') && (
                <details>
                  <summary>Escalar al administrador</summary>
                  <form className="pila-chica" onSubmit={(e) => { e.preventDefault(); hacer(() => post('/escalar', { motivo }), 'Ticket escalado'); }}>
                    <textarea required minLength={5} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del escalamiento" aria-label="Motivo" />
                    <button className="btn btn-peligro">Escalar</button>
                  </form>
                </details>
              )}

              {staff && ['resuelto', 'en_proceso', 'cerrado'].includes(t.estado) && (
                <details>
                  <summary>{t.articulo ? 'Cambiar artículo de solución' : 'Vincular artículo de solución'}</summary>
                  <VincularArticulo t={t} onHecho={(aid) => hacer(() => post('/articulo', { articulo_id: aid }, 'PUT'), 'Artículo vinculado')} />
                </details>
              )}

              {tiene('cliente') && !staff && t.estado === 'resuelto' && (
                <div className="pila-chica">
                  <p>El equipo marcó el ticket como resuelto. ¿Se solucionó?</p>
                  <div className="botonera">
                    <button className="btn" onClick={() => hacer(() => post('/estado', { estado: 'cerrado' }), 'Gracias por confirmar')}>Sí, cerrar ticket</button>
                    <button className="btn btn-sec" onClick={() => hacer(() => post('/estado', { estado: 'reabierto', nota: 'El cliente indicó que no se solucionó' }), 'Ticket reabierto')}>No, sigue fallando</button>
                  </div>
                </div>
              )}
              {tiene('cliente') && !staff && t.estado === 'cerrado' && (
                <button className="btn btn-sec" onClick={() => hacer(() => post('/estado', { estado: 'reabierto', nota: 'El problema volvió a presentarse' }), 'Ticket reabierto')}>Reabrir ticket</button>
              )}
              {tiene('cliente') && esCreador && ['resuelto', 'cerrado'].includes(t.estado) && !t.calificacion && (
                <form className="calificar" onSubmit={(e) => { e.preventDefault(); hacer(() => post('/calificar', { puntaje }), '¡Gracias por calificar!'); }}>
                  <span>Califique la atención</span>
                  <div className="estrellas" role="radiogroup" aria-label="Puntaje">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button type="button" key={n} role="radio" aria-checked={puntaje === n} aria-label={`${n} de 5`} className={n <= puntaje ? 'on' : ''} onClick={() => setPuntaje(n)}>★</button>
                    ))}
                  </div>
                  <button className="btn btn-sec">Enviar calificación</button>
                </form>
              )}
              {t.calificacion && <p>Calificación del cliente: {'★'.repeat(t.calificacion.puntaje)}{'☆'.repeat(5 - t.calificacion.puntaje)}</p>}
            </section>
          )}

          <section className="bloque">
            <h2>Historial de estados</h2>
            <ol className="linea-tiempo">
              {t.historial_estados.map((h, i) => (
                <li key={i}>
                  <span className="lt-fecha tenue">{fechaHora(h.fecha)}</span>
                  <span>{h.de && h.de !== h.a ? <>{texto(h.de)} → </> : null}<strong>{texto(h.a)}</strong></span>
                  {h.nota && <span className="tenue">{h.nota}</span>}
                </li>
              ))}
            </ol>
          </section>

          {staff && (
            <section className="bloque">
              <h2>Otros tickets de la empresa</h2>
              {previos === null ? (
                <button className="btn btn-sec" onClick={() => api(`/tickets/${id}/historial-cliente`).then(setPrevios).catch(setError)}>Ver historial del cliente</button>
              ) : previos.length === 0 ? <p className="tenue">Es el primer ticket de esta empresa.</p> : (
                <ul className="lista-simple">
                  {previos.map((p) => <li key={p._id}><Link to={`/tickets/${p._id}`} className="codigo">{p.codigo}</Link> {p.asunto} <Estado valor={p.estado} /> <span className="tenue">{fecha(p.fecha_creacion)}</span></li>)}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
