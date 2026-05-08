const mongoose = require('mongoose');
const { APPOINTMENT_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const careAppointmentSchema = new Schema(
  {
    residentId: { type: Types.ObjectId, ref: 'Resident', required: true, index: true },
    doctorStaffId: { type: Types.ObjectId, ref: 'StaffProfile', index: true },
    nurseStaffId: { type: Types.ObjectId, ref: 'StaffProfile', index: true },
    scheduledStartAt: { type: Date, required: true, index: true },
    scheduledEndAt: { type: Date, required: true, index: true },
    appointmentType: { type: String, trim: true, index: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'scheduled', index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.CareAppointment || mongoose.model('CareAppointment', careAppointmentSchema);
