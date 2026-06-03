const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const specialDietEntrySchema = new Schema(
  {
    specialDietDayId: { type: Types.ObjectId, ref: 'SpecialDietDay', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    dietType: {
      type: String,
      enum: ['diabetic', 'low_sodium', 'renal', 'high_protein', 'soft_texture', 'liquid_only', 'custom'],
      required: true,
      index: true,
    },
    restrictions: [{ type: String, trim: true }],
    nutritionGoal: { type: String, trim: true },
    notes: { type: String, trim: true },
    source: { type: String, enum: ['template', 'manual'], default: 'manual' },
    templateKey: { type: String, trim: true },
    effectiveTime: { type: String, trim: true }, // HH:mm
  },
  { timestamps: true }
);

specialDietEntrySchema.index({ specialDietDayId: 1, residentId: 1, dietType: 1 });

module.exports = mongoose.models.SpecialDietEntry || mongoose.model('SpecialDietEntry', specialDietEntrySchema);
