const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/labResultController');

router.use(protect);
router.get('/', ctrl.listResults);
router.post('/', ctrl.createResult);
router.get('/:id', ctrl.getResult);
router.put('/:id', ctrl.updateResult);
router.post('/:id/approve', ctrl.approveResult);

module.exports = router;
