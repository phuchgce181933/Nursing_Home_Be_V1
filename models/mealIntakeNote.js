const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const INTAKE_STATUSES = ['full', 'partial', 'refused', 'assisted'];

const mealIntakeNoteSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    workDate: { type: Date, required: true, index: true },
    mealType: { type: String, enum: MEAL_TYPES, required: true, index: true },
    intakeStatus: { type: String, enum: INTAKE_STATUSES, required: true },
    portionPercent: { type: Number, min: 0, max: 100 },
    plannedMealName: { type: String, trim: true },
    notes: { type: String, trim: true },
    recordedByStaffId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    recordedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

mealIntakeNoteSchema.index({ residentId: 1, workDate: 1, mealType: 1 }, { unique: true });

module.exports =
  mongoose.models.MealIntakeNote || mongoose.model('MealIntakeNote', mealIntakeNoteSchema);
