import { signToken, verifyToken } from '../lib/auth.js';
import { UserRepository } from '../repositories/userRepository.js';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../middlewares/errorHandler.js';

const googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/google/callback`
);

export const AuthService = {
    /**
     * Authenticate user with email and password
     */
    async login({ email, password }) {
        const user = await UserRepository.findByEmail(email);

        if (!user || user.isActive === false) {
            if (user?.isActive === false) throw new AppError('تم تعطيل هذا الحساب. يرجى الاتصال بالمسؤول.', 403);
            throw new AppError('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            throw new AppError('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
        }

        const token = await signToken({
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
        });

        return {
            token,
            user: {
                id: user._id.toString(),
                name: user.name,
                email: user.email,
                role: user.role,
                picture: user.picture
            }
        };
    },

    /**
     * Handle Google OAuth Callback
     */
    async handleGoogleCallback(code) {
        const { tokens } = await googleClient.getToken(code);
        googleClient.setCredentials(tokens);

        const userInfoResponse = await googleClient.request({
            url: 'https://www.googleapis.com/oauth2/v3/userinfo',
        });

        const userInfo = userInfoResponse.data;

        let user = await UserRepository.findByEmail(userInfo.email);

        if (!user) {
            user = await UserRepository.create({
                name: userInfo.name,
                email: userInfo.email,
                picture: userInfo.picture,
                role: 'cashier',
            });
        } else {
            user = await UserRepository.update(user._id, { picture: userInfo.picture });
        }

        const token = await signToken({
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
        });

        return { token, user };
    },

    /**
     * Get current user session
     */
    async getSession(token) {
        if (!token) return null;

        const decoded = await verifyToken(token);
        if (!decoded) return null;

        const user = await UserRepository.findById(decoded.userId);
        if (!user) return null;

        return {
            ...user.toObject(),
            id: user._id.toString()
        };
    }
};




