const express = require('express');
const payosController = require('../controllers/payosController');

const router = express.Router();

router.post('/webhook', payosController.handleWebhook);

module.exports = router;
