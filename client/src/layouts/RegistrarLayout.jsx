import { Outlet } from 'react-router-dom';
import Sidebar from '../components/registrar/Sidebar';
import Topbar from '../components/registrar/Topbar';
import '../styles/registrar.css';

export default function RegistrarLayout() {
  return (
    <div className="reg-shell">
      <Sidebar />
      <div className="reg-main">
        <Topbar />
        <main className="reg-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}