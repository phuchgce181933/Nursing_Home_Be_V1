const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const clinicalServiceSchema = new Schema(
  {
    serviceCode: { type: String, required: true, unique: true, trim: true, index: true },
    serviceName: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true },
    unitPrice: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    fields: [
      {
        fieldCode: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        type: { type: String, enum: ['TEXT', 'IMAGE', 'NUMBER', 'DROPDOWN'], default: 'TEXT' },
        placeholder: { type: String, trim: true },
        required: { type: Boolean, default: false },
        min: { type: Number },
        max: { type: Number },
        maleMin: { type: Number },
        maleMax: { type: Number },
        femaleMin: { type: Number },
        femaleMax: { type: Number },
        options: [{ type: String, trim: true }],
      },
    ],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Use synchronous pre-save hook (no `next` callback) to avoid Kareem "next is not a function" errors
clinicalServiceSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.models.ClinicalService || mongoose.model('ClinicalService', clinicalServiceSchema);
