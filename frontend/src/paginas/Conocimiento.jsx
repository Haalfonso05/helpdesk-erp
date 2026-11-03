import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useApp } from '../contexto';
import { Aviso, Cargando, Campo, Paginador, Vacio, useDebounce } from '../componentes/ui';
import { fecha, texto } from '../util';

export default function Conocimiento() {
  const { meta, tiene } = useApp();
  const [q, setQ] = useState('');
  const [modulo, setModulo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const dq = useDebounce(q, 250);

  useEffect(() => {
    setError(null);
    api(`/articulos${qs({ q: dq, modulo, pagina, limite: 10 })}`).then(setR).catch((e) => { setError(e); setR({ datos: [] }); });
  }, [dq, modulo, pagina]);

  return (
    <div className="pagina">
      <header className="cabecera cabecera-accion">
        <h1>Base de conocimientos</h1>
        {tiene('soporte', 'administrador') && <Link className="btn" to="/conocimiento/nuevo">Escribir artículo</Link>}
      </header>

      <div className="buscador">
        <input type="search" autoFocus value={q} onChange={(e) => { setPagina(1); setQ(e.target.value); }} placeholder="Describa el problema con sus palabras, p. ej. «la factura sale rechazada»" aria-label="Buscar en la base de conocimientos" />
        <select value={modulo} onChange={(e) => { setPagina(1); setModulo(e.target.value); }} aria-label="Filtrar por módulo">
          <option value="">Todos los módulos</option>
          {Object.entries(meta.modulos).map(([k, m]) => <option key={k} value={k}>{m.nombre}</option>)}
        </select>
      </div>
      {dq && <p className="tenue">Resultados ordenados por relevancia (índice de texto en español sobre título, etiquetas y contenido).</p>}

      <Aviso error={error} />
      {!r ? <Cargando /> : r.datos.length === 0 ? (
        !error && <Vacio><p>Sin resultados para «{dq}». Pruebe con otras palabras{tiene('cliente') ? ' o reporte el problema.' : '.'}</p>{tiene('cliente') && <Link className="btn" to="/tickets/nuevo">Reportar un problema</Link>}</Vacio>
      ) : (
        <ol className="resultados">
          {r.datos.map((a) => (
            <li key={a._id}>
              <Link to={`/conocimiento/${a._id}`} className="resultado-titulo">{a.titulo}</Link>
              <p className="tenue resultado-meta">
                {meta.modulos[a.modulo]?.nombre}
                {a.estado !== 'publicado' && <span className={`chip art-${a.estado}`}>{texto(a.estado)}</span>}
                {a.puntaje !== undefined && <span>relevancia {a.puntaje.toFixed(2)}</span>}
                <span>{a.votos_utiles} lo encontraron útil</span>
              </p>
              <p>{a.resumen}…</p>
              {a.etiquetas?.length > 0 && <p className="etiquetas">{a.etiquetas.map((e) => <span key={e}>{e}</span>)}</p>}
            </li>
          ))}
        </ol>
      )}
      <Paginador paginacion={r?.paginacion} onPagina={setPagina} />
    </div>
  );
}

export function ArticuloDetalle() {
  const { id } = useParams();
  const { meta, tiene, yo } = useApp();
  const [a, setA] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [votado, setVotado] = useState(false);

  const cargar = () => api(`/articulos/${id}`).then(setA).catch(setError);
  useEffect(() => { cargar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const accion = async (ruta, msg) => {
    setError(null);
    try { await api(`/articulos/${id}/${ruta}`, { method: 'POST' }); setOk(msg); cargar(); } catch (e) { setError(e); }
  };
  const votar = async (util) => {
    try { await api(`/articulos/${id}/votar`, { method: 'POST', body: { util } }); setVotado(true); cargar(); } catch (e) { setError(e); }
  };

  if (!a) return <div className="pagina">{error ? <Aviso error={error} /> : <Cargando />}</div>;
  const puedeEditar = tiene('administrador') || (tiene('soporte') && String(a.autor_id) === String(yo.usuario._id));

  return (
    <div className="pagina pagina-angosta">
      <p className="miga"><Link to="/conocimiento">Base de conocimientos</Link></p>
      <article className="articulo">
        <h1>{a.titulo}</h1>
        <p className="tenue">
          {meta.modulos[a.modulo]?.nombre} · versión {a.version} · escrito por {a.autor}{a.revisor ? `, revisado por ${a.revisor}` : ''} · actualizado {fecha(a.fecha_actualizacion)}
          {a.estado !== 'publicado' && <> · <span className={`chip art-${a.estado}`}>{texto(a.estado)}</span></>}
        </p>
        <Aviso error={error} ok={ok} />
        <div className="articulo-cuerpo">{a.contenido.split('\n').map((p, i) => <p key={i}>{p}</p>)}</div>
        {a.etiquetas?.length > 0 && <p className="etiquetas">{a.etiquetas.map((e) => <span key={e}>{e}</span>)}</p>}
        <p className="tenue">Ha resuelto {a.resoluciones} ticket(s) · {a.votos_utiles} votos útiles · {a.votos_no_utiles} no útiles</p>
      </article>

      {tiene('cliente') && !tiene('soporte', 'administrador') && a.estado === 'publicado' && (
        <div className="bloque">
          {votado ? <p>Gracias por su opinión.</p> : (
            <div className="fila-acciones"><span>¿Le sirvió este artículo?</span><button className="btn btn-sec" onClick={() => votar(true)}>Sí</button><button className="btn btn-sec" onClick={() => votar(false)}>No</button></div>
          )}
        </div>
      )}
      <div className="botonera">
        {puedeEditar && <Link className="btn btn-sec" to={`/conocimiento/${id}/editar`}>Editar</Link>}
        {tiene('administrador') && a.estado !== 'publicado' && <button className="btn" onClick={() => accion('publicar', 'Artículo publicado')}>Aprobar y publicar</button>}
        {tiene('administrador') && a.estado === 'publicado' && <button className="btn btn-sec" onClick={() => accion('despublicar', 'Artículo despublicado')}>Despublicar</button>}
      </div>
    </div>
  );
}

export function EditarArticulo() {
  const { id } = useParams();
  const { meta } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ titulo: '', modulo: '', contenido: '', etiquetas: '' });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (id) api(`/articulos/${id}`).then((a) => setF({ titulo: a.titulo, modulo: a.modulo, contenido: a.contenido, etiquetas: a.etiquetas.join(', ') })).catch(setError);
  }, [id]);

  const enviar = async (e) => {
    e.preventDefault();
    try {
      const r = await api(id ? `/articulos/${id}` : '/articulos', { method: id ? 'PUT' : 'POST', body: f });
      nav(`/conocimiento/${r._id}`);
    } catch (err) { setError(err); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="pagina pagina-angosta">
      <header className="cabecera">
        <h1>{id ? 'Editar artículo' : 'Nuevo artículo'}</h1>
        <p className="tenue">Los artículos de soporte se guardan como borrador hasta que un administrador los aprueba.</p>
      </header>
      <form onSubmit={enviar} className="pila tarjeta">
        <Aviso error={error} />
        <Campo etiqueta="Título" requerido><input required minLength={5} value={f.titulo} onChange={set('titulo')} /></Campo>
        <Campo etiqueta="Módulo" requerido>
          <select required value={f.modulo} onChange={set('modulo')}>
            <option value="">Seleccione…</option>
            {Object.entries(meta.modulos).map(([k, m]) => <option key={k} value={k}>{m.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Contenido" requerido><textarea required minLength={20} rows={10} value={f.contenido} onChange={set('contenido')} /></Campo>
        <Campo etiqueta="Etiquetas" ayuda="Separadas por comas. Ayudan a encontrar el artículo."><input value={f.etiquetas} onChange={set('etiquetas')} /></Campo>
        <button className="btn">{id ? 'Guardar cambios' : 'Guardar borrador'}</button>
      </form>
    </div>
  );
}
