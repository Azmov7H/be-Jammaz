import mongoose from 'mongoose';

/**
 * T-PERF-03: running treasury balance. Single fixed document — writers
 * bump it transactionally alongside TreasuryTransaction inserts/deletes;
 * readers fall back to a lazy rebuild if the doc is missing (rollback =
 * delete the doc, next read recomputes).
 */
const TreasuryBalanceSchema = new mongoose.Schema({
    _id: { type: String, default: 'treasury' },
    balance: { type: Number, default: 0, min: Number.MIN_SAFE_INTEGER },
    updatedAt: { type: Date }
}, { versionKey: false });

TreasuryBalanceSchema.statics.DOC_ID = 'treasury';

export default mongoose.models.TreasuryBalance ||
    mongoose.model('TreasuryBalance', TreasuryBalanceSchema);
