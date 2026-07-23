const express = require('express');
const router = express.Router();
const {
  listResidents,
  getResidentsAreaSummary,
  listResidentsByArea,
  getResidentDetail,
  getTransferTargets,
  transferResidentToRoom,
  listResidentsForInitialHealth,
  listResidentsForPreExisting,
  listResidentsForDrugAllergies,
  getInitialHealth,
  recordInitialHealth,
  getPreExistingConditions,
  updatePreExistingConditions,
  getDrugAllergies,
  updateDrugAllergies,
  getResidentFamilyInfo,
  addEmergencyContact,
  replaceEmergencyContacts,
  updateEmergencyContact,
  removeEmergencyContact,
} = require('../controllers/residentController');
const { protect, authorize } = require('../middleware/auth');

const adminManager = authorize('admin', 'manager');
const allStaff = authorize('admin', 'manager', 'doctor', 'nurse', 'caregiver');
const drugAllergiesRead = authorize('admin', 'manager', 'doctor', 'nurse');
const drugAllergiesWrite = authorize('doctor');

/**
 * @swagger
 * /api/residents:
 *   get:
 *     summary: List residents (assignment picker or family management with pagination)
 *     description: |
 *       Without page/limit — returns residents for staff assignment picker (floorId, roomId filters).
 *       With page or limit — returns paginated list with emergencyContactCount for family management UI.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: When set, enables family management list mode
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: floorId
 *         schema:
 *           type: string
 *       - in: query
 *         name: roomId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by fullName or residentCode
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: admitted
 *     responses:
 *       200:
 *         description: Residents list (with emergencyContactCount when paginated)
 */
router.get('/', protect, allStaff, listResidents);

/**
 * @swagger
 * /api/residents/areas/summary:
 *   get:
 *     summary: Resident counts per floor and room (View Residents by Area)
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: buildingId
 *         schema:
 *           type: string
 *         description: Filter by building (recommended)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: admitted
 *     responses:
 *       200:
 *         description: totalResidents and floors with residentCount per room
 */
router.get('/areas/summary', protect, adminManager, getResidentsAreaSummary);

/**
 * @swagger
 * /api/residents/by-area:
 *   get:
 *     summary: Paginated residents list filtered by building, floor, or room
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: buildingId
 *         schema:
 *           type: string
 *       - in: query
 *         name: floorId
 *         schema:
 *           type: string
 *       - in: query
 *         name: roomId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: admitted
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: |
 *           Residents with room, floor, building, bed labels, and drugAllergies
 *           (hasDrugAllergiesRecord, drugAllergiesCount on each item).
 *       400:
 *         description: buildingId or floorId required
 */
router.get('/by-area', protect, adminManager, listResidentsByArea);

/**
 * @swagger
 * /api/residents/initial-health:
 *   get:
 *     summary: List residents for admission-time health (admin/manager)
 *     description: |
 *       Health status at nursing-home admission (e.g. healthy, active, weak needing 1-1 care) — not pre-admission disease history.
 *       Each row `_id` is `residentId` for GET/PUT `/api/residents/:residentId/initial-health`.
 *       `hasInitialHealthRecord` is based on `initialHealthCondition` only.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: admitted
 *       - in: query
 *         name: recorded
 *         schema:
 *           type: boolean
 *         description: true = already has initialHealthCondition, false = not yet recorded
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated list with hasInitialHealthRecord flag
 */
router.get('/initial-health', protect, allStaff, listResidentsForInitialHealth);

/**
 * @swagger
 * /api/residents/pre-existing-conditions:
 *   get:
 *     summary: List residents for pre-admission conditions & history (admin/manager)
 *     description: |
 *       Diseases and medical history before entering the nursing home (e.g. asthma, dengue). Not admission-time fitness.
 *       Each item includes `_id`, `room`/`floor`/`building`, `hasPreExistingRecord`, `chronicConditionsCount`, `medicalHistoryCount`.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: admitted
 *       - in: query
 *         name: recorded
 *         schema:
 *           type: boolean
 *         description: true = has chronicConditions or medicalHistory entries, false = neither
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated list with area and record flags
 */
router.get('/pre-existing-conditions', protect, allStaff, listResidentsForPreExisting);

