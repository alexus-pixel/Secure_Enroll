import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AppNav from '../components/AppNav';
import '../styles/registrar.css';

// Registrar pages share the same sidebar + topbar as the parent and admin
// portals (AppNav). A detail page can name the last breadcrumb through
// the outlet context, e.g. the student's name on the review screen.
export default function RegistrarLayout() {
  const [detailCrumb, setDetailCrumb] = useState('');
  const path = useLocation().pathname;
  const onDetail = path.startsWith('/registrar/applications/');
  const crumbs = [{ label: 'Dashboard', to: '/registrar' }];
  if (onDetail) {
    crumbs.push({ label: 'Review' });
    if (detailCrumb) crumbs.push({ label: detailCrumb });
  } else if (path.startsWith('/registrar/walk-in')) {
    crumbs.push({ label: 'Walk-in Enrollment' });
  } else if (path.startsWith('/registrar/missing-lrn')) {
    crumbs.push({ label: 'Missing LRN' });
  } else if (path.startsWith('/registrar/settings')) {
    crumbs.push({ label: 'Account Settings' });
  }

  return (
    <>
      <AppNav crumbs={crumbs.length > 1 ? crumbs : null} />
      <div className="container container-wide">
        <Outlet context={{ setCrumb: setDetailCrumb }} />
      </div>
    </>
  );
}