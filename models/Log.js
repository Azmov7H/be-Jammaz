import mongoose from 'mongoose';

const LogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    diff: mongoose.Schema.Types.Mixed, // Stores before/after or specific changes
    date: { type: Date, default: Date.now }
});

export default mongoose.models.Log || mongoose.model('Log', LogSchema);