/**
 * @swagger
 * /api/residents/drug-allergies:
 *   get:
 *     summary: List residents for drug allergies management (admin/manager)
 *     description: |
 *       Each item includes `_id` (residentId), `room`/`floor`/`building` aligned with by-area lists,
 *       and `hasDrugAllergiesRecord`, `drugAllergiesCount`.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: admitted
 *       - in: query
 *         name: recorded
 *         schema:
 *           type: boolean
 *         description: true = has at least one drug allergy entry, false = none
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated list with area and record flags
 */
router.get('/drug-allergies', protect, drugAllergiesRead, listResidentsForDrugAllergies);

/**
 * @swagger
 * /api/residents/{residentId}/family:
 *   get:
 *     summary: Get resident family info and emergency contacts
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resident detail with emergencyContacts array
 *       404:
 *         description: Resident not found
 */
router.get('/:residentId/family', protect, adminManager, getResidentFamilyInfo);

/**
 * @swagger
 * /api/residents/{residentId}/initial-health:
 *   get:
 *     summary: Get admission-time health for a resident
 *     description: Returns `initialHealth` with `bloodType` and `initialHealthCondition` only (not chronicConditions or allergies).
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resident identity and initialHealth object
 *       404:
 *         description: Resident not found
 *   put:
 *     summary: Record or update admission-time health
 *     description: |
 *       Describe the resident's condition when admitted (healthy, active, weak needing 1-1 care, etc.).
 *       Do not send `chronicConditions`, `medicalHistory`, or `allergies` — use pre-existing-conditions and drug-allergies endpoints.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [initialHealthCondition]
 *             properties:
 *               bloodType:
 *                 type: string
 *                 enum: [A+, A-, B+, B-, AB+, AB-, O+, O-, unknown]
 *               initialHealthCondition:
 *                 type: string
 *                 minLength: 10
 *                 description: Narrative of health at admission (not pre-admission disease list)
 *     responses:
 *       200:
 *         description: Health condition saved
 *       400:
 *         description: Validation error
 */
router.get('/:residentId/initial-health', protect, allStaff, getInitialHealth);
router.put('/:residentId/initial-health', protect, allStaff, recordInitialHealth);

/**
 * @swagger
 * /api/residents/{residentId}/pre-existing-conditions:
 *   get:
 *     summary: Get pre-admission conditions and medical history
 *     description: |
 *       `chronicConditions` = ongoing chronic diseases before admission; `medicalHistory` = past episodes (e.g. dengue).
 *       Resident includes building (tòa), floor (tầng), room (phòng), and bed when assigned.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Resident MongoDB _id or residentCode (e.g. RES003)
 *     responses:
 *       200:
 *         description: Resident with area (building, floor, room, bed) and preExistingConditions (includes hasPreExistingRecord, counts)
 *   put:
 *     summary: Update pre-admission conditions and medical history
 *     description: |
 *       For illnesses before entering the nursing home — not admission-time fitness (use initial-health).
 *       Accepts fields at root or nested under `preExistingConditions`. residentId may be _id or residentCode.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               chronicConditions:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Chronic diseases before admission (e.g. asthma, diabetes); array or CSV; 2-200 chars/item; max 30
 *               medicalHistory:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Past medical episodes before admission (e.g. dengue); array or CSV; 2-200 chars/item; max 30
 *               preExistingConditions:
 *                 type: object
 *                 description: Optional wrapper; same chronicConditions/medicalHistory fields inside
 *                 properties:
 *                   chronicConditions:
 *                     type: array
 *                     items:
 *                       type: string
 *                   medicalHistory:
 *                     type: array
 *                     items:
 *                       type: string
 *     responses:
 *       200:
 *         description: Pre-existing conditions updated (includes resident and preExistingConditions with record flags)
 *       400:
 *         description: Validation error
 */
router.get('/:residentId/pre-existing-conditions', protect, allStaff, getPreExistingConditions);
router.put('/:residentId/pre-existing-conditions', protect, allStaff, updatePreExistingConditions);

