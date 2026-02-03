import Debt from '../models/Debt.js';

export const DebtRepository = {
    async findById(id, session = null) {
        if (session) {
            return await Debt.findById(id).session(session);
        }
        return await Debt.findById(id);
    },

    async findOne(query, session = null) {
        if (session) {
            return await Debt.findOne(query).session(session);
        }
        return await Debt.findOne(query);
    },

    async create(data, session = null) {
        const doc = new Debt(data);
        if (session) {
            return await doc.save({ session });
        }
        return await doc.save();
    },

    async findAll(query = {}, skip = 0, limit = 50, sort = { dueDate: 1 }) {
        return await Debt.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .populate('debtorId', 'name phone balance')
            .lean();
    },

    async count(query = {}) {
        return await Debt.countDocuments(query);
    },

    async delete(id, session = null) {
        if (session) {
            return await Debt.findByIdAndDelete(id).session(session);
        }
        return await Debt.findByIdAndDelete(id);
    },

    // Aggregate methods can stay in Service or move here if generic
    async aggregate(pipeline) {
        return await Debt.aggregate(pipeline);
    }
};
