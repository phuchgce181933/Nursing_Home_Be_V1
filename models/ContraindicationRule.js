const mongoose = require('mongoose');

const { Schema } = mongoose;

const CONTRAINDICATION_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const contraindicationRuleSchema = new Schema(
  {
    condition: { type: String, required: true, trim: true, index: true },
    forbiddenDrugs: [{ type: String, trim: true }],
    severity: { type: String, enum: CONTRAINDICATION_SEVERITIES, required: true, index: true },
    description: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ContraindicationRule ||
  mongoose.model('ContraindicationRule', contraindicationRuleSchema);