/**
 * @swagger
 * /api/residents/{residentId}/drug-allergies:
 *   get:
 *     summary: Get drug allergies of a resident
 *     description: Resident includes building (tòa), floor (tầng), room (phòng), and bed when assigned.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Resident MongoDB _id or residentCode (e.g. RES002)
 *     responses:
 *       200:
 *         description: Resident with area and drugAllergies (includes hasDrugAllergiesRecord, drugAllergiesCount)
 *   put:
 *     summary: Update drug allergies
 *     description: |
 *       residentId may be _id or residentCode. Accepts drugAllergies at root (array, may be empty),
 *       nested object with drugAllergies/items, or legacy `allergies` field name.
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [drugAllergies]
 *             properties:
 *               drugAllergies:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array or comma-separated string; may be empty to clear all; max 30 items
 *               allergies:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Legacy alias for drugAllergies
 *     responses:
 *       200:
 *         description: Drug allergies updated (includes resident and record flags)
 *       400:
 *         description: Validation error or missing drugAllergies field
 */
router.get('/:residentId/drug-allergies', protect, drugAllergiesRead, getDrugAllergies);
router.put('/:residentId/drug-allergies', protect, drugAllergiesWrite, updateDrugAllergies);

/**
 * @swagger
 * /api/residents/{residentId}/emergency-contacts:
 *   post:
 *     summary: Add one emergency contact
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, relationship, phone]
 *             properties:
 *               fullName:
 *                 type: string
 *               relationship:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               address:
 *                 type: string
 *               isPrimary:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Contact added
 *   put:
 *     summary: Replace all emergency contacts (bulk sync)
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contacts:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Contacts replaced
 */
router.post('/:residentId/emergency-contacts', protect, adminManager, addEmergencyContact);
router.put('/:residentId/emergency-contacts', protect, adminManager, replaceEmergencyContacts);

/**
 * @swagger
 * /api/residents/{residentId}/emergency-contacts/{contactId}:
 *   put:
 *     summary: Update one emergency contact
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               relationship:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               address:
 *                 type: string
 *               isPrimary:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Contact updated
 *   delete:
 *     summary: Remove one emergency contact
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contact removed
 */
router.put('/:residentId/emergency-contacts/:contactId', protect, adminManager, updateEmergencyContact);
router.delete('/:residentId/emergency-contacts/:contactId', protect, adminManager, removeEmergencyContact);

/**
 * @swagger
 * /api/residents/{residentId}/transfer-room/targets:
 *   get:
 *     summary: Get available transfer targets (rooms and beds)
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: floorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resident current assignment and target rooms with availableBeds
 *       400:
 *         description: Validation error
 *       404:
 *         description: Resident or floor not found
 */
router.get('/:residentId/transfer-room/targets', protect, adminManager, getTransferTargets);

/**
 * @swagger
 * /api/residents/{residentId}/transfer-room:
 *   post:
 *     summary: Transfer resident to another room and bed
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetRoomId, targetBedId]
 *             properties:
 *               targetRoomId:
 *                 type: string
 *               targetBedId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Resident transferred successfully; staff with this resident in assignedResidentIds get destination floor/room added to responsible areas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 resident:
 *                   type: object
 *                 from:
 *                   type: object
 *                 to:
 *                   type: object
 *                 staffAreasSynced:
 *                   type: array
 *                   description: Doctor/nurse profiles whose responsibleAreaIds or responsibleRoomIds were expanded
 *                   items:
 *                     type: object
 *                     properties:
 *                       staffProfileId:
 *                         type: string
 *                       staffCode:
 *                         type: string
 *                       addedFloorIds:
 *                         type: array
 *                         items:
 *                           type: string
 *                       addedRoomIds:
 *                         type: array
 *                         items:
 *                           type: string
 *       400:
 *         description: Validation error or target unavailable
 *       404:
 *         description: Resident, room, or bed not found
 */
router.post('/:residentId/transfer-room', protect, adminManager, transferResidentToRoom);

/**
 * @swagger
 * /api/residents/{residentId}:
 *   get:
 *     summary: Get resident detail with area and health info (View Residents by Area)
 *     tags: [Residents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: residentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Resident MongoDB _id or residentCode (e.g. RES005)
 *     responses:
 *       200:
 *         description: |
 *           Full resident profile with area (room, floor, building, bed) and drugAllergies
 *           (hasDrugAllergiesRecord, drugAllergiesCount).
 *       404:
 *         description: Resident not found
 */
router.get('/:residentId', protect, allStaff, getResidentDetail);

// Merge param router for vital logs & medical records
router.use('/:residentId/medical-records', require('./medicalRecords'));
router.use('/:residentId/invoices', require('./payments'));

module.exports = router;
