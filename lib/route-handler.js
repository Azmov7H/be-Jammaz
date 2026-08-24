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
 * Deep sanitization to prevent NoSQL injection via malicious operators.
 * Strips $-prefixed and dotted keys at any depth (dotted keys can bypass
 * top-level filters and become nested paths in Mongo updates).
 * mongoSanitize-style query handling remains the primary defense; this is
 * defense-in-depth applied pre-validation.
 */
const sanitizeInput = (data) => {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        Object.keys(data).forEach(key => {
            if (key.startsWith('$') || key.includes('.')) {
                delete data[key];
            } else {
                sanitizeInput(data[key]);
            }
        });
    } else if (Array.isArray(data)) {
        data.forEach(sanitizeInput);
    }
    return data;
};

/**
 * Wraps an async function to handle Express routes with common logic
 */
export const routeHandler = (fn) => async (req, res, next) => {
    try {
        // Sanitize all external inputs as a secondary defense.
        // Mutating req.body here is safe: it runs before any validation/read.
        if (req.params) sanitizeInput(req.params);
        if (req.query) sanitizeInput(req.query);
        if (req.body) sanitizeInput(req.body);
        const result = await fn(req, res, next);

        // Avoid double sending
        if (res.headersSent) return;

        // Standard success response structure.
        // ?? keeps legitimate falsy results (0, false, '') — only
        // undefined collapses to null.
        res.status(HTTP_STATUS.OK).json({
            success: true,
            data: result ?? null,
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
