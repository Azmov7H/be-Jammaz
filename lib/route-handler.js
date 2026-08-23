import { mapError } from './errors.js';

/**
 * Standard HTTP response codes for clear communication
 */
const HTTP_STATUS = {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INTERNAL_ERROR: 500
};

/**
 * Deep sanitization to prevent NoSQL injection via malicious operators in queries
 */
const sanitizeInput = (data) => {
    if (data && typeof data === 'object') {
        Object.keys(data).forEach(key => {
            if (key.startsWith('$')) {
                delete data[key];
            } else {
                sanitizeInput(data[key]);
            }
        });
    }
    return data;
};

/**
 * Wraps an async function to handle Express routes with common logic
 */
export const routeHandler = (fn) => async (req, res, next) => {
    try {
        // Sanitize inputs as a secondary defense
        if (req.params) sanitizeInput(req.params);
        if (req.query) sanitizeInput(req.query);
        const result = await fn(req, res, next);

        // Avoid double sending
        if (res.headersSent) return;

        // Standard success response structure
        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: result || null,
            message: null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handleError(error, res);
    }
};

function handleError(err, res) {
    const { statusCode, message, data, code } = mapError(err);

    res.status(statusCode).json({
        success: false,
        message,
        code,
        details: statusCode === 400 && data ? data : undefined,
        data: null,
        timestamp: new Date().toISOString()
    });
}
