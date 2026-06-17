const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const svc = require('../controllers/clinicalServiceController');

const adminOnly = authorize('admin');
const clinicalReadAccess = authorize('doctor', 'nurse', 'admin');

router.use(protect);
router.get('/', clinicalReadAccess, svc.listServices);
router.post('/', adminOnly, svc.createService);
router.get('/:id', clinicalReadAccess, svc.getService);
router.put('/:id', adminOnly, svc.updateService);
router.delete('/:id', adminOnly, svc.deleteService);

module.exports = router;
