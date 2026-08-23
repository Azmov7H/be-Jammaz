import { AuthService } from '../services/authService.js';
import { verifyToken } from '../lib/auth.js';
import { z } from 'zod';

const loginSchema = z.object({
    email: z.string().email('البريد الإلكتروني غير صالح'),
    password: z.string().min(1, 'كلمة المرور مطلوبة')
});

const isProd = process.env.NODE_ENV === 'production';
const baseCookie = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
};

function setAuthCookies(res, { token, refreshToken }) {
        // Access cookie stays on '/' so API reads work as before.
        res.cookie('token', token, {
            ...baseCookie,
            maxAge: 60 * 60 * 24 * 1000,
            path: '/',
        });
        // Refresh cookie is scoped to the auth endpoints only.
    res.cookie('refresh', refreshToken, {
        ...baseCookie,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
    });
}

export const AuthController = {
    async login(req, res) {
        const { email, password } = loginSchema.parse(req.body);
        const result = await AuthService.login({ email, password });

        setAuthCookies(res, result);

        return result.user;
    },

    async refresh(req, res) {
        const result = await AuthService.refresh(req.cookies.refresh);
        setAuthCookies(res, result);
        return { id: result.user._id.toString(), name: result.user.name, email: result.user.email, role: result.user.role };
    },

    async logout(req, res) {
        // Route is unauthenticated by design; recover userId from the
        // access cookie if present so revocation still happens.
        const decoded = await verifyToken(req.cookies.token);
        if (decoded?.userId) await AuthService.revokeAll(decoded.userId);
        res.clearCookie('token', { path: '/' });
        res.clearCookie('refresh', { path: '/api/auth' });
        return { message: 'Logged out' };
    },

    async getSession(req) {
        const token = req.cookies.token;
        return await AuthService.getSession(token);
    },

    async googleCallback(req, res) {
        const { code } = req.body;
        const result = await AuthService.handleGoogleCallback(code);

        setAuthCookies(res, result);
        return result.user;
    }
};
