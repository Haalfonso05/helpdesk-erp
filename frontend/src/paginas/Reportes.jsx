import { useEffect, useState } from 'react';
import { api, descargar, qs } from '../api';
import { useApp } from '../contexto';
import { Aviso, Barras, Cargando } from '../componentes/ui';
import { texto } from '../util';

const REPORTES = [
  { clave: 'modulosIncidencias', titulo: '¿Qué módulo del ERP falla más?', etiqueta: 'nombre', valor: 'total', columnas: ['nombre', 'total', 'abiertos', 'criticos'] },
  { clave: 'tiempoPorAgente', titulo: 'Tiempo medio de resolución por agente', etiqueta: 'agente', valor: 'horas_promedio', sufijo: ' h', columnas: ['agente', 'tickets', 'horas_promedio'] },
  { clave: 'tiempoPorPlan', titulo: 'Tiempo medio de resolución por plan', etiqueta: 'plan', valor: 'horas_promedio', sufijo: ' h', columnas: ['plan', 'tickets', 'horas_promedio'], global: true },
  { clave: 'cumplimientoSla', titulo: 'Cumplimiento del acuerdo de servicio por prioridad', etiqueta: 'prioridad', valor: 'porcentaje', sufijo: ' %', max: 100, columnas: ['prioridad', 'total', 'cumplidos', 'incumplidos', 'porcentaje'] },
  { clave: 'tasaReapertura', titulo: 'Tasa de reapertura', columnas: ['resueltos', 'reabiertos', 'tasa'] },
  { clave: 'efectividadArticulos', titulo: 'Efectividad de los artículos', etiqueta: 'titulo', valor: 'tickets_resueltos', columnas: ['titulo', 'tickets_resueltos', 'votos_utiles', 'votos_no_utiles', 'utilidad'], global: true },
];

function Reporte({ def, filtros }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [verPipeline, setVerPipeline] = useState(false);

  useEffect(() => {
    setR(null);
    api(`/reportes/${def.clave}${qs(filtros)}`).then(setR).catch(setError);
  }, [def.clave, filtros]);

  return (
    <section className="bloque reporte">
      <div className="bloque-titulo">
        <h2>{def.titulo}</h2>
        <div className="botonera">
          <button className="btn btn-fantasma" onClick={() => setVerPipeline(!verPipeline)}>{verPipeline ? 'Ocultar pipeline' : 'Ver pipeline'}</button>
          <button className="btn btn-fantasma" onClick={() => descargar(`/reportes/${def.clave}${qs({ ...filtros, formato: 'csv' })}`, `${def.clave}.csv`).catch(setError)}>Exportar CSV</button>
        </div>
      </div>
      <Aviso error={error} />
      {!r ? (!error && <Cargando />) : r.datos.length === 0 ? <p className="tenue">Sin datos en este rango.</p> : (
        <>
          {def.clave === 'tasaReapertura' ? (
            <p className="cifra-sola"><strong>{r.datos[0].tasa} %</strong> de los tickets resueltos se reabrió ({r.datos[0].reabiertos} de {r.datos[0].resueltos})</p>
          ) : (
            <Barras filas={r.datos.map((d) => ({ ...d, plan: texto(d.plan), prioridad: texto(d.prioridad) }))} etiqueta={def.etiqueta} valor={def.valor} sufijo={def.sufijo} max={def.max} />
          )}
          <details>
            <summary>Ver tabla</summary>
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead><tr>{def.columnas.map((c) => <th key={c}>{texto(c)}</th>)}</tr></thead>
                <tbody>{r.datos.map((d, i) => <tr key={i}>{def.columnas.map((c) => <td key={c}>{typeof d[c] === 'number' ? d[c] : texto(d[c])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {verPipeline && r && (
        <pre className="pipeline">{`db.${r.coleccion}.aggregate(${JSON.stringify(r.pipeline, null, 2)})`}</pre>
      )}
    </section>
  );
}

export default function Reportes() {
  const { tiene } = useApp();
  const global = tiene('administrador', 'auditor');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [filtros, setFiltros] = useState({});

  return (
    <div className="pagina">
      <header className="cabecera">
        <h1>Reportes</h1>
        <p className="tenue">{global ? 'Calculados dentro de MongoDB con el Framework de Agregación.' : 'Sus propios indicadores de carga y tiempos de respuesta.'}</p>
      </header>
      <form className="filtros" onSubmit={(e) => { e.preventDefault(); setFiltros({ desde, hasta }); }}>
        <label className="campo-linea">Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo-linea">Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button className="btn btn-sec">Aplicar fechas</button>
      </form>
      <div className="rejilla-reportes">
        {REPORTES.filter((r) => global || !r.global).map((r) => <Reporte key={r.clave} def={r} filtros={filtros} />)}
      </div>
    </div>
  );
}
