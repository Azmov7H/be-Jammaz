import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
        type: String,
        enum: ['system', 'business', 'user', 'admin'],
        default: 'system',
        index: true
    },
    severity: {
        type: String,
        enum: ['info', 'warning', 'critical', 'success', 'error'], // Added success/error for compatibility/UI
        default: 'info'
    },
    source: { type: String, default: 'system' }, // e.g., 'InventoryService', 'AuthService'

    // Targeting
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    targetRole: { type: String, enum: ['owner', 'manager', 'cashier', 'warehouse', null], default: null, index: true },
    isGlobal: { type: Boolean, default: false, index: true },

    // State
    isRead: { type: Boolean, default: false, index: true },

    // Context & Actions
    link: String, // URL to navigate to
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} }, // Flexible data for UI/Actions

    // Legacy fields mapped or kept for temporary compat if needed, but checking service usage:
    // we will migrate service usage to metadata/new fields.

    expiresAt: { type: Date }
}, {
    timestamps: true
});

// TTL Index: if expiresAt is set, doc deletes automatically
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for efficient user queries: "Give me unread notifs for this user"
NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

export default mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);


