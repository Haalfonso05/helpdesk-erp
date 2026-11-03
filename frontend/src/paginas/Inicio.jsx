import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../contexto';
import { Barras, Cargando, Estado, Membresia, Prioridad, Sla } from '../componentes/ui';
import { fecha, haceCuanto, texto } from '../util';

function Cifra({ valor, etiqueta, tono }) {
  return <div className={`cifra ${tono ? `cifra-${tono}` : ''}`}><strong>{valor}</strong><span>{etiqueta}</span></div>;
}

export default function Inicio() {
  const { yo, tiene, meta } = useApp();
  const [tablero, setTablero] = useState(null);
  const [recientes, setRecientes] = useState(null);
  const global = tiene('administrador', 'auditor');
  const staff = tiene('soporte', 'administrador', 'auditor');

  useEffect(() => {
    api('/tickets?limite=6&orden=-fecha_actualizacion').then((r) => setRecientes(r.datos)).catch(() => setRecientes([]));
    if (staff) api('/reportes/tablero').then((r) => setTablero(r.datos[0])).catch(() => {});
  }, [staff]);

  const u = yo.usuario;
  const cliente = yo.cliente;
  const cuenta = (lista, id) => lista?.find((x) => x._id === id)?.total || 0;

  return (
    <div className="pagina">
      <header className="cabecera">
        <h1>Hola, {u.nombre.split(' ')[0]}</h1>
        {cliente && tiene('cliente') && (
          <p className="tenue">{cliente.razon_social} · plan {cliente.membresia.plan} · <Membresia valor={cliente.membresia.estado} /></p>
        )}
      </header>

      {cliente && tiene('cliente') && !['activa', 'en_gracia'].includes(cliente.membresia.estado) && (
        <div className="aviso aviso-error">La membresía de su empresa está {cliente.membresia.estado}. No puede crear tickets nuevos ni consultar la base de conocimientos; sus tickets abiertos siguen su curso.</div>
      )}

      {staff && tablero && (
        <section className="bloque">
          <h2>{global ? 'Panorama general' : 'Mis tickets'}</h2>
          <div className="cifras">
            <Cifra valor={tablero.totales[0]?.abiertos || 0} etiqueta="abiertos" />
            <Cifra valor={cuenta(tablero.porEstado, 'nuevo')} etiqueta="sin atender" tono="alerta" />
            <Cifra valor={cuenta(tablero.porEstado, 'escalado')} etiqueta="escalados" tono="peligro" />
            <Cifra valor={tablero.calificacion[0] ? tablero.calificacion[0].promedio.toFixed(1) : '—'} etiqueta="calificación promedio" />
          </div>
          <div className="dos-col">
            <div>
              <h3>Por estado</h3>
              <Barras filas={tablero.porEstado.map((e) => ({ ...e, nombre: texto(e._id) }))} etiqueta="nombre" valor="total" />
            </div>
            <div>
              <h3>Creados por mes</h3>
              <Barras filas={tablero.porMes} etiqueta="_id" valor="total" />
            </div>
          </div>
        </section>
      )}

      {tiene('cliente') && cliente && (
        <section className="bloque">
          <h2>Módulos contratados</h2>
          <p>{cliente.membresia.modulos_contratados.map((m) => meta?.modulos[m]?.nombre || m).join(', ')}</p>
          <p className="tenue">Renovación: {fecha(cliente.membresia.fecha_renovacion)}</p>
          <Link to="/tickets/nuevo" className="btn">Reportar un problema</Link>
        </section>
      )}

      <section className="bloque">
        <div className="bloque-titulo">
          <h2>Actividad reciente</h2>
          <Link to="/tickets">Ver todos los tickets</Link>
        </div>
        {!recientes ? <Cargando /> : recientes.length === 0 ? (
          <p className="tenue">Todavía no hay tickets.</p>
        ) : (
          <ul className="lista-tickets">
            {recientes.map((t) => (
              <li key={t._id}>
                <Link to={`/tickets/${t._id}`}>
                  <code className="codigo">{t.codigo}</code>
                  <span className="lt-asunto">{t.asunto}</span>
                  <Estado valor={t.estado} />
                  <Prioridad valor={t.prioridad} />
                  <Sla valor={t.estado_sla} />
                  <span className="tenue">{haceCuanto(t.fecha_actualizacion)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
