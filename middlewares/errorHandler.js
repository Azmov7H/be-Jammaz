export const errorHandler = (err, req, res, next) => {
    console.error('❌ Error:', err);

    const statusCode = err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';

    // In production, genericize server errors to prevent info leakage
    const message = (isProduction && statusCode === 500)
        ? 'حدث خطأ في النظام، يرجى المحاولة لاحقاً'
        : err.message || 'Internal Server Error';

    res.status(statusCode).json({
        success: false,
        error: message,
        stack: isProduction ? undefined : err.stack
    });
};

export class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        Error.captureStackTrace(this, this.constructor);
    }
}
