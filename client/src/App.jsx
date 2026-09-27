import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import NewApplication from './pages/NewApplication';
import ApplicationDetail from './pages/ApplicationDetail';
import AccountSettings from './pages/AccountSettings';
import Schedule from './pages/Schedule';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/applications/new" element={<ProtectedRoute><NewApplication /></ProtectedRoute>} />
          <Route path="/applications/:id" element={<ProtectedRoute><ApplicationDetail /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
          <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;