/**
 * Standard API Response Formatters
 * Provides consistent response structure across all API endpoints
 */

export const ApiResponse = {
    /**
     * Success response with data
     * @param {*} data - The response data
     * @param {Object} meta - Optional metadata (pagination, etc.)
     */
    success(data, meta = {}) {
        return { success: true, data, ...meta };
    },

    /**
     * List response with optional pagination
     * @param {Array} items - Array of items
     * @param {Object} pagination - Pagination metadata
     */
    list(items, pagination = null) {
        const response = { success: true, data: items };
        if (pagination) response.pagination = pagination;
        return response;
    },

    /**
     * Error response
     * @param {string} message - Error message
     * @param {number} statusCode - HTTP status code
     * @param {*} details - Optional error details
     */
    error(message, statusCode = 400, details = null) {
        const response = { success: false, error: message };
        if (details) response.details = details;
        return { response, statusCode };
    },

    /**
     * Single item response
     * @param {string} itemName - Name of the item (e.g., 'product', 'customer')
     * @param {*} item - The item data
     */
    single(itemName, item) {
        return { success: true, [itemName]: item };
    }
};


