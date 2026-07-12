const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/dishController');

const adminOnly = authorize('admin');
const dishReadAccess = authorize('nurse', 'admin');

router.use(protect);
router.get('/', dishReadAccess, ctrl.listDishes);
router.post('/', adminOnly, ctrl.createDish);
router.get('/:id', dishReadAccess, ctrl.getDish);
router.put('/:id', adminOnly, ctrl.updateDish);
router.delete('/:id', adminOnly, ctrl.deleteDish);

module.exports = router;
