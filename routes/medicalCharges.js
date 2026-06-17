const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/medicalChargeController');

router.use(protect);
router.get('/', ctrl.listCharges);
router.get('/:id', ctrl.getCharge);
router.put('/:id', ctrl.updateCharge);

module.exports = router;
