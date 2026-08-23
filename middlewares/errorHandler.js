import { mapError } from '../lib/errors.js';

// Re-export so existing imports keep working; canonical source is lib/errors.js
export { AppError } from '../lib/errors.js';

export const errorHandler = (err, req, res, next) => {
    const { statusCode, message, code } = mapError(err);

    res.status(statusCode).json({
        success: false,
        message,
        code,
        data: null,
        timestamp: new Date().toISOString()
    });
};
