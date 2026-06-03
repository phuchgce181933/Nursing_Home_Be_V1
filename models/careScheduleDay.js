const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const careScheduleDaySchema = new Schema(
  {
    workDate: { type: Date, required: true, index: true },
    title: { type: String, trim: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
    publishedBy: { type: Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date },
    changeLog: [
      {
        changedBy: { type: Types.ObjectId, ref: 'User' },
        changedAt: { type: Date, default: Date.now },
        action: { type: String, trim: true },
        details: { type: Schema.Types.Mixed },
      },
    ],
  },
  { timestamps: true }
);

careScheduleDaySchema.index({ workDate: 1, status: 1 });

module.exports = mongoose.models.CareScheduleDay || mongoose.model('CareScheduleDay', careScheduleDaySchema);

