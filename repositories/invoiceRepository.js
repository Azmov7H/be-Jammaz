import Invoice from '../models/Invoice.js';

export const InvoiceRepository = {
    async findById(id) {
        return await Invoice.findById(id)
            .populate('customer', 'name phone address')
            .populate('createdBy', 'name')
            .populate('items.productId', 'name code')
            .lean();
    },

    async create(invoiceData, session = null) {
        const doc = new Invoice(invoiceData);
        if (session) {
            return await doc.save({ session });
        }
        return await doc.save();
    },

    async findAll({ query = {}, skip = 0, limit = 50, sort = { date: -1 } }) {
        return await Invoice.find(query)
            .populate('customer', 'name phone')
            .populate('createdBy', 'name')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean();
    },

    async count(query = {}) {
        return await Invoice.countDocuments(query);
    },

    async delete(id, session = null) {
        if (session) {
            return await Invoice.findByIdAndDelete(id).session(session);
        }
        return await Invoice.findByIdAndDelete(id);
    }
};
