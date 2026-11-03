import { useState } from 'react';
import { api, sesion } from '../api';
import { useApp } from '../contexto';
import { Aviso, Campo } from '../componentes/ui';

export default function Perfil() {
  const { yo, recargar } = useApp();
  const u = yo.usuario;
  const pref = u.preferencias_notificacion || {};
  const [f, setF] = useState({ nombre: u.nombre, telefono: u.telefono || '', preferencias_notificacion: { frecuencia: pref.frecuencia || 'inmediata', tickets: pref.tickets !== false, membresia: pref.membresia !== false } });
  const [pw, setPw] = useState({ actual: '', nueva: '' });
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const guardar = async (e) => {
    e.preventDefault();
    try { await api('/auth/perfil', { method: 'PUT', body: f }); setOk('Perfil actualizado'); recargar(); } catch (err) { setError(err); }
  };
  const cambiarPw = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/password', { method: 'PUT', body: pw });
      sesion.token = r.token;
      setOk('Contraseña actualizada. Las demás sesiones se cerraron.');
      setPw({ actual: '', nueva: '' });
    } catch (err) { setError(err); }
  };
  const setPref = (k, v) => setF({ ...f, preferencias_notificacion: { ...f.preferencias_notificacion, [k]: v } });

  return (
    <div className="pagina pagina-angosta">
      <header className="cabecera"><h1>Mi perfil</h1><p className="tenue">{u.correo}</p></header>
      <Aviso error={error} ok={ok} onCerrar={() => { setError(null); setOk(null); }} />
      <form className="tarjeta pila" onSubmit={guardar}>
        <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
        <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></Campo>
        <fieldset className="casillas"><legend>Notificaciones por correo</legend>
          <label><input type="checkbox" checked={f.preferencias_notificacion.tickets} onChange={(e) => setPref('tickets', e.target.checked)} /> Cambios en mis tickets</label>
          <label><input type="checkbox" checked={f.preferencias_notificacion.membresia} onChange={(e) => setPref('membresia', e.target.checked)} /> Estado de la membresía</label>
          <label>Frecuencia{' '}
            <select value={f.preferencias_notificacion.frecuencia} onChange={(e) => setPref('frecuencia', e.target.value)}>
              <option value="inmediata">Inmediata</option><option value="resumen_diario">Resumen diario</option>
            </select>
          </label>
          <small className="tenue">Los avisos de seguridad (contraseña, correo, roles) siempre se envían.</small>
        </fieldset>
        <button className="btn">Guardar perfil</button>
      </form>
      <form className="tarjeta pila" onSubmit={cambiarPw}>
        <h2>Cambiar contraseña</h2>
        <Campo etiqueta="Contraseña actual"><input type="password" required value={pw.actual} onChange={(e) => setPw({ ...pw, actual: e.target.value })} autoComplete="current-password" /></Campo>
        <Campo etiqueta="Nueva contraseña" ayuda="Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo."><input type="password" required value={pw.nueva} onChange={(e) => setPw({ ...pw, nueva: e.target.value })} autoComplete="new-password" /></Campo>
        <button className="btn">Cambiar contraseña</button>
      </form>
    </div>
  );
}
