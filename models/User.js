import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide a name'],
        trim: true,
    },
    email: {
        type: String,
        required: [true, 'Please provide an email'],
        unique: true,
        lowercase: true,
        trim: true,
    },
    password: {
        type: String,
        required: false, // Optional for OAuth users
        select: false,
        minlength: [8, 'كلمة المرور قصيرة جدا'],
    },
    tokenVersion: {
        type: Number,
        default: 0,
        select: false,
    },
    role: {
        // Canonical set (T-AUTH-01): 'accountant'/'sales' removed — no
        // permission mapping ever existed for them. Legacy docs are migrated
        // by scripts/db/migrate-legacy-roles.js.
        type: String,
        enum: ['owner', 'manager', 'cashier', 'warehouse', 'viewer'],
        default: 'cashier',
    },
    picture: String,
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// T-DB-01
UserSchema.index({ role: 1 });
UserSchema.index({ isActive: 1 });

export default mongoose.models.User || mongoose.model('User', UserSchema);


