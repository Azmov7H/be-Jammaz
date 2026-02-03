import User from '../models/User.js';

export const UserRepository = {
    async findByEmail(email) {
        return await User.findOne({ email });
    },

    async findById(id) {
        return await User.findById(id);
    },

    async create(userData) {
        return await User.create(userData);
    },

    async update(id, updateData) {
        return await User.findByIdAndUpdate(id, updateData, { new: true });
    }
};
