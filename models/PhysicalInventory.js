import mongoose from 'mongoose';

const PhysicalInventorySchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    location: {
        type: String,
        enum: ['warehouse', 'shop', 'both'],
        required: true
    },
    category: {
        type: String,
        trim: true
    },
    isBlind: {
        type: Boolean,
        default: false
    },
    items: [{
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        productName: String, // Snapshot
        productCode: String, // Snapshot
        systemQty: {
            type: Number,
            required: true
        },
        actualQty: {
            type: Number,
            required: true
        },
        difference: {
            type: Number,
            default: 0
        }, // actualQty - systemQty
        buyPrice: Number, // Snapshot for value calculation
        value: Number, // difference * buyPrice
        reason: String,
        justification: String,
        justificationReason: {
            type: String,
            enum: ['damage', 'expired', 'theft', 'data_error', 'other', null],
            default: null
        }
    }],
    totalShortage: {
        type: Number,
        default: 0
    }, // Sum of negative differences
    totalSurplus: {
        type: Number,
        default: 0
    }, // Sum of positive differences
    netDifference: {
        type: Number,
        default: 0
    }, // totalSurplus - totalShortage
    valueImpact: {
        type: Number,
        default: 0
    }, // Financial value of discrepancy
    status: {
        type: String,
        enum: ['draft', 'completed', 'cancelled'],
        default: 'draft'
    },
    notes: String,
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date
}, {
    timestamps: true
});

// Pre-save middleware to calculate totals
PhysicalInventorySchema.pre('save', async function () {
    let shortage = 0;
    let surplus = 0;
    let valueImpact = 0;

    this.items.forEach(item => {
        item.difference = item.actualQty - item.systemQty;
        item.value = item.difference * (item.buyPrice || 0);

        if (item.difference < 0) {
            shortage += Math.abs(item.difference);
        } else if (item.difference > 0) {
            surplus += item.difference;
        }

        valueImpact += item.value;
    });

    this.totalShortage = shortage;
    this.totalSurplus = surplus;
    this.netDifference = surplus - shortage;
    this.valueImpact = valueImpact;
});

// Indexes
PhysicalInventorySchema.index({ date: -1 });
PhysicalInventorySchema.index({ location: 1 });
PhysicalInventorySchema.index({ status: 1 });

// Method to complete count and mark as approved
PhysicalInventorySchema.methods.complete = function (userId, session = null) {
    this.status = 'completed';
    this.approvedBy = userId;
    this.approvedAt = new Date();
    return this.save({ session });
};

export default mongoose.models.PhysicalInventory || mongoose.model('PhysicalInventory', PhysicalInventorySchema);


