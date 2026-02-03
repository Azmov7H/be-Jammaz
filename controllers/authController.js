import { AuthService } from '../services/authService.js';
import { z } from 'zod';

const loginSchema = z.object({
    email: z.string().email('البريد الإلكتروني غير صالح'),
    password: z.string().min(1, 'كلمة المرور مطلوبة')
});

export const AuthController = {
    async login(req, res) {
        const { email, password } = loginSchema.parse(req.body);
        const result = await AuthService.login({ email, password });

        res.cookie('token', result.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 1000,
            path: '/',
            sameSite: 'lax',
        });

        return result.user;
    },

    async logout(req, res) {
        res.clearCookie('token');
        return { message: 'Logged out' };
    },

    async getSession(req) {
        const token = req.cookies.token;
        return await AuthService.getSession(token);
    },

    async googleCallback(req, res) {
        const { code } = req.body;
        const result = await AuthService.handleGoogleCallback(code);

        res.cookie('token', result.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 1000,
            path: '/',
            sameSite: 'lax',
        });

        return result.user;
    }
};
