import Customer from '../models/Customer.js';

export const CustomerRepository = {
    async findById(id, session = null) {
        if (session) {
            return await Customer.findById(id).session(session);
        }
        return await Customer.findById(id);
    },

    async findAll(query = {}, skip = 0, limit = 50) {
        return await Customer.find(query).skip(skip).limit(limit).lean();
    },

    async count(query = {}) {
        return await Customer.countDocuments(query);
    }
};
