import { verifyToken } from '../lib/auth.js';
import User from '../models/User.js';

export const authMiddleware = async (req, res, next) => {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
        }

        const decoded = await verifyToken(token);
        if (!decoded) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
        }

        const user = await User.findById(decoded.userId).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error during authentication' });
    }
};

export const roleMiddleware = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Forbidden: You do not have permission' });
        }
        next();
    };
};
