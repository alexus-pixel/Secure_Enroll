import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NewApplication from './pages/NewApplication';
import ApplicationDetail from './pages/ApplicationDetail';

import AdminLayout from './pages/admin/AdminLayout';
import DashboardPage from './pages/admin/DashboardPage';
import UsersPage from './pages/admin/UsersPage';
import TeachersPage from './pages/admin/TeachersPage';
import TeacherSchedulePage from './pages/admin/TeacherSchedulePage';
import EditTeacherAssignmentsPage from './pages/admin/EditTeacherAssignmentsPage';
import SchedulesPage from './pages/admin/SchedulesPage';
import GradeSchedulePage from './pages/admin/GradeSchedulePage';
import AuditLogPage from './pages/admin/AuditLogPage';
import SystemSettingsPage from './pages/admin/SystemSettingsPage';
import SchoolSettingsPage from './pages/admin/SchoolSettingsPage';
import ReportsPage from './pages/admin/ReportsPage';
import WalkInEnrollmentPage from './pages/admin/WalkInEnrollmentPage';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/applications/new" element={<ProtectedRoute><NewApplication /></ProtectedRoute>} />
          <Route path="/applications/:id" element={<ProtectedRoute><ApplicationDetail /></ProtectedRoute>} />

          <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="teachers" element={<TeachersPage />} />
            <Route path="teachers/:id" element={<TeacherSchedulePage />} />
            <Route path="teachers/:teacherId/assignments" element={<EditTeacherAssignmentsPage />} />
            <Route path="schedules" element={<SchedulesPage />} />
            <Route path="schedules/:gradeLevelId" element={<GradeSchedulePage />} />
            <Route path="audit-log" element={<AuditLogPage />} />
            <Route path="system-settings" element={<SystemSettingsPage />} />
            <Route path="school-settings" element={<SchoolSettingsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="walk-in-enrollment" element={<WalkInEnrollmentPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;