const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const mealTimeScheduleEntrySchema = new Schema(
  {
    mealTimeScheduleDayId: { type: Types.ObjectId, ref: 'MealTimeScheduleDay', required: true, index: true },
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    breakfastTime: { type: String, required: true, trim: true },
    lunchTime: { type: String, required: true, trim: true },
    dinnerTime: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
    source: { type: String, enum: ['template', 'manual'], default: 'manual' },
    templateKey: { type: String, trim: true },
  },
  { timestamps: true }
);

mealTimeScheduleEntrySchema.index({ mealTimeScheduleDayId: 1, residentId: 1 }, { unique: true });

module.exports =
  mongoose.models.MealTimeScheduleEntry ||
  mongoose.model('MealTimeScheduleEntry', mealTimeScheduleEntrySchema);
