const express = require('express');
const { enrollmentInfo } = require('../controllers/publicController');

const router = express.Router();
router.get('/enrollment', enrollmentInfo);

module.exports = router;
