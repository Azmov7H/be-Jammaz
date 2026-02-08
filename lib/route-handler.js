import { ZodError } from 'zod';

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
    let statusCode = HTTP_STATUS.INTERNAL_ERROR;
    let message = 'حدث خطأ في النظام';
    let data = null;

    // 1. Zod Validation Errors (Detailed)
    if (err instanceof ZodError) {
        statusCode = HTTP_STATUS.BAD_REQUEST;
        message = 'خطأ في التحقق من البيانات';
        // Convert ZodError items into a cleaner field-error map
        data = err.flatten().fieldErrors;
    }
    // 2. Mongoose Validation Errors
    else if (err.name === 'ValidationError') {
        statusCode = HTTP_STATUS.BAD_REQUEST;
        message = err.message;
        data = Object.keys(err.errors).reduce((acc, key) => {
            acc[key] = err.errors[key].message;
            return acc;
        }, {});
    }
    // 3. String Errors (Legacy pattern)
    else if (typeof err === 'string') {
        statusCode = err.toLowerCase().endsWith('not found') ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.BAD_REQUEST;
        message = err;
    }
    // 4. Custom AppError or known patterns
    else if (err.status || err.statusCode) {
        statusCode = err.status || err.statusCode;
        message = err.message;
    }
    // 5. Native Errors with relevant business messages
    else if (err.message && (err.message.includes('Insufficient') || err.message.includes('غير كافية'))) {
        statusCode = HTTP_STATUS.BAD_REQUEST;
        message = err.message;
    }
    else {
        // Log unexpected errors for monitoring
        console.error('[System Error]:', err);
        message = process.env.NODE_ENV === 'production' ? message : err.message;
    }

    res.status(statusCode).json({
        success: false,
        message,
        data,
        timestamp: new Date().toISOString()
    });
}
