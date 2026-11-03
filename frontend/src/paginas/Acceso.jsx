import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../contexto';
import { Aviso, Campo } from '../componentes/ui';

const DEMO = [
  ['Administrador', 'admin@helpdesk.local', 'Admin#Helpdesk2026'],
  ['Soporte', 'laura.soporte@helpdesk.local'],
  ['Soporte + Auditor', 'sofia.soporte@helpdesk.local'],
  ['Auditor', 'diego.auditor@helpdesk.local'],
  ['Cliente premium', 'maria@comercialandina.co'],
  ['Cliente suspendido', 'natalia@distrinorte.co'],
];

function Tarjeta({ titulo, children, pie }) {
  return (
    <div className="acceso">
      <div className="acceso-tiquete tiquete">
        <div className="marca marca-clara"><span className="marca-sello">HD</span><span>Mesa de Ayuda<small>Ecosistema ERP/POS</small></span></div>
        <h1>{titulo}</h1>
        {children}
      </div>
      {pie}
    </div>
  );
}

export function Login() {
  const { entrar } = useApp();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const nav = useNavigate();

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await entrar(correo, password);
      nav('/');
    } catch (err) {
      setError(err);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Tarjeta
      titulo="Iniciar sesión"
      pie={
        <details className="demo">
          <summary>Cuentas de demostración</summary>
          <p className="tenue">Contraseña de todas, salvo el administrador: <code>Demo#Helpdesk2026</code></p>
          <div className="demo-lista">
            {DEMO.map(([rol, c, p]) => (
              <button key={c} type="button" className="btn btn-sec" onClick={() => { setCorreo(c); setPassword(p || 'Demo#Helpdesk2026'); }}>
                {rol}
              </button>
            ))}
          </div>
        </details>
      }
    >
      <form onSubmit={enviar} className="pila">
        <Aviso error={error} />
        <Campo etiqueta="Correo electrónico"><input type="email" required autoComplete="username" value={correo} onChange={(e) => setCorreo(e.target.value)} /></Campo>
        <Campo etiqueta="Contraseña"><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Campo>
        <button className="btn" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <p className="acceso-enlaces"><Link to="/registro">Crear una cuenta</Link><Link to="/recuperar">Olvidé mi contraseña</Link></p>
    </Tarjeta>
  );
}

export function Registro() {
  const [f, setF] = useState({ nombre: '', tipo_documento: 'CC', documento: '', correo: '', telefono: '', password: '', nit_cliente: '' });
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      setHecho(await api('/auth/registro', { method: 'POST', body: f }));
    } catch (err) {
      setError(err);
    }
  };

  if (hecho) {
    return (
      <Tarjeta titulo="Revise su correo">
        <p>Le enviamos un código para verificar la cuenta. Hasta verificarla puede iniciar sesión, pero no crear tickets.</p>
        {hecho.token_verificacion_dev && (
          <p className="tenue">Modo desarrollo — código: <code className="codigo-largo">{hecho.token_verificacion_dev}</code></p>
        )}
        <Link className="btn" to={`/verificar?token=${hecho.token_verificacion_dev || ''}`}>Verificar cuenta</Link>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo="Crear una cuenta" pie={<p className="acceso-enlaces"><Link to="/">Ya tengo cuenta</Link></p>}>
      <form onSubmit={enviar} className="pila">
        <Aviso error={error} />
        <Campo etiqueta="Nombre completo" requerido><input required value={f.nombre} onChange={set('nombre')} /></Campo>
        <div className="fila-2">
          <Campo etiqueta="Tipo de documento">
            <select value={f.tipo_documento} onChange={set('tipo_documento')}>
              {['CC', 'CE', 'TI', 'PAS'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Número" requerido><input required value={f.documento} onChange={set('documento')} /></Campo>
        </div>
        <Campo etiqueta="Correo electrónico" requerido><input type="email" required value={f.correo} onChange={set('correo')} /></Campo>
        <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={set('telefono')} /></Campo>
        <Campo etiqueta="NIT de su empresa" ayuda="Si su empresa ya es cliente, quedará asociado a ella. Ej.: 901555222-3"><input value={f.nit_cliente} onChange={set('nit_cliente')} /></Campo>
        <Campo etiqueta="Contraseña" requerido ayuda="Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo.">
          <input type="password" required minLength={12} value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Campo>
        <button className="btn">Crear cuenta</button>
      </form>
    </Tarjeta>
  );
}

export function Verificar() {
  const [params] = useSearchParams();
  const { yo, recargar } = useApp();
  const [token, setToken] = useState(params.get('token') || '');
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api('/auth/verificar', { method: 'POST', body: { token: token.trim() } });
      setOk(r.mensaje);
      await recargar();
    } catch (err) {
      setError(err);
    }
  };
  const reenviar = async () => {
    try {
      const r = await api('/auth/reenviar-verificacion', { method: 'POST' });
      setOk(r.mensaje);
      if (r.token_verificacion_dev) setToken(r.token_verificacion_dev);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Tarjeta titulo="Verificar cuenta">
      <form onSubmit={enviar} className="pila">
        <Aviso error={error} ok={ok} />
        <Campo etiqueta="Código de verificación"><input required value={token} onChange={(e) => setToken(e.target.value)} /></Campo>
        <button className="btn">Verificar</button>
        {yo && <button type="button" className="btn btn-sec" onClick={reenviar}>Reenviar código</button>}
      </form>
      <p className="acceso-enlaces"><Link to="/">{yo ? 'Volver al inicio' : 'Iniciar sesión'}</Link></p>
    </Tarjeta>
  );
}

export function Recuperar() {
  const [correo, setCorreo] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [paso, setPaso] = useState(1);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const pedir = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api('/auth/recuperar', { method: 'POST', body: { correo } });
      setOk(r.mensaje);
      if (r.token_recuperacion_dev) setToken(r.token_recuperacion_dev);
      setPaso(2);
    } catch (err) { setError(err); }
  };
  const restablecer = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api('/auth/restablecer', { method: 'POST', body: { token, password } });
      setOk(r.mensaje);
      setPaso(3);
    } catch (err) { setError(err); }
  };

  return (
    <Tarjeta titulo="Restablecer contraseña">
      <Aviso error={error} ok={ok} />
      {paso === 1 && (
        <form onSubmit={pedir} className="pila">
          <Campo etiqueta="Correo registrado"><input type="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} /></Campo>
          <button className="btn">Enviar código</button>
        </form>
      )}
      {paso === 2 && (
        <form onSubmit={restablecer} className="pila">
          <Campo etiqueta="Código recibido (vence en 1 hora)"><input required value={token} onChange={(e) => setToken(e.target.value)} /></Campo>
          <Campo etiqueta="Nueva contraseña" ayuda="Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo."><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Campo>
          <button className="btn">Guardar contraseña</button>
        </form>
      )}
      <p className="acceso-enlaces"><Link to="/">Iniciar sesión</Link></p>
    </Tarjeta>
  );
}
