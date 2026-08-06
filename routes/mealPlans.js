const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/mealPlanController');
const { protect, authorize } = require('../middleware/auth');

const NURSE_ROLES = ['nurse'];

/**
 * @swagger
 * tags:
 *   name: MealPlans
 *   description: Nurse meal plans with draft/publish workflow
 */

/**
 * @swagger
 * /api/nurse/meal-plans/templates:
 *   get:
 *     tags: [MealPlans]
 *     summary: Get meal plan templates, care stages, and meal types
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Success }
 */
router.get('/templates', protect, authorize(...NURSE_ROLES), ctrl.getTemplates);

/**
 * @swagger
 * /api/nurse/meal-plans/residents:
 *   get:
 *     tags: [MealPlans]
 *     summary: List admitted residents for nurse meal-plan builder
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Success }
 */
router.get('/residents', protect, authorize(...NURSE_ROLES), ctrl.listResidents);

/**
 * @swagger
 * /api/nurse/meal-plans/drafts:
 *   post:
 *     tags: [MealPlans]
 *     summary: Create meal plan draft (requires published mealTimeScheduleDayId)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft created }
 *       400: { description: Missing mealTimeScheduleDayId or resident not in schedule }
 */
router.post('/drafts', protect, authorize(...NURSE_ROLES), ctrl.createDraft);

/**
 * @swagger
 * /api/nurse/meal-plans:
 *   get:
 *     tags: [MealPlans]
 *     summary: List meal plans
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Success }
 */
router.get('/', protect, authorize('nurse', 'caregiver'), ctrl.listPlans);

/**
 * @swagger
 * /api/nurse/meal-plans/{id}:
 *   get:
 *     tags: [MealPlans]
 *     summary: Get meal plan detail
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Success }
 */
router.get('/:id', protect, authorize('nurse', 'caregiver'), ctrl.getPlan);

/**
 * @swagger
 * /api/nurse/meal-plans/{id}:
 *   put:
 *     tags: [MealPlans]
 *     summary: Update meal plan draft (mealTimeScheduleDayId required if not set on document)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Invalid schedule link or residents }
 */
router.put('/:id', protect, authorize(...NURSE_ROLES), ctrl.updateDraft);

/**
 * @swagger
 * /api/nurse/meal-plans/{id}:
 *   delete:
 *     tags: [MealPlans]
 *     summary: Delete meal plan draft
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Deleted }
 */
router.delete('/:id', protect, authorize(...NURSE_ROLES), ctrl.deleteDraft);

/**
 * @swagger
 * /api/nurse/meal-plans/{id}/publish:
 *   post:
 *     tags: [MealPlans]
 *     summary: Publish meal plan draft
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Published }
 */
router.post('/:id/publish', protect, authorize(...NURSE_ROLES), ctrl.publishPlan);

module.exports = router;

