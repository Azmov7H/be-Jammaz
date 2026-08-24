import { describe, it, expect } from 'vitest';
import { parsePagination, boundedRange, MAX_LIMIT } from '../lib/paginate.js';

describe('T-PERF-01: parsePagination', () => {
    it('defaults to page 1, limit 20', () => {
        expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
    });

    it('computes skip from page', () => {
        expect(parsePagination({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, skip: 20 });
    });

    it('caps limit at MAX_LIMIT', () => {
        const r = parsePagination({ limit: '999999' });
        expect(r.limit).toBe(MAX_LIMIT);
    });

    it('floors invalid/negative input to defaults', () => {
        expect(parsePagination({ page: '-2', limit: 'abc' })).toEqual({ page: 1, limit: 20, skip: 0 });
        expect(parsePagination({ limit: '-5' }).limit).toBe(20);
    });
});

describe('T-PERF-01: boundedRange', () => {
    it('defaults to a 30d window ending now when no dates given', () => {
        const { startDate, endDate } = boundedRange({}, { defaultDays: 30 });
        const spanDays = (endDate - startDate) / 86400000;
        expect(spanDays).toBeGreaterThanOrEqual(29.9);
        expect(spanDays).toBeLessThan(30.1);
    });

    it('clamps oversized windows to maxDays', () => {
        const start = new Date('2026-01-01');
        const end = new Date('2026-08-01'); // ~212 days
        const r = boundedRange({ startDate: start, endDate: end }, { defaultDays: 30, maxDays: 90 });
        const spanDays = (r.endDate - r.startDate) / 86400000;
        expect(spanDays).toBeLessThanOrEqual(90.1);
    });

    it('keeps a valid in-range window intact', () => {
        const start = new Date('2026-08-10T00:00:00Z');
        const end = new Date('2026-08-15T00:00:00Z');
        const r = boundedRange({ startDate: start, endDate: end }, {});
        expect(r.startDate.getTime()).toBe(start.getTime());
        expect(r.endDate.getTime()).toBe(end.getTime());
    });

    it('swaps inverted ranges and rejects garbage dates', () => {
        const r = boundedRange(
            { startDate: 'not-a-date', endDate: '2026-08-20T00:00:00Z' },
            {}
        );
        expect(Number.isNaN(r.startDate.getTime())).toBe(false);
    });
});
