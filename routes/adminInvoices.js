const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { listInvoices, getInvoice } = require('../controllers/adminInvoiceController');

const adminOnly = authorize('admin');

router.use(protect);
router.get('/', adminOnly, listInvoices);
router.get('/:invoiceId', adminOnly, getInvoice);

module.exports = router;
