import User from '../models/User.js';

export const UserRepository = {
    async findByEmail(email) {
        return await User.findOne({ email });
    },

    /** Only for credential verification — returns hash. Never serialize result to client. */
    async findByEmailWithPassword(email) {
        return await User.findOne({ email }).select('+password');
    },

    /** Only for credential verification — returns hash. */
    async findOwnerWithPassword() {
        return await User.findOne({ role: 'owner' }).select('+password');
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
