const express = require('express');
const router = express.Router();
const residentService = require('../services/residentService');
const residentRepo = require('../repositories/residentRepository');
const facilityService = require('../services/facilityService');

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page || 1, 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// Public list used by admin UI and assignment pickers
router.get('/', async (req, res) => {
  try {
    const result = await residentService.adminListResidents(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// List residents for initial-health view (simple summary)
router.get('/initial-health', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status) filter.residencyStatus = req.query.status;
    if (req.query.search) {
      const term = String(req.query.search).trim();
      if (term) filter.$or = [
        { residentCode: { $regex: term, $options: 'i' } },
        { fullName: { $regex: term, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      residentRepo.findAll(filter, { sort: { createdAt: -1 }, skip, limit }),
      residentRepo.countAll(filter),
    ]);

    const mapped = (data || []).map((r) => ({
      _id: r._id,
      residentCode: r.residentCode,
      fullName: r.fullName,
      hasInitialHealthRecord: Boolean(r.initialHealthCondition),
    }));

    res.json({ data: mapped, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.get('/:residentId/initial-health', async (req, res) => {
  try {
    const resident = await residentRepo.findById(req.params.residentId);
    if (!resident) return res.status(404).json({ message: 'Resident not found' });
    res.json({
      resident: {
        _id: resident._id,
        residentCode: resident.residentCode,
        fullName: resident.fullName,
        age: resident.age,
        gender: resident.gender,
        residencyStatus: resident.residencyStatus,
      },
      initialHealth: {
        bloodType: resident.bloodType,
        initialHealthCondition: resident.initialHealthCondition,
        hasInitialHealthRecord: Boolean(resident.initialHealthCondition),
        updatedAt: resident.updatedAt,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// Family / emergency contacts for admin UI
router.get('/:residentId/family', async (req, res) => {
  try {
    const resident = await residentRepo.findById(req.params.residentId);
    if (!resident) return res.status(404).json({ message: 'Resident not found' });
    res.json({
      resident: { _id: resident._id, residentCode: resident.residentCode, fullName: resident.fullName },
      emergencyContacts: resident.emergencyContacts || [],
      familyPortalAccountIds: resident.familyPortalAccountIds || [],
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:residentId/initial-health', async (req, res) => {
  try {
    const update = {};
    if (req.body.bloodType !== undefined) update.bloodType = req.body.bloodType;
    if (req.body.initialHealthCondition !== undefined)
      update.initialHealthCondition = String(req.body.initialHealthCondition || '').trim() || undefined;

    if (Object.keys(update).length === 0) return res.status(400).json({ message: 'No fields to update' });

    const before = await residentRepo.findById(req.params.residentId);
    if (!before) return res.status(404).json({ message: 'Resident not found' });

    const updated = await residentRepo.updateById(req.params.residentId, update);
    res.json({ message: 'Recorded initial health', resident: updated });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// Pre-existing conditions list (summary)
router.get('/pre-existing-conditions', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status) filter.residencyStatus = req.query.status;
    const [data, total] = await Promise.all([
      residentRepo.findAll(filter, { sort: { createdAt: -1 }, skip, limit }),
      residentRepo.countAll(filter),
    ]);

    const mapped = (data || []).map((r) => ({
      _id: r._id,
      residentCode: r.residentCode,
      fullName: r.fullName,
      chronicConditionsCount: (r.chronicConditions || []).length,
      medicalHistoryCount: 0,
      hasPreExistingRecord: (r.chronicConditions || []).length > 0,
    }));

    res.json({ data: mapped, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.get('/:residentId/pre-existing-conditions', async (req, res) => {
  try {
    const resident = await residentRepo.findById(req.params.residentId);
    if (!resident) return res.status(404).json({ message: 'Resident not found' });
    res.json({
      resident: { _id: resident._id, residentCode: resident.residentCode, fullName: resident.fullName },
      preExistingConditions: {
        chronicConditions: resident.chronicConditions || [],
        medicalHistory: resident.medicalHistory || [],
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:residentId/pre-existing-conditions', async (req, res) => {
  try {
    const update = {};
    if (req.body.chronicConditions !== undefined) update.chronicConditions = req.body.chronicConditions;
    if (req.body.medicalHistory !== undefined) update.medicalHistory = req.body.medicalHistory;
    if (Object.keys(update).length === 0) return res.status(400).json({ message: 'No fields to update' });

    const before = await residentRepo.findById(req.params.residentId);
    if (!before) return res.status(404).json({ message: 'Resident not found' });
    const updated = await residentRepo.updateById(req.params.residentId, update);
    res.json({ message: 'Pre-existing conditions updated', preExistingConditions: { chronicConditions: updated.chronicConditions || [], medicalHistory: updated.medicalHistory || [] } });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// Drug allergies
router.get('/drug-allergies', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    const [data, total] = await Promise.all([
      residentRepo.findAll(filter, { sort: { createdAt: -1 }, skip, limit }),
      residentRepo.countAll(filter),
    ]);

    const mapped = (data || []).map((r) => ({
      _id: r._id,
      residentCode: r.residentCode,
      fullName: r.fullName,
      drugAllergiesCount: (r.allergies || []).length,
      hasDrugAllergiesRecord: (r.allergies || []).length > 0,
    }));

    res.json({ data: mapped, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.get('/:residentId/drug-allergies', async (req, res) => {
  try {
    const resident = await residentRepo.findById(req.params.residentId);
    if (!resident) return res.status(404).json({ message: 'Resident not found' });
    res.json({ resident: { _id: resident._id, residentCode: resident.residentCode, fullName: resident.fullName }, drugAllergies: { drugAllergies: resident.allergies || [] } });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:residentId/drug-allergies', async (req, res) => {
  try {
    const update = {};
    if (req.body.drugAllergies !== undefined) update.allergies = req.body.drugAllergies;
    if (Object.keys(update).length === 0) return res.status(400).json({ message: 'No fields to update' });
    const before = await residentRepo.findById(req.params.residentId);
    if (!before) return res.status(404).json({ message: 'Resident not found' });
    const updated = await residentRepo.updateById(req.params.residentId, update);
    res.json({ message: 'Drug allergies updated', drugAllergies: { drugAllergies: updated.allergies || [] } });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// Transfer targets and transfer action
router.get('/:residentId/transfer-room/targets', async (req, res) => {
  try {
    const params = req.query || {};
    // delegate to facilityService to list candidate rooms
    const rooms = await facilityService.listRooms({ floorId: params.floorId, activeOnly: true });
    res.json({ targets: rooms });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.post('/:residentId/transfer-room', async (req, res) => {
  try {
    const { targetRoomId } = req.body || {};
    if (!targetRoomId) return res.status(400).json({ message: 'targetRoomId is required' });
    const before = await residentRepo.findById(req.params.residentId);
    if (!before) return res.status(404).json({ message: 'Resident not found' });
    const updated = await residentRepo.updateById(req.params.residentId, { roomId: targetRoomId });
    res.json({ message: 'Resident transferred', resident: updated });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

module.exports = router;
