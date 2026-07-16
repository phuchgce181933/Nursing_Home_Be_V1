const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const dishSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    calories: { type: Number, required: true, min: 0 },
    ingredients: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Types.ObjectId, ref: 'User' },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

dishSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.models.Dish || mongoose.model('Dish', dishSchema);
