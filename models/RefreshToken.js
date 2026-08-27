import mongoose from 'mongoose';

// T-AUTH-02: refresh tokens are stored hashed (sha256); the raw value only
// ever lives in the client's httpOnly cookie.
const RefreshTokenSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    hash: {
        type: String,
        required: true,
        unique: true,
    },
    familyId: {
        type: String,
        required: true,
        index: true,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
    revokedAt: Date,
    replacedByHash: String,
}, {
    timestamps: true,
});

// TTL cleanup of long-expired rows
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.RefreshToken ||
    mongoose.model('RefreshToken', RefreshTokenSchema);
