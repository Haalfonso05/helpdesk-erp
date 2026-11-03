import { useEffect, useState } from 'react';
import { api } from '../api';
import { Aviso, Cargando } from '../componentes/ui';

export default function Indices() {
  const [indices, setIndices] = useState(null);
  const [consultas, setConsultas] = useState([]);
  const [resultado, setResultado] = useState({});
  const [error, setError] = useState(null);
  const [tareas, setTareas] = useState(null);

  useEffect(() => {
    api('/admin/indices').then(setIndices).catch(setError);
    api('/admin/explain').then(setConsultas).catch(setError);
  }, []);

  const ejecutar = async (clave) => {
    try { setResultado({ ...resultado, [clave]: await api(`/admin/explain/${clave}`) }); } catch (e) { setError(e); }
  };

  return (
    <div className="pagina">
      <header className="cabecera">
        <h1>Índices y planes de ejecución</h1>
        <p className="tenue">Ejecuta consultas reales con <code>.explain("executionStats")</code> para comparar documentos examinados contra documentos devueltos.</p>
      </header>
      <Aviso error={error} />

      <section className="bloque">
        <h2>Consultas de demostración</h2>
        <ul className="explains">
          {consultas.map((c) => {
            const r = resultado[c.clave];
            const s = r?.resumen;
            const usaIndice = s && !s.etapas.includes('COLLSCAN');
            return (
              <li key={c.clave}>
                <div className="explain-cab">
                  <p>{c.descripcion}</p>
                  <button className="btn btn-sec" onClick={() => ejecutar(c.clave)}>Ejecutar explain</button>
                </div>
                <pre className="pipeline">{c.mongosh}</pre>
                {s && (
                  <div className={`explain-res ${usaIndice ? 'bien' : 'mal'}`}>
                    <span><strong>{s.etapas.join(' ← ')}</strong></span>
                    <span>Índice: <strong>{s.indice || 'ninguno'}</strong></span>
                    <span>Llaves examinadas: <strong>{s.totalKeysExamined}</strong></span>
                    <span>Documentos examinados: <strong>{s.totalDocsExamined}</strong></span>
                    <span>Devueltos: <strong>{s.nReturned}</strong></span>
                    <span>Tiempo: <strong>{s.executionTimeMillis} ms</strong></span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="bloque">
        <h2>Índices por colección</h2>
        {!indices ? <Cargando /> : (
          <div className="tabla-envoltura">
            <table className="tabla tabla-densa">
              <thead><tr><th>Colección</th><th>Nombre</th><th>Llaves</th><th>Tipo</th><th>Usos</th></tr></thead>
              <tbody>
                {Object.entries(indices).flatMap(([col, lista]) => lista.map((i) => (
                  <tr key={col + i.nombre}>
                    <td>{col}</td>
                    <td><code className="codigo">{i.nombre}</code></td>
                    <td><code>{JSON.stringify(i.llaves)}</code></td>
                    <td>{[i.unico && 'único', i.parcial && 'parcial (solo tickets abiertos)', i.ttl !== null && `TTL ${i.ttl}s`, i.idioma && `texto (${i.idioma})`, Object.keys(i.llaves).length > 1 && !i.idioma && 'compuesto'].filter(Boolean).join(', ') || 'simple'}</td>
                    <td>{i.usos ?? '—'}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bloque">
        <h2>Tareas programadas</h2>
        <p className="tenue">Corren cada hora: ciclo de membresías, cierre automático de tickets resueltos, alertas de SLA y cola de correos.</p>
        <button className="btn btn-sec" onClick={() => api('/admin/tareas', { method: 'POST' }).then(setTareas).catch(setError)}>Ejecutar ahora</button>
        {tareas && <pre className="pipeline">{JSON.stringify(tareas, null, 2)}</pre>}
      </section>
    </div>
  );
}
