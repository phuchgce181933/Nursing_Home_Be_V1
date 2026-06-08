const express = require('express');
const payosController = require('../controllers/payosController');

const router = express.Router();

router.post('/webhook', payosController.handleWebhook);
router.get('/return', payosController.handleReturn);
router.get('/cancel', payosController.handleCancel);

module.exports = router;
