import mongoose from 'mongoose';

import { LOG_TTL_DAYS } from '../lib/config.js';

const LogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    diff: mongoose.Schema.Types.Mixed, // Stores before/after or specific changes (writer allowlist documented in logService)
    date: { type: Date, default: Date.now }
}, {
    timestamps: false,
});

// T-DB-01: query support + automatic retention window
LogSchema.index({ userId: 1, date: -1 });
LogSchema.index({ entityId: 1 });
LogSchema.index({ date: -1 });
// TTL (default 90 days; env-configurable via LOG_TTL_DAYS)
LogSchema.index({ date: 1 }, { expireAfterSeconds: LOG_TTL_DAYS * 24 * 60 * 60 });

export default mongoose.models.Log || mongoose.model('Log', LogSchema);


