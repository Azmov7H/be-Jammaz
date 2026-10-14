import mongoose from 'mongoose';

const WarehouseSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'اسم المخزن مطلوب'],
        trim: true,
        maxlength: 200,
        index: true
    },
    code: {
        type: String,
        required: [true, 'كود المخزن مطلوب'],
        trim: true,
        unique: true,
        index: true,
        maxlength: 50
    },
    address: {
        type: String,
        trim: true
    },
    isPrimary: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Ensure only one primary warehouse exists at any time
WarehouseSchema.pre('save', async function (next) {
    if (this.isPrimary) {
        await mongoose.models.Warehouse.updateMany({ isPrimary: true }, { isPrimary: false });
    }
    next();
});

// Index for single-primary constraint enforcement at query level.
// Partial (not sparse): isPrimary always exists (default false), so a plain
// unique index would wrongly cap the collection at one non-primary document.
WarehouseSchema.index(
    { isPrimary: 1 },
    { unique: true, partialFilterExpression: { isPrimary: true } }
);

export default mongoose.models.Warehouse || mongoose.model('Warehouse', WarehouseSchema);