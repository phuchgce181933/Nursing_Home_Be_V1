const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const mealPlanEntrySchema = new Schema(
  {
    mealPlanDayId: { type: Types.ObjectId, ref: 'MealPlanDay', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    mealType: { type: String, enum: ['breakfast', 'lunch', 'dinner'], required: true },
    mealName: { type: String, required: true, trim: true },
    ingredients: [{ type: String, trim: true }],
    calories: { type: Number, min: 0 },
    nutritionNote: { type: String, trim: true },
    stageNote: { type: String, trim: true },
    source: { type: String, enum: ['template', 'manual'], default: 'manual' },
    templateKey: { type: String, trim: true },
    mealTime: { type: String, trim: true }, // HH:mm (optional custom)
  },
  { timestamps: true }
);

mealPlanEntrySchema.index({ mealPlanDayId: 1, residentId: 1, mealType: 1 });

module.exports = mongoose.models.MealPlanEntry || mongoose.model('MealPlanEntry', mealPlanEntrySchema);

