import { useEffect, useState } from 'react';
import { api, descargar, qs } from '../api';
import { Aviso, Cargando, Paginador } from '../componentes/ui';
import { fechaHora, texto } from '../util';

const resumen = (v) => (v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(', ') : '');

export default function Bitacora() {
  const [f, setF] = useState({ accion: '', entidad: '', correo: '', resultado: '', desde: '', hasta: '' });
  const [pagina, setPagina] = useState(1);
  const [r, setR] = useState(null);
  const [acciones, setAcciones] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => { api('/bitacora/acciones').then(setAcciones).catch(() => {}); }, []);
  useEffect(() => {
    api(`/bitacora${qs({ ...f, pagina, limite: 25 })}`).then(setR).catch(setError);
  }, [f, pagina]);
  const set = (k) => (e) => { setPagina(1); setF({ ...f, [k]: e.target.value }); };

  return (
    <div className="pagina">
      <header className="cabecera cabecera-accion">
        <h1>Bitácora de auditoría</h1>
        <div className="botonera">
          <button className="btn btn-sec" onClick={() => descargar(`/bitacora/exportar${qs({ ...f, formato: 'csv' })}`, 'bitacora.csv').catch(setError)}>Exportar CSV</button>
          <button className="btn btn-sec" onClick={() => descargar(`/bitacora/exportar${qs({ ...f, formato: 'json' })}`, 'bitacora.json').catch(setError)}>Exportar JSON</button>
        </div>
      </header>
      <p className="tenue">Registro de solo anexado: ninguna pantalla ni endpoint puede editar o borrar estos eventos. Las exportaciones también quedan registradas.</p>
      <div className="filtros">
        <select value={f.accion} onChange={set('accion')} aria-label="Acción"><option value="">Todas las acciones</option>{acciones.sort().map((a) => <option key={a} value={a}>{texto(a)}</option>)}</select>
        <select value={f.entidad} onChange={set('entidad')} aria-label="Entidad"><option value="">Toda entidad</option>{['usuario', 'ticket', 'membresia', 'articulo', 'reporte', 'bitacora', 'sistema'].map((x) => <option key={x} value={x}>{texto(x)}</option>)}</select>
        <select value={f.resultado} onChange={set('resultado')} aria-label="Resultado"><option value="">Éxito y fallo</option><option value="exito">Éxito</option><option value="fallo">Fallo</option></select>
        <input placeholder="Correo del usuario" value={f.correo} onChange={set('correo')} aria-label="Correo" />
        <label className="campo-linea">Desde <input type="date" value={f.desde} onChange={set('desde')} /></label>
        <label className="campo-linea">Hasta <input type="date" value={f.hasta} onChange={set('hasta')} /></label>
      </div>
      <Aviso error={error} />
      {!r ? <Cargando /> : (
        <div className="tabla-envoltura">
          <table className="tabla tabla-densa">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Entidad</th><th>Cambio</th><th>IP</th><th>Resultado</th></tr></thead>
            <tbody>
              {r.datos.map((b) => (
                <tr key={b._id}>
                  <td className="nowrap">{fechaHora(b.fecha)}</td>
                  <td>{b.correo || '—'}</td>
                  <td>{b.rol || '—'}</td>
                  <td>{texto(b.accion)}</td>
                  <td>{b.entidad}</td>
                  <td className="celda-cambio">{b.antes && <span className="tenue">{resumen(b.antes)} → </span>}{resumen(b.despues)}{b.detalle && <span className="tenue"> {b.detalle}</span>}</td>
                  <td className="tenue">{b.ip || '—'}</td>
                  <td><span className={`chip res-${b.resultado}`}>{texto(b.resultado)}</span></td>
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
