import { verifyToken } from '../lib/auth.js';
import User from '../models/User.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

export const authMiddleware = async (req, res, next) => {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
        if (!token) {
            throw new UnauthorizedError('Unauthorized: No token provided');
        }

        const decoded = await verifyToken(token);
        if (!decoded) {
            throw new UnauthorizedError('Unauthorized: Invalid token');
        }

        // select('+password') is never needed here; tokenVersion is checked
        // when present in the payload so bumped versions kill old tokens.
        const user = await User.findById(decoded.userId).select('+tokenVersion');
        if (!user || user.isActive === false) {
            throw new UnauthorizedError('Unauthorized: Session no longer valid');
        }
        if (
            typeof decoded.tv === 'number' &&
            decoded.tv !== (user.tokenVersion ?? 0)
        ) {
            throw new UnauthorizedError('Unauthorized: Session revoked');
        }

        req.user = user;
        next();
    } catch (error) {
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
