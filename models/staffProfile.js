const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const staffProfileSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    staffCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    specialty: { type: String, trim: true },
    roleCategory: { type: String, trim: true, index: true },
    certifications: [{ type: String, trim: true }],
    certificationDocuments: [
      {
        url: { type: String, trim: true },
        publicId: { type: String, trim: true },
        fileName: { type: String, trim: true },
        mimeType: { type: String, trim: true },
        issueDate: { type: Date },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    responsibleAreaIds: [{ type: Types.ObjectId, ref: 'Floor' }],
    responsibleRoomIds: [{ type: Types.ObjectId, ref: 'Room' }],
    assignedResidentIds: [{ type: Types.ObjectId, ref: 'Resident' }],
    leaveBalance: {
      annual:    { type: Number, default: 12 },
      sick:      { type: Number, default: 10 },
      emergency: { type: Number, default: 3 },
      unpaid:    { type: Number, default: 999 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.StaffProfile || mongoose.model('StaffProfile', staffProfileSchema);
