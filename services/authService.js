import { signToken, verifyToken } from '../lib/auth.js';
import { UserRepository } from '../repositories/userRepository.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import RefreshToken from '../models/RefreshToken.js';
import User from '../models/User.js';
import { OAuth2Client } from 'google-auth-library';
import { AppError, UnauthorizedError } from '../middlewares/errorHandler.js';

const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function logSecurityEvent(event, details) {
    // Structured line; wired into the log pipeline in Sprint 10.
    console.log(JSON.stringify({ event, at: new Date().toISOString(), ...details }));
}

export const AuthService = {
    /**
     * Issue an access+refresh pair (T-AUTH-02). Refresh stored hashed.
     */
    async issueTokenPair(user) {
        const token = await signToken({
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
            tv: user.tokenVersion ?? 0,
        });

        const raw = crypto.randomBytes(32).toString('hex');
        const familyId = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
        await RefreshToken.create({
            userId: user._id,
            hash: sha256(raw),
            familyId,
            expiresAt,
        });

        return { token, refreshToken: raw };
    },

    /**
     * Rotate a refresh token. Reuse of a rotated token revokes the family.
     */
    async refresh(rawRefreshToken) {
        if (!rawRefreshToken) throw new UnauthorizedError('Refresh token مطلوب');
        const hash = sha256(rawRefreshToken);

        const stored = await RefreshToken.findOne({ hash });
        if (!stored || stored.expiresAt < new Date()) {
            throw new UnauthorizedError('جلسة منتهية، يرجى تسجيل الدخول');
        }

        if (stored.revokedAt) {
            // Replay of an already-rotated token → assume theft, kill family.
            await RefreshToken.updateMany(
                { familyId: stored.familyId, revokedAt: { $exists: false } },
                { revokedAt: new Date() }
            );
            logSecurityEvent('auth.refresh.reuse_detected', {
                userId: stored.userId.toString(),
                familyId: stored.familyId,
            });
            throw new UnauthorizedError('تم إلغاء الجلسة لأسباب أمنية، يرجى تسجيل الدخول');
        }

        const user = await User.findById(stored.userId);
        if (!user || user.isActive === false) {
            throw new UnauthorizedError('الحساب غير متاح، يرجى تسجيل الدخول');
        }

        // Rotate
        const raw = crypto.randomBytes(32).toString('hex');
        stored.revokedAt = new Date();
        stored.replacedByHash = sha256(raw);
        await stored.save();
        const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
        await RefreshToken.create({
            userId: user._id,
            hash: sha256(raw),
            familyId: stored.familyId,
            expiresAt,
        });

        const token = await signToken({
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
            tv: user.tokenVersion ?? 0,
        });

        return { token, refreshToken: raw, user };
    },

    /**
     * Revoke all active refresh tokens for a user (logout / compromise).
     */
    async revokeAll(userId) {
        await RefreshToken.updateMany(
            { userId, revokedAt: { $exists: false } },
            { revokedAt: new Date() }
        );
    },

    /**
     * Authenticate user with email and password
     */
    async login({ email, password }) {
        const user = await UserRepository.findByEmailWithPassword(email);

        // Anti-enumeration (AUTH-004): disabled and unknown accounts are
        // indistinguishable from bad credentials.
        if (!user || user.isActive === false) {
            logSecurityEvent('auth.login.failed', { reason: user ? 'disabled' : 'unknown_email' });
            throw new AppError('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            logSecurityEvent('auth.login.failed', { userId: user._id.toString(), reason: 'bad_password' });
            throw new AppError('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
        }

        const pair = await this.issueTokenPair(user);
        logSecurityEvent('auth.login.success', { userId: user._id.toString() });

        return {
            ...pair,
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
     * Handle Google OAuth Callback (T-AUTH-03)
     */
    async handleGoogleCallback(code) {
        if (!code || typeof code !== 'string' || code.length > 2048) {
            throw new AppError('رمز التحقق من Google غير صالح', 400);
        }

        // Per-exchange client: never mutate shared client credentials.
        const client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/google/callback`
        );
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        const userInfoResponse = await client.request({
            url: 'https://www.googleapis.com/oauth2/v3/userinfo',
        });

        const userInfo = userInfoResponse.data;

        let user = await UserRepository.findByEmail(userInfo.email);

        if (!user) {
            const autoProvision = process.env.OAUTH_AUTO_PROVISION === 'true';
            if (!autoProvision) {
                logSecurityEvent('auth.oauth.unprovisioned_login', { email: userInfo.email });
                throw new AppError('لا يوجد حساب مرتبط بهذا البريد الإلكتروني. يرجى الاتصال بالمسؤول.', 403);
            }
            user = await UserRepository.create({
                name: userInfo.name,
                email: userInfo.email,
                picture: userInfo.picture,
                role: 'cashier',
            });
        } else {
            user = await UserRepository.update(user._id, { picture: userInfo.picture });
        }

        if (user.isActive === false) {
            throw new AppError('تم تعطيل هذا الحساب. يرجى الاتصال بالمسؤول.', 403);
        }

        const pair = await this.issueTokenPair(user);
        return { ...pair, user };
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
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            picture: user.picture,
            isActive: user.isActive
        };
    }
};




