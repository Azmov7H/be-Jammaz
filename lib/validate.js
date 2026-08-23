import { BadRequestError, NotFoundError } from './errors.js';

function formatFieldErrors(zodError) {
    const fieldErrors = {};
    for (const issue of zodError.issues) {
        const path = issue.path.join('.') || '_root';
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return fieldErrors;
}

/**
 * Schema-validate an external input source and replace it with the parsed
 * (coerced/stripped) value.
 *   validate(schema)            → req.body
 *   validate(schema, 'query')   → req.query
 *
 * Zod failures become 400 BAD_REQUEST with a `details.fieldErrors` map.
 */
export function validate(schema, source = 'body') {
    return (req, _res, next) => {
        const parsed = schema.safeParse(req[source]);
        if (!parsed.success) {
            return next(new BadRequestError(
                'بيانات الطلب غير صالحة',
                { fieldErrors: formatFieldErrors(parsed.error) }
            ));
        }
        req[source] = parsed.data;
        next();
    };
}

/**
 * Validate route params against a schema; failures are 404 (invalid ids must
 * never surface as CastError 500s).
 */
export function validateParams(schema) {
    return (req, _res, next) => {
        const parsed = schema.safeParse(req.params);
        if (!parsed.success) {
            return next(new NotFoundError('المورد غير موجود'));
        }
        req.params = parsed.data;
        next();
    };
}
