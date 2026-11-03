import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../contexto';
import { texto } from '../util';

export default function Layout() {
  const { yo, roles, tiene, salir, contexto, setContexto } = useApp();
  const [abierto, setAbierto] = useState(false);
  const u = yo.usuario;
  const esAuditorMulti = u.roles.includes('auditor') && u.roles.length > 1;

  const enlaces = [
    { a: '/', t: 'Inicio', ver: true },
    { a: '/tickets', t: 'Tickets', ver: true },
    { a: '/tickets/nuevo', t: 'Reportar un problema', ver: tiene('cliente', 'administrador') },
    { a: '/conocimiento', t: 'Base de conocimientos', ver: true },
    { a: '/clientes', t: tiene('cliente') && roles.length === 1 ? 'Mi empresa' : 'Clientes y membresías', ver: true },
    { a: '/usuarios', t: 'Usuarios', ver: tiene('administrador', 'auditor') },
    { a: '/reportes', t: 'Reportes', ver: tiene('soporte', 'administrador', 'auditor') },
    { a: '/bitacora', t: 'Bitácora', ver: tiene('administrador', 'auditor') },
    { a: '/indices', t: 'Índices y explain', ver: tiene('administrador') },
  ];

  return (
    <div className="marco">
      <aside className={`lateral ${abierto ? 'abierto' : ''}`}>
        <div className="marca">
          <span className="marca-sello" aria-hidden="true">HD</span>
          <span>Mesa de Ayuda<small>Sistemas Integrados S.A.</small></span>
          <button className="btn-icono menu" onClick={() => setAbierto(!abierto)} aria-label="Abrir menú">☰</button>
        </div>
        <nav onClick={() => setAbierto(false)}>
          {enlaces.filter((e) => e.ver).map((e) => (
            <NavLink key={e.a} to={e.a} end={e.a === '/' || e.a === '/tickets'}>{e.t}</NavLink>
          ))}
        </nav>
        <div className="quien">
          <NavLink to="/perfil" className="quien-nombre">{u.nombre}</NavLink>
          <span className="quien-roles">{u.roles.map(texto).join(' + ')}</span>
          {esAuditorMulti && (
            <label className="interruptor">
              <input type="checkbox" checked={contexto === 'auditoria'} onChange={(e) => setContexto(e.target.checked ? 'auditoria' : null)} />
              Actuar como auditor (solo lectura)
            </label>
          )}
          <button className="btn btn-fantasma" onClick={salir}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="contenido">
        {u.estado === 'pendiente_verificacion' && (
          <div className="aviso aviso-alerta">Su cuenta aún no está verificada: puede navegar, pero no crear tickets. <NavLink to="/verificar">Verificar ahora</NavLink></div>
        )}
        {contexto === 'auditoria' && <div className="aviso aviso-alerta">Está actuando en contexto de auditoría: todo es de solo lectura.</div>}
        <Outlet />
      </main>
    </div>
  );
}
