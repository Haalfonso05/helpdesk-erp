import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './contexto';
import Layout from './componentes/Layout';
import { Cargando } from './componentes/ui';
import { Login, Registro, Verificar, Recuperar } from './paginas/Acceso';
import Inicio from './paginas/Inicio';
import Tickets from './paginas/Tickets';
import NuevoTicket from './paginas/NuevoTicket';
import TicketDetalle from './paginas/TicketDetalle';
import Conocimiento, { ArticuloDetalle, EditarArticulo } from './paginas/Conocimiento';
import Clientes, { ClienteDetalle } from './paginas/Clientes';
import Usuarios from './paginas/Usuarios';
import Reportes from './paginas/Reportes';
import Bitacora from './paginas/Bitacora';
import Indices from './paginas/Indices';
import Perfil from './paginas/Perfil';

export default function App() {
  const { yo, cargando } = useApp();
  if (cargando) return <div className="pantalla-centro"><Cargando /></div>;

  if (!yo) {
    return (
      <Routes>
        <Route path="/registro" element={<Registro />} />
        <Route path="/verificar" element={<Verificar />} />
        <Route path="/recuperar" element={<Recuperar />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/verificar" element={<Verificar />} />
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="tickets/nuevo" element={<NuevoTicket />} />
        <Route path="tickets/:id" element={<TicketDetalle />} />
        <Route path="conocimiento" element={<Conocimiento />} />
        <Route path="conocimiento/nuevo" element={<EditarArticulo />} />
        <Route path="conocimiento/:id" element={<ArticuloDetalle />} />
        <Route path="conocimiento/:id/editar" element={<EditarArticulo />} />
        <Route path="clientes" element={<Clientes />} />
        <Route path="clientes/:id" element={<ClienteDetalle />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="reportes" element={<Reportes />} />
        <Route path="bitacora" element={<Bitacora />} />
        <Route path="indices" element={<Indices />} />
        <Route path="perfil" element={<Perfil />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
