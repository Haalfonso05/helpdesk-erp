import { useEffect, useState } from 'react';
import { texto } from '../util';

export function Estado({ valor }) {
  return <span className={`chip estado-${valor}`}>{texto(valor)}</span>;
}

export function Prioridad({ valor }) {
  return <span className={`prio prio-${valor}`}><i aria-hidden="true" />{texto(valor)}</span>;
}

const SLA_TXT = { a_tiempo: 'A tiempo', en_riesgo: 'En riesgo', incumplido: 'Incumplido', cumplido: 'Cumplido', pausado: 'Pausado' };
export function Sla({ valor }) {
  return <span className={`sla sla-${valor}`}>{SLA_TXT[valor] || valor}</span>;
}

export function Membresia({ valor }) {
  return <span className={`chip memb-${valor}`}>{texto(valor)}</span>;
}

export function Aviso({ error, ok, onCerrar }) {
  if (!error && !ok) return null;
  const detalles = error?.datos?.detalles;
  return (
    <div className={`aviso ${error ? 'aviso-error' : 'aviso-ok'}`} role={error ? 'alert' : 'status'}>
      <div>
        <strong>{error ? error.message : ok}</strong>
        {detalles?.length > 0 && (
          <ul>
            {detalles.map((d, i) => <li key={i}><code>{d.campo}</code> — {d.regla}: {d.motivo}</li>)}
          </ul>
        )}
      </div>
      {onCerrar && <button className="btn-icono" onClick={onCerrar} aria-label="Cerrar aviso">×</button>}
    </div>
  );
}

export function Paginador({ paginacion, onPagina }) {
  if (!paginacion || paginacion.totalPaginas <= 1) return paginacion ? <p className="paginador tenue">{paginacion.total} resultado(s)</p> : null;
  return (
    <div className="paginador">
      <span className="tenue">{paginacion.total} resultados · página {paginacion.pagina} de {paginacion.totalPaginas}</span>
      <div>
        <button className="btn btn-sec" disabled={paginacion.pagina <= 1} onClick={() => onPagina(paginacion.pagina - 1)}>Anterior</button>
        <button className="btn btn-sec" disabled={paginacion.pagina >= paginacion.totalPaginas} onClick={() => onPagina(paginacion.pagina + 1)}>Siguiente</button>
      </div>
    </div>
  );
}

export const Cargando = () => <p className="tenue cargando">Cargando…</p>;

export function Vacio({ children }) {
  return <div className="vacio">{children}</div>;
}

export function Campo({ etiqueta, ayuda, children, requerido }) {
  return (
    <label className="campo">
      <span className="campo-etq">{etiqueta}{requerido && <em aria-hidden="true"> *</em>}</span>
      {children}
      {ayuda && <small className="tenue">{ayuda}</small>}
    </label>
  );
}

// Retrasa un valor (para la búsqueda en vivo)
export function useDebounce(valor, ms = 300) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

// Tabla de barras simple para los reportes
export function Barras({ filas, etiqueta, valor, sufijo = '', max }) {
  const tope = max || Math.max(1, ...filas.map((f) => f[valor] || 0));
  return (
    <div className="barras">
      {filas.map((f, i) => (
        <div className="barra-fila" key={i}>
          <span className="barra-etq">{f[etiqueta]}</span>
          <span className="barra-pista"><span className="barra" style={{ width: `${((f[valor] || 0) / tope) * 100}%` }} /></span>
          <span className="barra-val">{f[valor]}{sufijo}</span>
        </div>
      ))}
    </div>
  );
}
