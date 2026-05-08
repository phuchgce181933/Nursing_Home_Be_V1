const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const reportSnapshotSchema = new Schema(
  {
    reportType: { type: String, required: true, trim: true, index: true },
    generatedByUserId: { type: Types.ObjectId, ref: 'User', index: true },
    title: { type: String, required: true, trim: true },
    filters: { type: Schema.Types.Mixed },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    summaryMetrics: { type: Schema.Types.Mixed },
    chartData: { type: Schema.Types.Mixed },
    exportedFileUrl: { type: String, trim: true },
    generatedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ReportSnapshot || mongoose.model('ReportSnapshot', reportSnapshotSchema);
