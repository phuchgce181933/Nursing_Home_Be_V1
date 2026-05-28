const mongoose = require('mongoose');

const { Schema } = mongoose;

const shiftTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    shiftCode: { type: String, required: true, trim: true, uppercase: true },
    shiftType: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    colorLabel: { type: String, trim: true, default: '#607D8B' },
    minStaff: { type: Number, default: 1 },
    description: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ShiftTemplate || mongoose.model('ShiftTemplate', shiftTemplateSchema);
