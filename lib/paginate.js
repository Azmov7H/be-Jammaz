// T-PERF-01: shared pagination + date-window bounds for all list endpoints
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

/**
 * Parse page/limit from a query object with hard caps.
 * @returns {{page:number, limit:number, skip:number}}
 */
export function parsePagination(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    let limit = parseInt(query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
    limit = Math.min(limit, MAX_LIMIT);
    return { page, limit, skip: (page - 1) * limit };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(v) {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Bound a date range: defaults missing edges to a `defaultDays` window ending
 * now, clamps the span to `maxDays`.
 * @returns {{startDate:Date, endDate:Date}}
 */
export function boundedRange(
    { startDate, endDate } = {},
    { defaultDays = 30, maxDays = 90 } = {}
) {
    const now = new Date();
    let start = toDate(startDate);
    let end = toDate(endDate) ?? now;
    if (end > now) end = now;
    if (!start) start = new Date(end.getTime() - defaultDays * DAY_MS);
    if (start > end) [start, end] = [end, start];
    const minStart = new Date(end.getTime() - maxDays * DAY_MS);
    if (start < minStart) start = minStart;
    return { startDate: start, endDate: end };
}
