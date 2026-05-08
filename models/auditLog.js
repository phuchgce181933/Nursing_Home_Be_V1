const mongoose = require('mongoose');

const { Schema, Types } = mongoose;

const auditLogSchema = new Schema(
  {
    actorUserId: { type: Types.ObjectId, ref: 'User', index: true },
    actorRole: { type: String, trim: true, index: true },
    action: { type: String, required: true, trim: true, index: true },
    module: { type: String, required: true, trim: true, index: true },
    targetEntityType: { type: String, trim: true, index: true },
    targetEntityId: { type: Types.ObjectId, index: true },
    beforeData: { type: Schema.Types.Mixed },
    afterData: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
