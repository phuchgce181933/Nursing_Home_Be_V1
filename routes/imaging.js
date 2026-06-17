const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/imagingController');

const adminOnly = authorize('admin');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(protect);
router.get('/', ctrl.listImaging);
router.post('/', adminOnly, ctrl.createImaging);
router.post('/upload', adminOnly, upload.single('file'), ctrl.uploadFileAndCreate);
router.get('/:id', ctrl.getImaging);
router.put('/:id', adminOnly, ctrl.updateImaging);
router.post('/:id/finalize', adminOnly, ctrl.finalizeImaging);

module.exports = router;
