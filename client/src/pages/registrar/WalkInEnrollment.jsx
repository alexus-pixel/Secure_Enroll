import WalkInEnrollmentPage from '../admin/WalkInEnrollmentPage';
import { registrarWalkIn } from '../../api/walkIn';

// Same form and rules as the admin walk-in: the parent's Gmail is required
// and becomes their login, so the application shows on their dashboard.
export default function WalkInEnrollment() {
  return <WalkInEnrollmentPage client={registrarWalkIn} staffLabel="Registrar-assisted" />;
}