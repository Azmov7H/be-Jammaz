import mongoose from 'mongoose';

/**
 * T-DB-08: dedicated surrogate model — alias over the `customers` collection
 * used by TreasuryTransaction refPath ('UnifiedCollection'). Replaces the
 * import side-effect previously hidden in models/TreasuryTransaction.js.
 */
export default mongoose.models.UnifiedCollection ||
    mongoose.model('UnifiedCollection', new mongoose.Schema({}, { strict: false }), 'customers');
