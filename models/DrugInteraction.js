const mongoose = require('mongoose');

const { Schema } = mongoose;

const INTERACTION_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE'];

const drugInteractionSchema = new Schema(
  {
    drugA: { type: String, required: true, trim: true, index: true },
    drugB: { type: String, required: true, trim: true, index: true },
    severity: { type: String, enum: INTERACTION_SEVERITIES, required: true, index: true },
    description: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

// Compound index so lookup works regardless of order (drugA,drugB) or (drugB,drugA)
drugInteractionSchema.index({ drugA: 1, drugB: 1 }, { unique: true });

module.exports =
  mongoose.models.DrugInteraction ||
  mongoose.model('DrugInteraction', drugInteractionSchema);
