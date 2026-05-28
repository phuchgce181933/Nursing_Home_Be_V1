const express = require('express');
const router = express.Router();
const ShiftTemplate = require('../models/shiftTemplate');
const { protect, authorize } = require('../middleware/auth');

router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    const templates = await ShiftTemplate.find(query).sort({ name: 1 }).lean();
    res.json({ data: templates });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.post('/', protect, authorize('admin'), async (req, res) => {
  try {
    const {
      name,
      shiftCode,
      shiftType,
      startTime,
      endTime,
      colorLabel,
      minStaff,
      description,
      status,
    } = req.body || {};

    if (!name || !shiftCode || !shiftType || !startTime || !endTime) {
      return res.status(400).json({ message: 'Missing required fields for shift template' });
    }

    const template = await ShiftTemplate.create({
      name,
      shiftCode,
      shiftType,
      startTime,
      endTime,
      colorLabel: colorLabel || '#607D8B',
      minStaff: minStaff || 1,
      description: description || '',
      status: status || 'active',
    });

    res.status(201).json({ data: template });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const template = await ShiftTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Shift template not found' });

    const { name, shiftCode, shiftType, startTime, endTime, colorLabel, minStaff, description } = req.body || {};
    if (name !== undefined) template.name = name;
    if (shiftCode !== undefined) template.shiftCode = shiftCode;
    if (shiftType !== undefined) template.shiftType = shiftType;
    if (startTime !== undefined) template.startTime = startTime;
    if (endTime !== undefined) template.endTime = endTime;
    if (colorLabel !== undefined) template.colorLabel = colorLabel;
    if (minStaff !== undefined) template.minStaff = minStaff;
    if (description !== undefined) template.description = description;

    await template.save();
    res.json({ data: template });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.put('/:id/status', protect, authorize('admin'), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    const template = await ShiftTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Shift template not found' });
    template.status = status;
    await template.save();
    res.json({ data: template });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const template = await ShiftTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Shift template not found' });
    await template.deleteOne();
    res.json({ data: template });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

module.exports = router;
