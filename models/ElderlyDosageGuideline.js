const mongoose = require('mongoose');

const { Schema } = mongoose;

const elderlyDosageGuidelineSchema = new Schema(
  {
    medicationName: { type: String, required: true, unique: true, trim: true, index: true },
    maxDailyDose: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ElderlyDosageGuideline ||
  mongoose.model('ElderlyDosageGuideline', elderlyDosageGuidelineSchema);
