const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/assessmentsController');

const adminOnly = authorize('admin');

router.use(protect);

// cognitive
router.get('/cognitive', ctrl.cognitive.list);
router.post('/cognitive', adminOnly, ctrl.cognitive.create);
router.get('/cognitive/:id', ctrl.cognitive.get);
router.put('/cognitive/:id', adminOnly, ctrl.cognitive.update);
router.post('/cognitive/:id/finalize', adminOnly, ctrl.cognitive.finalize);

// functional
router.get('/functional', ctrl.functional.list);
router.post('/functional', adminOnly, ctrl.functional.create);
router.get('/functional/:id', ctrl.functional.get);
router.put('/functional/:id', adminOnly, ctrl.functional.update);
router.post('/functional/:id/finalize', adminOnly, ctrl.functional.finalize);

// fall risk
router.get('/fall-risk', ctrl.fallRisk.list);
router.post('/fall-risk', adminOnly, ctrl.fallRisk.create);
router.get('/fall-risk/:id', ctrl.fallRisk.get);
router.put('/fall-risk/:id', adminOnly, ctrl.fallRisk.update);
router.post('/fall-risk/:id/finalize', adminOnly, ctrl.fallRisk.finalize);

// nutrition
router.get('/nutrition', ctrl.nutrition.list);
router.post('/nutrition', adminOnly, ctrl.nutrition.create);
router.get('/nutrition/:id', ctrl.nutrition.get);
router.put('/nutrition/:id', adminOnly, ctrl.nutrition.update);
router.post('/nutrition/:id/finalize', adminOnly, ctrl.nutrition.finalize);

module.exports = router;
