/**
 * Unified application error model.
 *
 * Every business error thrown by services/routes MUST be an instance of
 * AppError (or a subclass). The single mapper `mapError()` converts any
 * thrown value into { statusCode, message, data } for the response envelope.
 *
 * Contract:
 *   { success:false, message, code?, details?, timestamp }
 *   - message stays the Arabic user-facing text (unchanged from legacy)
 *   - status codes are now explicit instead of string-heuristic guesses
 */

import { maskSource } from './pii.js';

const ERROR_CODES = {
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    INTERNAL: 'INTERNAL_ERROR'
};

export class AppError extends Error {
    /**
     * @param {string} message user-facing message (Arabic where applicable)
     * @param {number} statusCode HTTP status code
     * @param {string} code stable machine-readable code
     * @param {*} [details] optional structured field-level info
     */
    constructor(message, statusCode, code = ERROR_CODES.INTERNAL, details = undefined) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        if (details !== undefined) this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class BadRequestError extends AppError {
    constructor(message, details) {
        super(message, 400, ERROR_CODES.BAD_REQUEST, details);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message = 'غير مصرح') {
        super(message, 401, ERROR_CODES.UNAUTHORIZED);
    }
}

export class ForbiddenError extends AppError {
    constructor(message = 'ليس لديك صلاحية للقيام بهذه العملية') {
        super(message, 403, ERROR_CODES.FORBIDDEN);
    }
}

export class NotFoundError extends AppError {
    constructor(message = 'السجل غير موجود', details) {
        super(message, 404, ERROR_CODES.NOT_FOUND, details);
    }
}

export class ConflictError extends AppError {
    constructor(message, details) {
        super(message, 409, ERROR_CODES.CONFLICT, details);
    }
}

/**
 * SEC-PII-002: deep-clone an arbitrary error/object replacing any `sourceNumber`
 * with its masked display form, so raw internal errors never leak the full
 * transfer reference to logs. Iterates nested objects/arrays (bounded depth).
 */
function maskSourceInError(value, depth = 0) {
    if (depth > 8 || value == null || typeof value !== 'object') {
        if (value && typeof value === 'object' && value.toString) return value;
        return value;
    }
    if (Array.isArray(value)) return value.map((v) => maskSourceInError(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (k === 'sourceNumber') {
            out[k] = maskSource(v);
        } else if (typeof v === 'object' && v !== null) {
            out[k] = maskSourceInError(v, depth + 1);
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Single mapper used by both pipelines (routeHandler + global errorHandler).
 * @returns {{statusCode:number, message:string, data:*}}
 */
export function mapError(err) {
    // note: returns { statusCode, message, data, code }
    // 1. Our own hierarchy — authoritative
    if (err instanceof AppError) {
        return { statusCode: err.statusCode, message: err.message, data: err.details ?? null, code: err.code };
    }

    // 2. Zod validation errors — field map
    if (err?.name === 'ZodError') {
        return {
            statusCode: 400,
            message: 'خطأ في التحقق من البيانات',
            data: err.flatten().fieldErrors,
            code: ERROR_CODES.BAD_REQUEST
        };
    }

    // 3. Mongoose schema validation
    if (err?.name === 'ValidationError' && err.errors) {
        return {
            statusCode: 400,
            message: err.message,
            data: Object.keys(err.errors).reduce((acc, key) => {
                acc[key] = err.errors[key].message;
                return acc;
            }, {}),
            code: ERROR_CODES.BAD_REQUEST
        };
    }

    // 4. Malformed ObjectId → not found
    if (err?.name === 'CastError') {
        return { statusCode: 404, message: 'السجل غير موجود', data: null, code: ERROR_CODES.NOT_FOUND };
    }

    // 5. Mongo duplicate key → conflict
    if (err?.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0];
        return {
            statusCode: 409,
            message: field ? `القيمة المستخدمة في الحقل "${field}" مستخدمة بالفعل` : 'هذه القيمة مستخدمة بالفعل',
            data: null,
            code: ERROR_CODES.CONFLICT
        };
    }

    // 6. Unknown — genericize in production.
    // Sanctioned console use: lib/errors.js is dependency-free by design
    // (logger imports would create a cycle); eslint-disable is scoped here.
    // SEC-PII-002: redact any sourceNumber inside the printed error object.
    // eslint-disable-next-line no-console
    console.error('[System Error]:', maskSourceInError(err));
    const isProduction = process.env.NODE_ENV === 'production';
    return {
        statusCode: 500,
        message: isProduction ? 'حدث خطأ في النظام' : err?.message || 'حدث خطأ في النظام',
        data: null,
        code: ERROR_CODES.INTERNAL
    };
}
