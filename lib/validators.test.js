import { expenseSchema, invoiceSchema, productSchema } from './validators.js';
import { z } from 'zod';

describe('Validators Sanity Check', () => {
    it('should have valid expense schema', () => {
        expect(expenseSchema).toBeDefined();
        const result = expenseSchema.safeParse({
            amount: 100,
            reason: 'Test Expense',
            category: 'General'
        });
        expect(result.success).toBe(true);
    });

    it('should validate invoice schema', () => {
        expect(invoiceSchema).toBeDefined();
        const invalid = invoiceSchema.safeParse({});
        expect(invalid.success).toBe(false);
    });

    it('should validate product schema', () => {
        expect(productSchema).toBeDefined();
    });
});


