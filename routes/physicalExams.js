const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/physicalExamController');

router.use(protect);
router.get('/', ctrl.listExams);
router.post('/', ctrl.createExam);
router.get('/:id', ctrl.getExam);
router.put('/:id', ctrl.updateExam);
router.post('/:id/finalize', ctrl.finalizeExam);

module.exports = router;
