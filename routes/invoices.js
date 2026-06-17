const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/invoiceController');

const adminOnly = authorize('admin');

router.use(protect);
router.get('/', adminOnly, ctrl.listInvoices);
router.get('/:id', adminOnly, ctrl.getInvoice);
router.post('/create-monthly', adminOnly, ctrl.createMonthlyInvoice);
router.post('/:id/mark-paid', adminOnly, ctrl.markPaid);

module.exports = router;
