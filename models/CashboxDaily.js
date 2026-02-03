import mongoose from 'mongoose';

const CashboxDailySchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        unique: true,
        index: true
    },
    openingBalance: {
        type: Number,
        required: true,
        default: 0
    },
    closingBalance: {
        type: Number,
        default: 0
    },

    // Auto-calculated from transactions
    salesIncome: {
        type: Number,
        default: 0,
        min: 0
    },
    purchaseExpenses: {
        type: Number,
        default: 0,
        min: 0
    },

    // Manual entries
    manualIncome: [{
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        reason: {
            type: String,
            required: true
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    manualExpenses: [{
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        reason: {
            type: String,
            required: true
        },
        category: {
            type: String,
            enum: ['rent', 'utilities', 'salaries', 'supplies', 'other'],
            default: 'other'
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],

    // Calculated fields
    totalIncome: {
        type: Number,
        default: 0
    },
    totalExpenses: {
        type: Number,
        default: 0
    },
    netChange: {
        type: Number,
        default: 0
    },
    difference: {
        type: Number,
        default: 0 // closingBalance - (openingBalance + netChange)
    },

    // Reconciliation
    isReconciled: {
        type: Boolean,
        default: false
    },
    reconciledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reconciledAt: Date,
    reconciliationNotes: String,

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Calculate totals before saving
CashboxDailySchema.pre('save', async function () {
    // Sum manual income
    const manualIncomeTotal = this.manualIncome.reduce((sum, entry) => sum + entry.amount, 0);

    // Sum manual expenses
    const manualExpensesTotal = this.manualExpenses.reduce((sum, entry) => sum + entry.amount, 0);

    // Calculate totals
    this.totalIncome = this.salesIncome + manualIncomeTotal;
    this.totalExpenses = this.purchaseExpenses + manualExpensesTotal;
    this.netChange = this.totalIncome - this.totalExpenses;

    // Expected closing balance
    const expectedClosing = this.openingBalance + this.netChange;

    // Difference (should be 0 if perfect reconciliation)
    this.difference = this.closingBalance - expectedClosing;
});

// Method to add manual income
CashboxDailySchema.methods.addIncome = function (amount, reason, userId, session = null) {
    this.manualIncome.push({
        amount,
        reason,
        createdBy: userId
    });
    return this.save({ session });
};

// Method to add manual expense
CashboxDailySchema.methods.addExpense = function (amount, reason, category, userId, session = null) {
    this.manualExpenses.push({
        amount,
        reason,
        category: category || 'other',
        createdBy: userId
    });
    return this.save({ session });
};

// Method to reconcile
CashboxDailySchema.methods.reconcile = function (actualClosingBalance, userId, notes, session = null) {
    this.closingBalance = actualClosingBalance;
    this.isReconciled = true;
    this.reconciledBy = userId;
    this.reconciledAt = new Date();
    this.reconciliationNotes = notes;
    return this.save({ session });
};

CashboxDailySchema.index({ date: -1 });
CashboxDailySchema.index({ isReconciled: 1 });

export default mongoose.models.CashboxDaily || mongoose.model('CashboxDaily', CashboxDailySchema);


