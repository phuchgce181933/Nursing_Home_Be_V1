const mongoose = require('mongoose');
const { FACILITY_TOUR_STATUSES } = require('./enums');

const { Schema, Types } = mongoose;

const facilityTourSchema = new Schema(
  {
    // Người đặt lịch (Family account)
    familyAccountId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    // Thông tin liên hệ tại thời điểm đặt
    contactName:  { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },

    // Ngày & giờ mong muốn tham quan
    preferredDate: { type: Date, required: true },
    preferredTimeSlot: {
      type: String,
      trim: true,
      // VD: "08:00-10:00", "14:00-16:00"
    },

    // Số lượng người đi cùng (bao gồm người đặt)
    numberOfVisitors: { type: Number, default: 1, min: 1, max: 20 },

    // Ghi chú thêm của Family
    notes: { type: String, trim: true },

    // Trạng thái xử lý
    status: {
      type: String,
      enum: FACILITY_TOUR_STATUSES,
      default: 'pending',
      index: true,
    },

    // Lý do huỷ (nếu có)
    cancellationReason: { type: String, trim: true },
    cancelledAt: { type: Date },

    // Admin xác nhận
    confirmedAt: { type: Date },
    confirmedTimeSlot: { type: String, trim: true },
    adminNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.FacilityTour ||
  mongoose.model('FacilityTour', facilityTourSchema);
