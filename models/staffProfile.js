const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const staffProfileSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    staffCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    specialty: { type: String, trim: true },
    roleCategory: { type: String, trim: true, index: true },
    certifications: [{ type: String, trim: true }],
    responsibleAreaIds: [{ type: Types.ObjectId, ref: 'Floor' }],
    assignedResidentIds: [{ type: Types.ObjectId, ref: 'Resident' }],
  },
  { timestamps: true }
);

module.exports = mongoose.models.StaffProfile || mongoose.model('StaffProfile', staffProfileSchema);
