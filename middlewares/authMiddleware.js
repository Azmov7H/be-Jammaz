import { verifyToken } from '../lib/auth.js';
import User from '../models/User.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const AUTH_DEBUG = process.env.AUTH_DEBUG === 'true' || process.env.NODE_ENV !== 'test';

function debugAuth(msg, data) {
    if (AUTH_DEBUG) {
        const ts = new Date().toISOString();
        logger.info(`[AUTH-DEBUG ${ts}] ${msg}`, data !== undefined ? JSON.stringify(data, null, 0) : '');
    }
}

export const authMiddleware = async (req, res, next) => {
    try {
        const tokenFromCookie = req.cookies.token;
        const tokenFromHeader = req.headers.authorization?.split(' ')[1];
        const token = tokenFromCookie || tokenFromHeader;

        debugAuth('TOKEN_CHECK', {
            path: req.path,
            method: req.method,
            hasCookieToken: !!tokenFromCookie,
            hasHeaderToken: !!tokenFromHeader,
            cookieKeys: Object.keys(req.cookies || {}),
            origin: req.headers.origin,
            referer: req.headers.referer,
            contentType: req.headers['content-type'],
        });

        if (!token) {
            debugAuth('FAIL_NO_TOKEN', { cookies: req.cookies });
            throw new UnauthorizedError('Unauthorized: No token provided');
        }

        const decoded = await verifyToken(token);
        if (!decoded) {
            debugAuth('FAIL_INVALID_TOKEN', { tokenPrefix: token.substring(0, 20) + '...' });
            throw new UnauthorizedError('Unauthorized: Invalid token');
        }

        debugAuth('JWT_DECODED', {
            userId: decoded.userId,
            tv: decoded.tv,
            exp: decoded.exp,
            iat: decoded.iat,
            expDate: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
            now: new Date().toISOString(),
        });

        // select('+password') is never needed here; tokenVersion is checked
        // when present in the payload so bumped versions kill old tokens.
        const user = await User.findById(decoded.userId).select('+tokenVersion');

        debugAuth('USER_LOOKUP', {
            found: !!user,
            userId: decoded.userId,
            isActive: user?.isActive,
            tokenVersion: user?.tokenVersion,
            role: user?.role,
        });

        if (!user || user.isActive === false) {
            debugAuth('FAIL_USER_INVALID', { user: user ? { isActive: user.isActive, role: user.role } : null });
            throw new UnauthorizedError('Unauthorized: Session no longer valid');
        }
        if (
            typeof decoded.tv === 'number' &&
            decoded.tv !== (user.tokenVersion ?? 0)
        ) {
            debugAuth('FAIL_TOKEN_VERSION', { decodedTv: decoded.tv, userTv: user.tokenVersion });
            throw new UnauthorizedError('Unauthorized: Session revoked');
        }

        debugAuth('AUTH_SUCCESS', { userId: user._id.toString(), role: user.role });
        req.user = user;
        next();
    } catch (error) {
        debugAuth('AUTH_ERROR', { error: error.message, name: error.name });
        next(error);
    }
};

export const roleMiddleware = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return next(
                new ForbiddenError('Forbidden: You do not have permission')
            );
        }
        next();
    };
};
