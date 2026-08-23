import User from '../models/User.js';
import dbConnect from '../lib/db.js';
import bcrypt from 'bcryptjs';
import { NotFoundError, ConflictError } from '../lib/errors.js';

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
            throw new NotFoundError('User not found');
        }
        return user;
    },

    async create(data) {
        await dbConnect();

        const existing = await User.findOne({ email: data.email });
        if (existing) {
            throw new ConflictError('البريد الإلكتروني مستخدم بالفعل');
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
                throw new ConflictError('البريد الإلكتروني مستخدم بالفعل');
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
            throw new NotFoundError('User not found');
        }
        return updatedUser;
    },

    async delete(id) {
        await dbConnect();
        const deletedUser = await User.findByIdAndDelete(id);
        if (!deletedUser) {
            throw new NotFoundError('User not found');
        }
        return { message: 'Use deleted successfully' };
    }
};



