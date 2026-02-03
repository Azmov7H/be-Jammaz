import { ProductRepository } from '../repositories/productRepository.js';
import Product from '../models/Product.js'; // Import Model for write operations until Repository is fully enhanced
import { StockService } from '../services/stockService.js';
import dbConnect from '../lib/db.js';
import { AppError } from '../middlewares/errorHandler.js';

export const ProductService = {
    async getAll({ page = 1, limit = 10, search, category, brand, outOfStock }) {
        await dbConnect();

        const query = { isActive: true };
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { code: { $regex: search, $options: 'i' } }
            ];
        }
        if (category && category !== 'all') query.category = category;
        if (brand && brand !== 'all') query.brand = brand;
        if (outOfStock === 'true') query.stockQty = { $lte: 0 };

        const skip = (Number(page) - 1) * Number(limit);
        const [products, total] = await Promise.all([
            ProductRepository.findAll(query, skip, Number(limit)),
            ProductRepository.count(query)
        ]);

        return {
            products,
            pagination: {
                total,
                pages: Math.ceil(total / Number(limit)),
                page: Number(page),
                limit: Number(limit)
            }
        };
    },

    async getById(id) {
        await dbConnect();
        const product = await ProductRepository.findById(id);
        if (!product) throw new AppError('Product not found', 404);
        return product;
    },

    async create(data, userId) {
        await dbConnect();
        const existing = await Product.findOne({ code: data.code });
        if (existing) throw new AppError('كود المنتج موجود مسبقاً', 409);

        const product = await Product.create({
            ...data,
            createdBy: userId
        });

        // Register initial stock if provided
        if ((Number(data.warehouseQty) || 0) + (Number(data.shopQty) || 0) > 0) {
            await StockService.registerInitialBalance(
                product._id,
                Number(data.warehouseQty) || 0,
                Number(data.shopQty) || 0,
                Number(data.buyPrice) || 0,
                userId
            );
        }

        return product;
    },

    async update(id, data, userId) {
        await dbConnect();
        if (data.code) {
            const existing = await Product.findOne({ code: data.code, _id: { $ne: id } });
            if (existing) throw new AppError('كود المنتج موجود بالفعل لمنتج آخر', 409);
        }

        const product = await Product.findByIdAndUpdate(id, data, { new: true });
        if (!product) throw new AppError('Product not found', 404);

        return product;
    },

    async delete(id) {
        await dbConnect();
        const product = await Product.findById(id);
        if (!product) throw new AppError('Product not found', 404);

        product.isActive = false;
        await product.save();

        return { message: 'Product deactivated' };
    },

    async getMetadata() {
        await dbConnect();
        const [brands, categories] = await Promise.all([
            Product.distinct('brand', { isActive: true }),
            Product.distinct('category', { isActive: true })
        ]);

        return {
            brands: brands.filter(Boolean).map(b => ({ label: b, value: b })),
            categories: categories.filter(Boolean).map(c => ({ label: c, value: c }))
        };
    }
};
