import User from '../models/User.js';
import { parsePagination } from '../lib/paginate.js';
import dbConnect from '../lib/db.js';
import bcrypt from 'bcryptjs';
import { NotFoundError, ConflictError, ForbiddenError } from '../lib/errors.js';

// T-ACL-01: explicit field allowlist — mass assignment of arbitrary
// schema fields (e.g. tokenVersion) via body spread is not possible.
const ALLOWED_FIELDS = ['name', 'email', 'password', 'role', 'picture', 'isActive'];

function pickAllowed(data) {
    const out = {};
    for (const key of ALLOWED_FIELDS) {
        if (data[key] !== undefined) out[key] = data[key];
    }
    return out;
}

export const UserService = {
    async getAll(query = {}) {
        await dbConnect();
        const { page, limit, skip } = parsePagination(query);
        const [users, total] = await Promise.all([
            User.find({}, '-password -tokenVersion')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments({})
        ]);
        return { users, total, page, limit };
    },

    async getById(id) {
        await dbConnect();
        const user = await User.findById(id).select('-password -tokenVersion');
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
        if (!data.password) {
            throw new ForbiddenError('كلمة المرور مطلوبة');
        }

        const hashedPassword = await bcrypt.hash(data.password, 10);
        const newUser = await User.create({
            ...pickAllowed(data),
            password: hashedPassword
        });

        const { password, tokenVersion, ...safeUser } = newUser.toObject();
        return safeUser;
    },

    async update(id, data, actor) {
        await dbConnect();
        const target = await User.findById(id).select('+tokenVersion');
        if (!target) throw new NotFoundError('User not found');

        // Nobody edits their own role (self-promotion/demotion path).
        if (actor && String(actor._id) === id && data.role && data.role !== target.role) {
            throw new ForbiddenError('لا يمكنك تعديل صلاحيات حسابك الخاص');
        }

        // Defense in depth: only owner may grant the owner role, regardless
        // of what a future route gate allows.
        if (data.role === 'owner' && actor?.role !== 'owner') {
            throw new ForbiddenError('تعيين دور المالك يتطلب صلاحية المالك');
        }

        const updateData = pickAllowed(data);
        if (updateData.password !== undefined) {
            if (updateData.password === null || updateData.password === '') {
                delete updateData.password;
            } else {
                updateData.password = await bcrypt.hash(updateData.password, 10);
            }
        }
        if (updateData.email) {
            const existing = await User.findOne({ email: updateData.email, _id: { $ne: id } });
            if (existing) throw new ConflictError('البريد الإلكتروني مستخدم بالفعل');
        }

        // Last-owner guard on deactivation.
        if (updateData.isActive === false && target.role === 'owner' && target.isActive !== false) {
            await assertNotLastOwner(id);
        }

        // Invalidate existing sessions when privileges or status change.
        if (
            (updateData.role && updateData.role !== target.role) ||
            updateData.isActive === false ||
            updateData.password
        ) {
            updateData.tokenVersion = (target.tokenVersion ?? 0) + 1;
        }

        const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true })
            .select('-password -tokenVersion');
        return updatedUser;
    },

    async delete(id, actor) {
        await dbConnect();

        if (actor && String(actor._id) === id) {
            throw new ConflictError('لا يمكنك حذف حسابك الخاص');
        }

        const target = await User.findById(id);
        if (!target) throw new NotFoundError('User not found');

        if (target.role === 'owner') {
            await assertNotLastOwner(id);
        }

        await User.findByIdAndDelete(id);
        return { message: 'User deleted successfully' };
    }
};

async function assertNotLastOwner(excludeId) {
    const activeOwners = await User.countDocuments({
        role: 'owner',
        isActive: { $ne: false },
        _id: { $ne: excludeId }
    });
    if (activeOwners === 0) {
        throw new ConflictError('لا يمكن إزالة آخر مالك نشط في النظام');
    }
}
