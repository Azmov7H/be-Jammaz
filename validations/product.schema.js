import { z } from 'zod';

export const productSchema = z.object({
    name: z.string().min(3, 'Name must be at least 3 characters').trim(),
    code: z.string().min(1, 'Product code is required').trim(),
    brand: z.string().optional(),
    category: z.string().optional(),
    subsection: z.string().optional(),
    size: z.string().optional(),
    color: z.string().optional(),
    gender: z.enum(['men', 'women', 'kids', 'unisex']).default('unisex'),
    season: z.string().optional(),
    unit: z.enum(['pcs', 'kg', 'm', 'box']).default('pcs'),

    // Pricing
    buyPrice: z.coerce.number().min(0),
    retailPrice: z.coerce.number().min(0),
    minProfitMargin: z.coerce.number().min(0).max(100).default(0),

    // Inventory
    warehouseQty: z.coerce.number().min(0).default(0),
    shopQty: z.coerce.number().min(0).default(0),
    minLevel: z.coerce.number().default(5),

    images: z.array(z.string().url()).optional(),
});


