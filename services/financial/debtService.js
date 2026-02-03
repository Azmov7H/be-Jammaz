import { DebtRepository } from '../../repositories/debtRepository.js';
import Debt from '../../models/Debt.js';
import '../../models/Customer.js';
import '../../models/Supplier.js';
import dbConnect from '../../lib/db.js';
import { differenceInDays } from 'date-fns';

export class DebtService {
    /**
     * Create a new debt record
     */
    static async createDebt({
        debtorType,
        debtorId,
        amount,
        dueDate,
        referenceType,
        referenceId,
        description,
        createdBy
    }, session = null) {
        await dbConnect();

        // 1. Validation
        if (amount <= 0) {
            throw new Error('Debt amount must be greater than zero');
        }

        // 2. duplication check (same reference)
        const existing = await DebtRepository.findOne({ referenceType, referenceId, debtorType, debtorId }, session);
        if (existing) {
            return existing;
        }

        // 3. Create
        const debtData = {
            debtorType,
            debtorId,
            originalAmount: amount,
            remainingAmount: amount,
            dueDate: new Date(dueDate),
            referenceType,
            referenceId,
            description,
            status: 'active',
            createdBy
        };
        const debt = await DebtRepository.create(debtData, session);

        // 4. Update Parent Balance (Consolidated)
        const Model = debtorType === 'Customer'
            ? (await import('../../models/Customer.js')).default
            : (await import('../../models/Supplier.js')).default;

        await Model.findByIdAndUpdate(debtorId, {
            $inc: { balance: amount }
        }).session(session);

        return debt;
    }

