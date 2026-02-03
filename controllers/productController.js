import { ProductService } from '../services/productService.js';
import { z } from 'zod';
import { AppError } from '../middlewares/errorHandler.js';

const productSchema = z.object({
    name: z.string().min(1, 'اسم المنتج مطلوب'),
    code: z.string().min(1, 'كود المنتج مطلوب'),
    buyPrice: z.coerce.number().min(0).default(0),
    retailPrice: z.coerce.number().min(0).default(0),
    wholesalePrice: z.coerce.number().min(0).optional(),
    specialPrice: z.coerce.number().min(0).optional(),
    category: z.string().optional(),
    brand: z.string().optional(),
    subsection: z.string().optional(),
    size: z.string().optional(),
    color: z.string().optional(),
    gender: z.enum(['men', 'women', 'unisex', 'kids', 'none']).default('none'),
    season: z.string().optional(),
    minLevel: z.coerce.number().default(5),
    warehouseQty: z.coerce.number().default(0),
    shopQty: z.coerce.number().default(0),
    unit: z.string().default('piece'),
    isActive: z.boolean().default(true),
    images: z.array(z.string()).optional()
});

const updateProductSchema = productSchema.partial();

export const ProductController = {
    async getAll(req) {
        return await ProductService.getAll(req.query);
    },

    async getById(req) {
        const product = await ProductService.getById(req.params.id);
        if (!product) throw new AppError('Product not found', 404);
        return product;
    },

    async create(req) {
        const data = productSchema.parse(req.body);
        return await ProductService.create(data, req.user._id);
    },

    async update(req) {
        const data = updateProductSchema.parse(req.body);
        return await ProductService.update(req.params.id, data, req.user._id);
    },

    async delete(req) {
        await ProductService.delete(req.params.id);
        return { message: 'تم تعطيل المنتج بنجاح' };
    },

    async getMetadata(req) {
        return await ProductService.getMetadata();
    }
};
