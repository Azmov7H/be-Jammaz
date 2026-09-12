import mongoose from 'mongoose';

/**
 * FIN-TAHWEESH-01 (T-09): the set-aside (Tahweesh) balance. Single fixed
 * document, mirroring the TreasuryBalance pattern:
 * - writers move it only inside the transfer/spend transaction, with a
 *   $gte guard on decrements so concurrent spends can never drive it
 *   negative;
 * - readers fall back to a rebuild from the ledger (sum of INCOME minus
 *   sum of EXPENSE over method:'tahweesh' rows) if the doc is missing.
 * Unlike operating channels, Tahweesh has no overdraft concept: every
 * outflow validates requested <= available first.
 */
const TahweeshBalanceSchema = new mongoose.Schema({
    _id: { type: String, default: 'tahweesh' },
    balance: { type: Number, default: 0, min: 0 },
    updatedAt: { type: Date }
}, { versionKey: false });

TahweeshBalanceSchema.statics.DOC_ID = 'tahweesh';

export default mongoose.models.TahweeshBalance ||
    mongoose.model('TahweeshBalance', TahweeshBalanceSchema);
