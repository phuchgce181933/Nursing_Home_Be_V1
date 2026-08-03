const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const controller = require('../controllers/conversationController');
const { body, query, param, validationResult } = require('express-validator');
const multer = require('multer');
const { uploadRawFileToCloudinary, uploadToCloudinary } = require('../middleware/uploadMiddleware');
const rateLimit = require('express-rate-limit');

const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// A message is valid with just text, just attachment(s), or both — only reject when
// there's truly nothing (runs after handleAttachments, so req.body.attachments is
// already the uploaded-file metadata array by the time this executes).
const requireContentOrAttachments = body('content').custom((value, { req }) => {
	const hasText = typeof value === 'string' && value.trim().length > 0;
	const hasAttachments = Array.isArray(req.body.attachments) && req.body.attachments.length > 0;
	if (!hasText && !hasAttachments) throw new Error('Nội dung hoặc tệp đính kèm là bắt buộc');
	return true;
});

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
		return res.status(500).json({ message: 'Tải tệp đính kèm thất bại: ' + err.message });
	}
};

// Only relevant when handleAttachments didn't run (i.e. the client sent JSON `attachments`
// directly instead of a real multipart file upload) — without this, a client could reference
// arbitrary external URLs/mimetypes as "attachments" and have them rendered to other
// participants, bypassing Cloudinary entirely. Legitimate attachments always resolve to a
// Cloudinary-hosted secure_url, so anything else is rejected.
const MIME_TYPE_SHAPE = /^[-\w.]+\/[-\w.+]+$/;
const validateAttachmentsShape = body('attachments').custom((value) => {
	if (value === undefined) return true;
	if (!Array.isArray(value)) throw new Error('attachments phải là một mảng');
	if (value.length > 6) throw new Error('Một tin nhắn chỉ được đính kèm tối đa 6 tệp');
	for (const att of value) {
		if (!att || typeof att !== 'object') throw new Error('Mỗi tệp đính kèm phải là một object');
		if (typeof att.fileUrl !== 'string' || !att.fileUrl.startsWith('https://res.cloudinary.com/')) {
			throw new Error('fileUrl của tệp đính kèm phải được lưu trữ trên Cloudinary');
		}
		if (att.mimeType && !MIME_TYPE_SHAPE.test(String(att.mimeType))) {
			throw new Error('mimeType của tệp đính kèm không hợp lệ');
		}
		if (att.sizeInBytes != null && (typeof att.sizeInBytes !== 'number' || att.sizeInBytes < 0 || att.sizeInBytes > 10 * 1024 * 1024)) {
			throw new Error('sizeInBytes của tệp đính kèm không hợp lệ');
		}
	}
	return true;
});

const validate = (checks) => async (req, res, next) => {
	await Promise.all(checks.map((c) => c.run(req)));
	const errors = validationResult(req);
	if (!errors.isEmpty()) return res.status(400).json({ message: 'Dữ liệu không hợp lệ', errors: errors.array() });
	next();
};

// Rate limiters for public guest endpoints to mitigate spam
const guestCreationLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10, // limit each IP to 10 create attempts per windowMs
	message: { message: 'Quá nhiều yêu cầu từ địa chỉ IP này, vui lòng thử lại sau' },
});

const guestMessageLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 30, // limit each IP to 30 messages per window
	message: { message: 'Quá nhiều tin nhắn từ địa chỉ IP này, vui lòng chậm lại' },
});

// Authenticated senders are keyed by user id (not IP) so shared-office IPs don't throttle
// each other, while still capping spam from a single compromised/malicious account.
const authenticatedMessageLimiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 30,
	message: { message: 'Bạn đã gửi quá nhiều tin nhắn, vui lòng chậm lại' },
	keyGenerator: (req) => (req.user && req.user._id ? String(req.user._id) : req.ip),
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
router.get('/search', protect, validate([query('q').notEmpty().withMessage('Từ khóa tìm kiếm (q) là bắt buộc')]), controller.searchConversations);

/**
 * @swagger
 * /conversations/staff-directory:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: List staff users available to start a direct conversation with (excludes family accounts and the caller)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Staff directory
 */
// Directory of staff users (non-family) to pick a chat partner from — must be registered
// before the generic /:conversationId route below so it isn't swallowed by it.
router.get('/staff-directory', protect, controller.getStaffDirectory);

/**
 * @swagger
 * /conversations/care-team:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: List the assigned nurse(s)/doctor(s) for the logged-in family user's resident(s)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Care team members
 */
// Family-only: assigned nurse/doctor for their resident(s), to pick a chat partner from.
router.get('/care-team', protect, controller.getCareTeam);

// Public guest conversation creation (no auth required)
router.post(
	'/guest',
	guestCreationLimiter,
	multipart.fields([{ name: 'attachments', maxCount: 6 }]),
	handleAttachments('attachments'),
	validate([
		body('guestName').notEmpty().withMessage('guestName là bắt buộc'),
		// either email or phone must be provided - we'll validate in controller as well
		validateAttachmentsShape,
	]),
	controller.createGuestConversation
);

// Guest reply to an existing guest conversation
router.post(
	'/guest/:conversationId/messages',
	guestMessageLimiter,
	multipart.fields([{ name: 'attachments', maxCount: 6 }]),
	handleAttachments('attachments'),
	validate([param('conversationId').isMongoId().withMessage('conversationId phải là một id hợp lệ'), requireContentOrAttachments, validateAttachmentsShape]),
	controller.createGuestMessage
);

// Public: get guest conversation messages
router.get('/guest/:conversationId/messages', validate([param('conversationId').isMongoId().withMessage('conversationId phải là một id hợp lệ')]), controller.getGuestMessages);

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
	authenticatedMessageLimiter,
	multipart.fields([{ name: 'attachments', maxCount: 6 }]),
	handleAttachments('attachments'),
	validate([param('conversationId').isMongoId().withMessage('conversationId phải là một id hợp lệ'), requireContentOrAttachments, validateAttachmentsShape]),
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
router.get('/:conversationId', protect, validate([param('conversationId').isMongoId().withMessage('conversationId phải là một id hợp lệ')]), controller.getConversationDetail);

// Delete a conversation (admin or owning family)
router.delete('/:conversationId', protect, validate([param('conversationId').isMongoId().withMessage('conversationId phải là một id hợp lệ')]), controller.deleteConversation);

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

/**
 * @swagger
 * /conversations/{conversationId}/messages/read:
 *   patch:
 *     tags:
 *       - Conversations
 *     summary: Mark all messages in a conversation (not sent by the caller) as read by the caller
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
 *         description: Messages marked read
 */
router.patch(
	'/:conversationId/messages/read',
	protect,
	validate([param('conversationId').isMongoId().withMessage('conversationId phải là một id hợp lệ')]),
	controller.markMessagesRead
);

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
router.get('/messages/search', protect, validate([query('q').notEmpty().withMessage('Từ khóa tìm kiếm (q) là bắt buộc')] ), controller.searchMessages);

module.exports = router;
