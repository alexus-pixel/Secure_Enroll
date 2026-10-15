// Turns common PostgreSQL errors caused by bad input into a clear 400 reply
// instead of a generic 500. Controllers call this first in their catch block:
//
//   } catch (err) {
//     if (sendDbError(err, res)) return;
//     ...their normal 500 handling...
//   }
const MESSAGES = {
  '22001': 'One of the values is too long.',
  '22003': 'One of the numbers is out of range.',
  '22007': 'One of the dates is not valid.',
  '22008': 'One of the dates is not valid.',
  '22P02': 'One of the values has an invalid format.',
  '23502': 'A required value is missing.',
  '23503': 'One of the selected values does not exist.',
  '23514': 'One of the values is not allowed.',
};

function sendDbError(err, res) {
  const message = err && MESSAGES[err.code];
  if (!message) return false;
  res.status(400).json({ message });
  return true;
}

module.exports = { sendDbError };
