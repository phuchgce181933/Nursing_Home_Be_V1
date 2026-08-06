const mongoose = require('mongoose');
const { SHIFT_TEMPLATE_STATUSES, SHIFT_TYPES } = require('./enums');

const { Schema, Types } = mongoose;

const shiftTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    shiftCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    shiftType: { type: String, required: true, enum: SHIFT_TYPES },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    totalHours: { type: Number },
    crossesMidnight: { type: Boolean, default: false },
    department: { type: Types.ObjectId, ref: 'Floor', index: true },
    colorLabel: { type: String, trim: true, default: '#607D8B' },
    status: { type: String, enum: SHIFT_TEMPLATE_STATUSES, default: 'active', index: true },
    isSystem: { type: Boolean, default: false, index: true },
    isFlexibleTime: { type: Boolean, default: false },
    description: { type: String, trim: true },
    createdBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Uniqueness: same name allowed across different departments, but not within the same department
shiftTemplateSchema.index({ name: 1, department: 1 }, { unique: true, sparse: true });

// Auto-calculate totalHours before save
shiftTemplateSchema.pre('save', async function () {
  const toMinutes = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const start = toMinutes(this.startTime);
  const end = toMinutes(this.endTime);
  const diff = end > start ? end - start : 1440 - start + end;
  this.totalHours = Math.round((diff / 60) * 100) / 100;
  this.crossesMidnight = end <= start;
});

module.exports = mongoose.models.ShiftTemplate || mongoose.model('ShiftTemplate', shiftTemplateSchema);