    /**
     * Get Debts with filtering
     */
    static async getDebts(filter = {}, { page = 1, limit = 20 } = {}) {
        await dbConnect();
        const skip = (page - 1) * limit;

        const query = {};
        if (filter.debtorId) query.debtorId = filter.debtorId;
        if (filter.debtorType) query.debtorType = filter.debtorType;
        if (filter.status) {
            if (typeof filter.status === 'string' && filter.status.includes(',')) {
                query.status = { $in: filter.status.split(',') };
            } else {
                query.status = filter.status;
            }
        } else {
            // Default: Exclude settled debts from active views
            query.status = { $in: ['active', 'overdue'] };
        }
        if (filter.startDate && filter.endDate) {
            query.dueDate = { $gte: new Date(filter.startDate), $lte: new Date(filter.endDate) };
        }

        const [debts, total] = await Promise.all([
            DebtRepository.findAll(query, skip, limit, { dueDate: 1 }), // findAll handles simple sorts if adapted, or add sort to repo
            DebtRepository.count(query)
        ]);

        return {
            debts,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Get Debt by ID
     */
    static async getDebtById(id) {
        // Repository default findById populates correctly per our implementation
        await dbConnect();
        // DebtRepository.findById doesn't populate nested debtorId fields by default deeply? 
        // Our Repo definition: .populate('debtorId', 'name phone balance') 
        // Service was: .populate('debtorId', 'name phone email')
        // It's close enough.
        return await DebtRepository.findById(id);
    }

    /**
     * Update remaining amount (Internal use by PaymentService)
     */
    static async updateBalance(id, amountPaid, session = null) {
        await dbConnect();
        const debt = await Debt.findById(id).session(session);
        if (!debt) throw new Error('Debt not found');

        debt.remainingAmount -= amountPaid;

        // Auto-settlement
        if (debt.remainingAmount <= 0.01) { // 0.01 tolerance
            debt.remainingAmount = 0;
            debt.status = 'settled';
        } else if (debt.status === 'settled') {
            // Re-open if balance becomes positive (e.g. payment reversal)
            debt.status = debt.dueDate < new Date() ? 'overdue' : 'active';
        }

        await debt.save({ session });

        // Update Parent Balance (Consolidated)
        const Model = debt.debtorType === 'Customer'
            ? (await import('../../models/Customer.js')).default
            : (await import('../../models/Supplier.js')).default;

        await Model.findByIdAndUpdate(debt.debtorId, {
            $inc: { balance: -amountPaid }
        }).session(session);

        return debt;
    }

    /**
     * Update debt record manually
     */
    static async updateDebt(id, data) {
        await dbConnect();
        const debt = await Debt.findById(id).populate('debtorId', 'name');
        if (!debt) throw new Error('Debt not found');

        // Calculate old collected amount before changes
        const oldCollectedAmount = debt.originalAmount - debt.remainingAmount;

        const allowedFields = ['originalAmount', 'remainingAmount', 'dueDate', 'description'];
        allowedFields.forEach(field => {
            if (data[field] !== undefined) {
                if (field === 'dueDate') debt[field] = new Date(data[field]);
                else debt[field] = data[field];
            }
        });

        // Calculate new collected amount after changes
        const newCollectedAmount = debt.originalAmount - debt.remainingAmount;
        const collectedDifference = newCollectedAmount - oldCollectedAmount;

        // Auto-settlement logic
        if (debt.remainingAmount <= 0.01) {
            debt.remainingAmount = 0;
            debt.status = 'settled';
        } else {
            // Re-evaluate status if it was settled but now has a balance
            debt.status = new Date(debt.dueDate) < new Date() ? 'overdue' : 'active';
        }

        await debt.save();

        // Create treasury adjustment transaction if collected amount changed
        if (Math.abs(collectedDifference) > 0.01) {
            const TreasuryTransaction = (await import('../../models/TreasuryTransaction.js')).default;

            const transactionType = debt.debtorType === 'Customer'
                ? (collectedDifference > 0 ? 'INCOME' : 'EXPENSE')  // Customer: collected more = income, less = expense
                : (collectedDifference > 0 ? 'EXPENSE' : 'INCOME'); // Supplier: paid more = expense, less = income

            const adjustmentTransaction = new TreasuryTransaction({
                type: transactionType,
                amount: Math.abs(collectedDifference),
                method: 'adjustment',
                category: 'debt_adjustment',
                description: `تعديل ${debt.debtorType === 'Customer' ? 'تحصيل' : 'سداد'} - ${debt.debtorId?.name || 'غير معروف'} - ${collectedDifference > 0 ? 'زيادة' : 'نقصان'}: ${Math.abs(collectedDifference).toLocaleString()} د.ل`,
                referenceType: 'Debt',
                referenceId: debt._id,
                date: new Date(),
                createdBy: null, // System adjustment
                meta: {
                    isAdjustment: true,
                    debtId: debt._id,
                    oldCollected: oldCollectedAmount,
                    newCollected: newCollectedAmount,
                    difference: collectedDifference
                }
            });

            await adjustmentTransaction.save();
        }

        return debt;
    }

    /**
     * Write-off debt (Bad Debt)
     */
    static async writeOff(id, reason, userId) {
        await dbConnect();
        const debt = await Debt.findById(id);
        if (!debt) throw new Error('Debt not found');

        if (debt.status === 'settled') throw new Error('Cannot write off settled debt');

        debt.status = 'written-off';
        debt.meta = debt.meta || {};
        debt.meta.set('writeOffReason', reason);
        debt.meta.set('writeOffBy', userId);
        debt.meta.set('writeOffDate', new Date());

        await debt.save();
        return debt;
    }

    /**
     * Analyze Aging and get Overview
     */
    static async getDebtOverview() {
        await dbConnect();
        const now = new Date();

        const [receivables, payables] = await Promise.all([
            this.getAgingData('Customer'),
            this.getAgingData('Supplier')
        ]);

        return {
            receivables,
            payables,
            totalNet: receivables.total - payables.total,
            riskScore: this.calculateRisk(receivables)
        };
    }

    static async getAgingData(type) {
        const debts = await Debt.find({
            debtorType: type,
            status: { $in: ['active', 'overdue'] }
        }).lean();

        const now = new Date();
        const result = {
            total: 0,
            overdue: 0,
            collected: 0, // NEW: Sum of (original - remaining)
            tiers: {
                current: 0,
                tier1: 0, // 1-30 days
                tier2: 0, // 31-60 days
                tier3: 0  // 60+ days
            }
        };

        debts.forEach(debt => {
            result.total += debt.remainingAmount;
            result.collected += (debt.originalAmount - debt.remainingAmount);

            const daysOverdue = differenceInDays(now, debt.dueDate);
            if (daysOverdue > 0) {
                result.overdue += debt.remainingAmount;
                if (daysOverdue > 60) result.tiers.tier3 += debt.remainingAmount;
                else if (daysOverdue > 30) result.tiers.tier2 += debt.remainingAmount;
                else result.tiers.tier1 += debt.remainingAmount;
            } else {
                result.tiers.current += debt.remainingAmount;
            }
        });

        return result;
    }

    static calculateRisk(receivables) {
        const tier3Ratio = receivables.total > 0 ? (receivables.tiers.tier3 / receivables.total) : 0;
        if (tier3Ratio > 0.4) return 'CRITICAL';
        if (tier3Ratio > 0.2) return 'WARNING';
        return 'HEALTHY';
    }

    /**
     * Create Installment Plan for a specific Debt
     */
    static async createInstallmentPlan({
        debtId,
        installmentsCount,
        interval = 'monthly',
        startDate,
        userId
    }) {
        await dbConnect();
        const { default: PaymentSchedule } = await import('../../models/PaymentSchedule.js');

        // Defensive check for ID
        if (!debtId) throw new Error('Debt ID is required for scheduling');

        const debt = await Debt.findById(debtId);
        if (!debt) {
            throw new Error('الديون المطلوبة غير موجودة في النظام (Debt not found)');
        }

        const count = parseInt(installmentsCount);
        if (isNaN(count) || count <= 0) {
            throw new Error('عدد الأقساط يجب أن يكون رقماً صحيحاً موجباً');
        }

        const amountPerInstallment = Math.round((debt.remainingAmount / count) * 100) / 100;
        const schedules = [];
        const baseDate = new Date(startDate);

        for (let i = 0; i < count; i++) {
            const dueDate = new Date(baseDate);
            if (interval === 'monthly') dueDate.setMonth(dueDate.getMonth() + i);
            else if (interval === 'weekly') dueDate.setDate(dueDate.getDate() + (i * 7));
            else if (interval === 'daily') dueDate.setDate(dueDate.getDate() + i);

            // Last installment adjustment for rounding
            const actualAmount = (i === count - 1)
                ? (debt.remainingAmount - (amountPerInstallment * (count - 1)))
                : amountPerInstallment;

            schedules.push({
                entityType: debt.debtorType,
                entityId: debt.debtorId,
                debtId: debt._id,
                amount: actualAmount,
                dueDate,
                status: 'PENDING',
                createdBy: userId,
                notes: `قسط رقم ${i + 1} من أصل ${count} - مديونية #${debt.referenceId?.toString().slice(-6).toUpperCase()}`
            });
        }

        // Delete existing scheduled payments for this debt to avoid overlaps if re-scheduling
        await PaymentSchedule.deleteMany({ debtId, status: 'PENDING' });

        const createdSchedules = await PaymentSchedule.insertMany(schedules);

        // Update Debt Meta
        if (!debt.meta) {
            debt.meta = new Map();
        }
        debt.meta.set('isScheduled', true);
        debt.meta.set('installmentsCount', installmentsCount);
        debt.meta.set('lastScheduledUpdate', new Date());

        await debt.save();

        return createdSchedules;
    }

    /**
     * Get Payments for a specific debt (from Treasury Transactions)
     */
    static async getDebtPayments(debtId) {
        await dbConnect();
        const TreasuryTransaction = (await import('../../models/TreasuryTransaction.js')).default;

        // Find the debt to get the reference link
        const debt = await Debt.findById(debtId);
        if (!debt) return [];

        // Find transactions linked to the original invoice/PO or the debt itself
        return await TreasuryTransaction.find({
            $or: [
                { referenceId: debt.referenceId },
                { referenceId: debt._id }
            ],
            type: { $in: ['INCOME', 'EXPENSE'] }
        })
            .sort({ date: -1 })
            .populate('createdBy', 'name')
            .lean();
    }

    /**
     * Get Installments for a Debt
     */
    static async getInstallments(debtId) {
        await dbConnect();
        const { default: PaymentSchedule } = await import('../../models/PaymentSchedule.js');
        return await PaymentSchedule.find({ debtId }).sort({ dueDate: 1 }).lean();
    }

    /**
     * Sync/Initialize Debt from existing balance if missing
     */
    static async syncDebts(debtorId, debtorType) {
        await dbConnect();
        const Model = debtorType === 'Supplier'
            ? (await import('../../models/Supplier.js')).default
            : (await import('../../models/Customer.js')).default;

        const debtor = await Model.findById(debtorId);
        if (!debtor) throw new Error('Debtor not found');

        const balance = debtor.balance || 0;
        if (balance <= 0) return { message: 'Balance is zero or negative', count: 0 };

        // Check active debts
        const activeDebtsCount = await Debt.countDocuments({
            debtorId,
            debtorType,
            status: { $in: ['active', 'overdue'] }
        });

        if (activeDebtsCount === 0) {
            // Create a manual debt for the entire balance
            const debt = await this.createDebt({
                debtorType,
                debtorId,
                amount: balance,
                dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days
                referenceType: 'Manual',
                referenceId: debtorId,
                description: 'رصيد سابق (رصيد افتتاحي)',
                createdBy: null
            });
            return { message: 'تمت مزامنة الرصيد بنجاح', count: 1, debt };
        }

        return { message: 'المورد لديه مديونيات نشطة بالفعل', count: 0 };
    }

    /**
     * Get Aggregated Debtors with Totals
     */
    static async getDebtorsWithBalance(type, filter = {}, { page = 1, limit = 20 } = {}) {
        await dbConnect();
        const skip = (page - 1) * limit;

        const matchStage = {
            debtorType: type,
            status: { $in: ['active', 'overdue'] },
            remainingAmount: { $gt: 0 }
        };

        const lookupCollection = type === 'Customer' ? 'customers' : 'suppliers';

        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: '$debtorId',
                    totalDebt: { $sum: '$remainingAmount' },
                    originalTotal: { $sum: '$originalAmount' },
                    invoicesCount: { $sum: 1 },
                    oldestDueDate: { $min: '$dueDate' }
                }
            },
            {
                $lookup: {
                    from: lookupCollection,
                    localField: '_id',
                    foreignField: '_id',
                    as: 'debtorDetails'
                }
            },
            { $unwind: '$debtorDetails' },
            // Search logic
            ...(filter.search ? [{
                $match: {
                    'debtorDetails.name': { $regex: filter.search, $options: 'i' }
                }
            }] : []),
            {
                $facet: {
                    data: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 1,
                                totalDebt: 1,
                                originalTotal: 1,
                                invoicesCount: 1,
                                oldestDueDate: 1,
                                debtor: {
                                    _id: '$debtorDetails._id',
                                    name: '$debtorDetails.name',
                                    phone: '$debtorDetails.phone',
                                    priceType: '$debtorDetails.priceType',
                                    balance: '$debtorDetails.balance'
                                }
                            }
                        }
                    ],
                    totalCount: [
                        { $count: 'count' }
                    ]
                }
            }
        ];

        const result = await Debt.aggregate(pipeline);
        const data = result[0].data;
        const total = result[0].totalCount[0]?.count || 0;

        return {
            debtors: data,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Delete a debt record and reverse its effect on parent balance
     */
    static async deleteDebt(id, session = null) {
        await dbConnect();
        const debt = await Debt.findById(id).session(session);
        if (!debt) throw new Error('Debt not found');

        // 1. Reverse Parent Balance
        const Model = debt.debtorType === 'Customer'
            ? (await import('../../models/Customer.js')).default
            : (await import('../../models/Supplier.js')).default;

        await Model.findByIdAndUpdate(debt.debtorId, {
            $inc: { balance: -debt.remainingAmount }
        }).session(session);

        // 2. Delete Schedules
        const { default: PaymentSchedule } = await import('../../models/PaymentSchedule.js');
        await PaymentSchedule.deleteMany({ debtId: debt._id }).session(session);

        // 3. Delete the debt
        await debt.deleteOne({ session });

        return { success: true };
    }
}



