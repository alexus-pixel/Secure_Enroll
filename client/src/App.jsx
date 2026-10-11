import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NewApplication from './pages/NewApplication';
import ApplicationDetail from './pages/ApplicationDetail';

import RegistrarLayout from './layouts/RegistrarLayout';
import RegistrarDashboard from './pages/registrar/Dashboard';
import RegistrarApplicationView from './pages/registrar/ApplicationView';
import RegistrarWalkIn from './pages/registrar/WalkInEnrollment';
import RegistrarAccountSettings from './pages/registrar/AccountSettings';
import RegistrarMissingLrn from './pages/registrar/MissingLrn';

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

          {/* Registrar */}
          <Route
            path="/registrar"
            element={
              <ProtectedRoute roles={['registrar']}>
                <RegistrarLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<RegistrarDashboard />} />
            <Route path="applications/:id" element={<RegistrarApplicationView />} />
            <Route path="walk-in" element={<RegistrarWalkIn />} />
            <Route path="settings" element={<RegistrarAccountSettings />} />
            <Route path="missing-lrn" element={<RegistrarMissingLrn />} />
          </Route>  
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;