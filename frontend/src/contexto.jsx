import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, sesion } from './api';

const Ctx = createContext(null);

export function ProveedorApp({ children }) {
  const [yo, setYo] = useState(null);
  const [meta, setMeta] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [contexto, setContextoEstado] = useState(sesion.contexto);

  const recargar = useCallback(async () => {
    if (!sesion.token) { setYo(null); return; }
    try { setYo(await api('/auth/yo')); } catch { setYo(null); }
  }, []);

  useEffect(() => {
    Promise.all([api('/meta').then(setMeta).catch(() => {}), recargar()]).finally(() => setCargando(false));
    const expirar = () => setYo(null);
    window.addEventListener('sesion-expirada', expirar);
    return () => window.removeEventListener('sesion-expirada', expirar);
  }, [recargar]);

  const entrar = async (correo, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { correo, password } });
    sesion.token = r.token;
    sesion.contexto = null;
    setContextoEstado(null);
    await recargar();
    return r;
  };

  const salir = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ya expiró */ }
    sesion.token = null;
    sesion.contexto = null;
    setYo(null);
  };

  const setContexto = async (c) => {
    sesion.contexto = c;
    setContextoEstado(c);
    await recargar();
  };

  const roles = yo?.roles_efectivos || [];
  const tiene = (...r) => r.some((x) => roles.includes(x));

  return (
    <Ctx.Provider value={{ yo, meta, cargando, entrar, salir, recargar, roles, tiene, contexto, setContexto }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
