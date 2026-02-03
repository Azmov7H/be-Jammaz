import Supplier from '../models/Supplier.js';
import dbConnect from '../lib/db.js';

export const SupplierService = {
    async getAll({ page = 1, limit = 20, search }) {
        await dbConnect();

        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { contactName: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (page - 1) * limit;
        const [suppliers, total] = await Promise.all([
            Supplier.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            Supplier.countDocuments(query)
        ]);

        return {
            suppliers,
            pagination: {
                total,
                pages: Math.ceil(total / limit),
                page: Number(page),
                limit: Number(limit)
            }
        };
    },

    async getById(id) {
        await dbConnect();
        const supplier = await Supplier.findById(id).lean();
        if (!supplier) throw 'Supplier not found';
        return supplier;
    },

    async create(data) {
        await dbConnect();

        const { openingBalance, openingBalanceType, ...supplierData } = data;

        const existing = await Supplier.findOne({ name: supplierData.name });
        if (existing) {
            throw 'اسم المورد موجود بالفعل';
        }

        const supplier = await Supplier.create({
            ...supplierData,
            balance: 0
        });

        if (openingBalance && openingBalance > 0) {
            const AccountingEntry = (await import('../models/AccountingEntry.js')).default;
            const { DebtService } = await import('../services/financial/debtService.js');

            if (openingBalanceType === 'credit') {
                // We owe supplier (Credit AP)
                await AccountingEntry.createEntry({
                    type: 'ADJUSTMENT',
                    debitAccount: 'Opening Balance Equity',
                    creditAccount: 'Accounts Payable',
                    amount: parseFloat(openingBalance),
                    description: `رصيد افتتاحي للمورد: ${supplier.name}`,
                    refType: 'Manual',
                    refId: supplier._id
                });

                // Create Debt Record for granular tracking
                await DebtService.createDebt({
                    debtorType: 'Supplier',
                    debtorId: supplier._id,
                    amount: parseFloat(openingBalance),
                    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days
                    referenceType: 'Manual',
                    referenceId: supplier._id,
                    description: `رصيد افتتاحي (مديونية سابقة)`,
                    createdBy: null // Service will handle or we can pass if added to params
                });
            } else {
                // Supplier owes us (Debit AP)
                await AccountingEntry.createEntry({
                    type: 'ADJUSTMENT',
                    debitAccount: 'Accounts Payable',
                    creditAccount: 'Opening Balance Equity',
                    amount: parseFloat(openingBalance),
                    description: `رصيد افتتاحي مدين (لنا) عند المورد: ${supplier.name}`,
                    refType: 'Manual',
                    refId: supplier._id
                });
            }
        }

        return supplier;
    },

    async update(id, data) {
        await dbConnect();
        const supplier = await Supplier.findByIdAndUpdate(id, data, { new: true });
        if (!supplier) throw 'Supplier not found';
        return supplier;
    },

    async delete(id) {
        await dbConnect();
        const supplier = await Supplier.findByIdAndDelete(id);
        if (!supplier) throw 'Supplier not found';
        return { message: 'Supplier deleted' };
    }
};



