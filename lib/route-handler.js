import { ZodError } from 'zod';

/**
 * Wraps an async function to handle Express routes with common logic
 */
export const routeHandler = (handler) => {
    return async (req, res, next) => {
        try {
            const result = await handler(req, res, next);

            // If response already sent (e.g. file download), don't do anything
            if (res.headersSent) return;

            // Standard success response
            res.status(200).json({
                success: true,
                data: result,
                message: null
            });
        } catch (error) {
            console.error('Route Error:', error);
            handleError(error, res);
        }
    };
};

function handleError(err, res) {
    if (typeof err === 'string') {
        const is404 = err.toLowerCase().endsWith('not found');
        return res.status(is404 ? 404 : 400).json({
            success: false,
            message: err,
            data: null
        });
    }

    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            message: 'Validation Error',
            data: err.flatten().fieldErrors
        });
    }

    // Mongoose errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: err.message,
            data: err.errors
        });
    }

    if (err.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: 'Invalid ID format',
            data: null
        });
    }

    // Business Logic Errors
    if (err.message && (err.message.includes('Insufficient') || err.message.includes('غير كافية'))) {
        return res.status(400).json({
            success: false,
            message: err.message,
            data: null
        });
    }

    // Default Error
    res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        data: null
    });
}
