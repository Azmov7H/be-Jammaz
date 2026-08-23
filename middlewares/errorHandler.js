import { mapError } from '../lib/errors.js';

// Re-export so existing imports keep working; canonical source is lib/errors.js
export { AppError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, BadRequestError } from '../lib/errors.js';

export const errorHandler = (err, req, res, next) => {
    const { statusCode, message, code, data } = mapError(err);

    res.status(statusCode).json({
        success: false,
        message,
        code,
        // Field-level info (validation) surfaces on 400s only.
        details: statusCode === 400 && data ? data : undefined,
        data: null,
        timestamp: new Date().toISOString()
    });
};
