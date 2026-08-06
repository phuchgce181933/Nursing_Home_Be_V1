const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/ecgController');

const adminOnly = authorize('admin');
router.use(protect);
router.get('/', ctrl.listECG);
router.post('/', adminOnly, ctrl.createECG);
router.get('/:id', ctrl.getECG);
router.put('/:id', adminOnly, ctrl.updateECG);
router.post('/:id/finalize', adminOnly, ctrl.finalizeECG);

module.exports = router;
