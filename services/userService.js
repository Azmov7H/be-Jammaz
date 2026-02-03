import User from '../models/User.js';
import dbConnect from '../lib/db.js';
import bcrypt from 'bcryptjs';

export const UserService = {
    async getAll() {
        await dbConnect();
        const users = await User.find({}, '-password').sort({ createdAt: -1 });
        return { users };
    },

    async getById(id) {
        await dbConnect();
        const user = await User.findById(id).select('-password');
        if (!user) {
            throw 'User not found';
        }
        return user;
    },

    async create(data) {
        await dbConnect();

        const existing = await User.findOne({ email: data.email });
        if (existing) {
            throw 'البريد الإلكتروني مستخدم بالفعل';
        }

        const hashedPassword = await bcrypt.hash(data.password, 10);
        const newUser = await User.create({
            ...data,
            password: hashedPassword
        });

        const { password, ...userWithoutPass } = newUser.toObject();
        return userWithoutPass;
    },

    async update(id, data) {
        await dbConnect();

        // Check if email is taken by another user
        if (data.email) {
            const existing = await User.findOne({ email: data.email, _id: { $ne: id } });
            if (existing) {
                throw 'البريد الإلكتروني مستخدم بالفعل';
            }
        }

        const updateData = { ...data };
        if (data.password) {
            updateData.password = await bcrypt.hash(data.password, 10);
        } else {
            delete updateData.password;
        }

        const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');
        if (!updatedUser) {
            throw 'User not found';
        }
        return updatedUser;
    },

    async delete(id) {
        await dbConnect();
        const deletedUser = await User.findByIdAndDelete(id);
        if (!deletedUser) {
            throw 'User not found';
        }
        return { message: 'Use deleted successfully' };
    }
};



