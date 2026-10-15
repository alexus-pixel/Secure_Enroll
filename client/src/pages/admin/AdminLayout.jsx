import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AppNav from '../../components/AppNav';
import './admin.css';

// Names for routes that have one fixed title. The three detail routes (a
// specific teacher's schedule, their assignments editor, one grade level's
// weekly schedule) have no fixed name: each of those pages calls
// setCrumb() from useOutletContext() once it knows its own title.
const STATIC_CRUMBS = {
  '/admin/dashboard': 'Dashboard',
  '/admin/users': 'User Management',
  '/admin/teachers': 'Teachers',
  '/admin/schedules': 'Class Schedules',
  '/admin/walk-in-enrollment': 'Walk-in Enrollment',
  '/admin/audit-log': 'Audit Log',
  '/admin/system-settings': 'System Settings',
  '/admin/school-settings': 'School Settings',
  '/admin/reports': 'Reports & Export',
};

// Same sidebar + topbar as the parent and registrar portals (AppNav).
export default function AdminLayout() {
  const location = useLocation();
  const [dynamicCrumb, setDynamicCrumb] = useState('');
  const crumb = STATIC_CRUMBS[location.pathname] ?? dynamicCrumb;
  const crumbs = [{ label: 'SecureEnroll', to: '/admin/dashboard' }, ...(crumb ? [{ label: crumb }] : [])];

  return (
    <>
      <AppNav crumbs={crumbs} />
      <div className="container container-wide">
        <Outlet context={{ setCrumb: setDynamicCrumb }} />
      </div>
    </>
  );
}