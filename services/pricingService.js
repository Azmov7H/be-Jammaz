import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import PriceHistory from '../models/PriceHistory.js';
import dbConnect from '../lib/db.js';
import { toIdString } from '../utils/idUtils.js';

/**
 * Pricing Service
 * Handles all pricing logic including customer tiers and price history
 */
export const PricingService = {
    /**
     * Get the correct price for a product based on customer
     * Returns custom price if set, otherwise tier-based price
     */
    async getPrice(productId, customerId = null) {
        await dbConnect();

        const product = await Product.findById(productId);
        if (!product) {
            throw new Error('المنتج غير موجود');
        }

        // If no customer, return retail price
        if (!customerId) {
            return product.retailPrice;
        }

        const customer = await Customer.findById(customerId);
        if (!customer) {
            return product.retailPrice;
        }

        // Check for custom pricing first
        const customPrice = customer.getPriceForProduct(productId);
        if (customPrice !== null) {
            return customPrice;
        }

        // Return tier-based price
        return product.getPrice(customer.priceType);
    },

    /**
     * Get prices for multiple products for a customer
     */
    async getPricesForCustomer(productIds, customerId = null) {
        const prices = {};

        for (const productId of productIds) {
            prices[productId] = await this.getPrice(productId, customerId);
        }

        return prices;
    },

    /**
     * Update product prices and log the change
     */
    async updateProductPrices(productId, prices, userId, reason = 'تحديث الأسعار') {
        await dbConnect();

        const product = await Product.findById(productId);
        if (!product) {
            throw new Error('المنتج غير موجود');
        }

        const changes = [];

        // Track all price changes
        if (prices.buyPrice !== undefined && prices.buyPrice !== product.buyPrice) {
            await PriceHistory.logChange({
                productId: product._id,
                productName: product.name,
                productCode: product.code,
                priceType: 'buy',
                oldPrice: product.buyPrice,
                newPrice: prices.buyPrice,
                changeReason: reason,
                changedBy: userId
            });
            product.buyPrice = prices.buyPrice;
            changes.push('buyPrice');
        }

        if (prices.retailPrice !== undefined && prices.retailPrice !== product.retailPrice) {
            await PriceHistory.logChange({
                productId: product._id,
                productName: product.name,
                productCode: product.code,
                priceType: 'retail',
                oldPrice: product.retailPrice,
                newPrice: prices.retailPrice,
                changeReason: reason,
                changedBy: userId
            });
            product.retailPrice = prices.retailPrice;
            changes.push('retailPrice');
        }

        if (prices.wholesalePrice !== undefined && prices.wholesalePrice !== product.wholesalePrice) {
            await PriceHistory.logChange({
                productId: product._id,
                productName: product.name,
                productCode: product.code,
                priceType: 'wholesale',
                oldPrice: product.wholesalePrice || 0,
                newPrice: prices.wholesalePrice,
                changeReason: reason,
                changedBy: userId
            });
            product.wholesalePrice = prices.wholesalePrice;
            changes.push('wholesalePrice');
        }

        if (prices.specialPrice !== undefined && prices.specialPrice !== product.specialPrice) {
            await PriceHistory.logChange({
                productId: product._id,
                productName: product.name,
                productCode: product.code,
                priceType: 'special',
                oldPrice: product.specialPrice || 0,
                newPrice: prices.specialPrice,
                changeReason: reason,
                changedBy: userId
            });
            product.specialPrice = prices.specialPrice;
            changes.push('specialPrice');
        }

        await product.save();

        return {
            product,
            changes
        };
    },

    /**
     * Set custom price for a specific customer-product combination
     */
    async setCustomPrice(customerId, productId, customPrice, userId) {
        await dbConnect();

        const customer = await Customer.findById(customerId);
        if (!customer) {
            throw new Error('العميل غير موجود');
        }

        const product = await Product.findById(productId);
        if (!product) {
            throw new Error('المنتج غير موجود');
        }

        // Check if custom price already exists
        const existingIndex = customer.customPricing.findIndex(
            cp => toIdString(cp.productId) === toIdString(productId)
        );

        if (existingIndex !== -1) {
            // Update existing
            customer.customPricing[existingIndex].customPrice = customPrice;
            customer.customPricing[existingIndex].setBy = userId;
            customer.customPricing[existingIndex].setAt = new Date();
        } else {
            // Add new
            customer.customPricing.push({
                productId,
                customPrice,
                setBy: userId
            });
        }

        await customer.save();

        return customer;
    },

    /**
     * Remove custom pricing for a customer-product
     */
    async removeCustomPrice(customerId, productId) {
        await dbConnect();

        const customer = await Customer.findById(customerId);
        if (!customer) {
            throw new Error('العميل غير موجود');
        }

        customer.customPricing = customer.customPricing.filter(
            cp => toIdString(cp.productId) !== toIdString(productId)
        );

        await customer.save();

        return customer;
    },

    /**
     * Get price history for a product
     */
    async getPriceHistory(productId, startDate = null, endDate = null) {
        await dbConnect();

        const query = { productId };

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        return await PriceHistory.find(query)
            .sort({ date: -1 })
            .populate('changedBy', 'name')
            .lean();
    },

    /**
     * Get all custom prices for a customer
     */
    async getCustomerPricing(customerId) {
        await dbConnect();

        const customer = await Customer.findById(customerId)
            .populate('customPricing.productId', 'name code retailPrice')
            .populate('customPricing.setBy', 'name')
            .lean();

        if (!customer) {
            throw new Error('العميل غير موجود');
        }

        return customer.customPricing || [];
    }
};



