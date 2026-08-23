import { ProductService } from '../services/productService.js';
import { productSchema, updateProductSchema } from '../validations/index.js';
import { AppError } from '../middlewares/errorHandler.js';



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
