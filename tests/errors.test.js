import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
    AppError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    mapError
} from '../lib/errors.js';

describe('AppError hierarchy', () => {
    it.each([
        [BadRequestError, 400, 'BAD_REQUEST'],
        [UnauthorizedError, 401, 'UNAUTHORIZED'],
        [ForbiddenError, 403, 'FORBIDDEN'],
        [NotFoundError, 404, 'NOT_FOUND'],
        [ConflictError, 409, 'CONFLICT']
    ])('%p maps to status/code', (Cls, status, code) => {
        const err = new Cls('رسالة');
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(status);
        expect(err.code).toBe(code);
    });

    it('preserves Arabic message and optional details', () => {
        const err = new ConflictError('رقم الهاتف مستخدم بالفعل لعميل آخر', { field: 'phone' });
        expect(err.message).toBe('رقم الهاتف مستخدم بالفعل لعميل آخر');
        expect(err.details).toEqual({ field: 'phone' });
    });
});

describe('mapError', () => {
    it('maps AppError subclasses to their status/message/details', () => {
        const m = mapError(new NotFoundError('المنتج غير موجود'));
        expect(m.statusCode).toBe(404);
        expect(m.message).toBe('المنتج غير موجود');
        expect(m.code).toBe('NOT_FOUND');
    });

    it('maps ZodError to 400 with fieldErrors in data', () => {
        const zerr = new ZodError([{ path: ['email'], message: 'required', code: 'invalid_type' }]);
        const m = mapError(zerr);
        expect(m.statusCode).toBe(400);
        expect(m.data.email).toBeDefined();
        expect(m.code).toBe('BAD_REQUEST');
    });

    it('maps Mongoose ValidationError to 400 with per-field messages', () => {
        const m = mapError({
            name: 'ValidationError',
            message: 'validation failed',
            errors: { name: { message: 'Path `name` is required.' } }
        });
        expect(m.statusCode).toBe(400);
        expect(m.data.name).toMatch(/required/);
    });

    it('maps CastError to 404', () => {
        const m = mapError({ name: 'CastError', message: 'bad oid' });
        expect(m.statusCode).toBe(404);
        expect(m.code).toBe('NOT_FOUND');
    });

    it('maps E11000 duplicate key to 409', () => {
        const m = mapError({ code: 11000, keyValue: { phone: '123' }, message: 'dup' });
        expect(m.statusCode).toBe(409);
        expect(m.code).toBe('CONFLICT');
        expect(m.message).toContain('phone');
    });

    it('genericizes unknown errors in production', () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const m = mapError(new Error('secret internals'));
        process.env.NODE_ENV = prev;
        expect(m.statusCode).toBe(500);
        expect(m.message).toBe('حدث خطأ في النظام');
    });

    it('exposes unknown error message outside production', () => {
        const prev = process.env.NODE_ENV;
        delete process.env.NODE_ENV;
        const m = mapError(new Error('dev detail'));
        process.env.NODE_ENV = prev;
        expect(m.statusCode).toBe(500);
        expect(m.message).toBe('dev detail');
    });
});
