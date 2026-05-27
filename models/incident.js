const mongoose = require('mongoose');
const { INCIDENT_SEVERITIES, INCIDENT_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const fileAttachmentSchema = new Schema(
  {
    fileName: { type: String, trim: true },
    fileUrl: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    sizeInBytes: { type: Number, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const incidentSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', index: true },
    reportedByStaffId: { type: Types.ObjectId, ref: 'StaffProfile', required: true, index: true },
    reportedByUserId: { type: Types.ObjectId, ref: 'User', index: true },
    reporterName: { type: String, trim: true },
    reporterEmail: { type: String, trim: true, lowercase: true },
    reporterPhone: { type: String, trim: true },
    reporterRole: { type: String, trim: true },
    incidentType: { type: String, required: true, trim: true, index: true },
    severity: { type: String, enum: INCIDENT_SEVERITIES, default: 'medium', index: true },
    incidentAt: { type: Date, required: true, index: true },
    location: { type: String, trim: true },
    description: { type: String, required: true, trim: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'open', index: true },
    assignedStaffIds: [{ type: Types.ObjectId, ref: 'StaffProfile' }],
    notifiedManagement: { type: Boolean, default: false },
    notifiedFamilyIds: [{ type: Types.ObjectId, ref: 'User' }],
    attachments: [fileAttachmentSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.models.Incident || mongoose.model('Incident', incidentSchema);
