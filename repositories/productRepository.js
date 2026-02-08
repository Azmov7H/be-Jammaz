import Product from '../models/Product.js';

export const ProductRepository = {
    async findById(id, session = null) {
        if (session) {
            return await Product.findById(id).session(session);
        }
        return await Product.findById(id);
    },

    async findByCode(code) {
        return await Product.findOne({ code });
    },

    async findAll(query = {}, skip = 0, limit = 50) {
        return await Product.find(query).skip(skip).limit(limit).lean();
    },

    async count(query = {}) {
        return await Product.countDocuments(query);
    },

    async findByIds(ids, session = null) {
        const query = Product.find({ _id: { $in: ids } });
        if (session) query.session(session);
        return query.lean();
    }
};
