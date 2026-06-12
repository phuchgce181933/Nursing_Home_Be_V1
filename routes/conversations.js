const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const controller = require('../controllers/conversationController');
const { body, query, param, validationResult } = require('express-validator');
const multer = require('multer');
const { uploadRawFileToCloudinary, uploadToCloudinary } = require('../middleware/uploadMiddleware');
const rateLimit = require('express-rate-limit');

const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const handleAttachments = (fieldName = 'attachments') => async (req, res, next) => {
	if (!req.files || !req.files[fieldName]) return next();
	try {
		const files = req.files[fieldName];
		const uploaded = [];
		for (const file of files) {
			// choose optimized image upload for images, raw for others
			const isImage = file.mimetype && file.mimetype.startsWith('image/');
			const result = isImage
				? await uploadToCloudinary(file.buffer, 'nursing-home/attachments')
				: await uploadRawFileToCloudinary(file.buffer, 'nursing-home/attachments');
			uploaded.push({
				fileName: file.originalname,
				fileUrl: result.secure_url,
				mimeType: file.mimetype,
				sizeInBytes: file.size,
				uploadedAt: new Date(),
			});
		}
		req.body.attachments = uploaded;
		return next();
	} catch (err) {
		console.error('Attachment upload failed', err);
		return res.status(500).json({ message: 'Attachment upload failed: ' + err.message });
	}
};

const validate = (checks) => async (req, res, next) => {
	await Promise.all(checks.map((c) => c.run(req)));
	const errors = validationResult(req);
	if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
	next();
};

// Rate limiters for public guest endpoints to mitigate spam
const guestCreationLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10, // limit each IP to 10 create attempts per windowMs
	message: { message: 'Too many guest requests from this IP, please try again later' },
});

const guestMessageLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 30, // limit each IP to 30 messages per window
	message: { message: 'Too many messages from this IP, please slow down' },
});

/**
 * @swagger
 * tags:
 *   - name: Conversations
 *     description: Conversation and messaging APIs
 */

/**
 * @swagger
 * /conversations:
 *   post:
 *     tags:
 *       - Conversations
 *     summary: Create a conversation
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               familyAccountId:
 *                 type: string
 *               residentId:
 *                 type: string
 *               participantUserIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               subject:
 *                 type: string
 *     responses:
 *       201:
 *         description: Conversation created
 *       400:
 *         description: Validation error
 */
// Create a conversation
router.post(
	'/',
	protect,
	controller.createConversation
);

/**
 * @swagger
 * /conversations:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: List conversations for current user
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: residentId
 *         schema:
 *           type: string
 *         description: filter by resident
 *     responses:
 *       200:
 *         description: List of conversations
 */
// List conversations for current user
router.get('/', protect, controller.listConversations);

/**
 * @swagger
 * /conversations/search:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: Search conversations by query
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Search results
 */
// Search conversations (q)
router.get('/search', protect, validate([query('q').notEmpty().withMessage('q is required')]), controller.searchConversations);

// Public guest conversation creation (no auth required)
router.post(
	'/guest',
	guestCreationLimiter,
	multipart.fields([{ name: 'attachments', maxCount: 6 }]),
	handleAttachments('attachments'),
	validate([
		body('guestName').notEmpty().withMessage('guestName is required'),
		// either email or phone must be provided - we'll validate in controller as well
	]),
	controller.createGuestConversation
);

// Guest reply to an existing guest conversation
router.post(
	'/guest/:conversationId/messages',
	guestMessageLimiter,
	multipart.fields([{ name: 'attachments', maxCount: 6 }]),
	handleAttachments('attachments'),
	validate([param('conversationId').isMongoId().withMessage('conversationId must be a valid id'), body('content').notEmpty().withMessage('content is required')]),
	controller.createGuestMessage
);

// Public: get guest conversation messages
router.get('/guest/:conversationId/messages', validate([param('conversationId').isMongoId().withMessage('conversationId must be a valid id')]), controller.getGuestMessages);

/**
 * @swagger
 * /conversations/{conversationId}/messages:
 *   post:
 *     tags:
 *       - Conversations
 *     summary: Send a message in a conversation
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Message sent
 */
// Create message in a conversation
router.post(
	'/:conversationId/messages',
	protect,
	multipart.fields([{ name: 'attachments', maxCount: 6 }]),
	handleAttachments('attachments'),
	validate([param('conversationId').isMongoId().withMessage('conversationId must be a valid id'), body('content').notEmpty().withMessage('content is required')]),
	controller.createMessage
);

/**
 * @swagger
 * /conversations/{conversationId}:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: Get conversation detail
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation detail
 */
// Get conversation detail
router.get('/:conversationId', protect, validate([param('conversationId').isMongoId().withMessage('conversationId must be a valid id')]), async (req, res) => {
	const { conversationId } = req.params;
	const Conversation = require('../models/conversation');
	const conv = await Conversation.findById(conversationId).populate('participantUserIds', 'fullName email role').lean();
	if (!conv) return res.status(404).json({ message: 'Conversation not found' });
	if (req.user.role === 'family' && String(conv.familyAccountId) !== String(req.user._id)) return res.status(403).json({ message: 'Access forbidden' });
	res.json({ success: true, data: conv });
});

// Delete a conversation (admin or owning family)
router.delete('/:conversationId', protect, validate([param('conversationId').isMongoId().withMessage('conversationId must be a valid id')]), controller.deleteConversation);

/**
 * @swagger
 * /conversations/{conversationId}/messages:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: Get messages for a conversation (paginated)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated messages
 */
// Get messages for a conversation (paginated)
router.get('/:conversationId/messages', protect, controller.getMessages);

// Search messages (global or within a conversation)
/**
 * @swagger
 * /conversations/messages/search:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: Search messages globally or within a conversation
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *         description: Search query text
 *       - in: query
 *         name: conversationId
 *         schema:
 *           type: string
 *         description: Optional conversation id to restrict search
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated messages search results
 */
router.get('/messages/search', protect, validate([query('q').notEmpty().withMessage('q is required')] ), controller.searchMessages);

module.exports = router;
