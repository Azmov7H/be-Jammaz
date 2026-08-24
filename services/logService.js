import Log from '../models/Log.js';
import { parsePagination } from '../lib/paginate.js';
import dbConnect from '../lib/db.js';

/**
 * Log Service
 * Handles centralized logging for all system actions
 */
export const LogService = {
    /**
     * Create a new log entry
     * @param {string} userId - User performing the action
     * @param {string} action - Action name (e.g., 'CREATE_INVOICE', 'UPDATE_STOCK')
     * @param {string} entity - Entity modified (e.g., 'Invoice', 'Product')
     * @param {string} entityId - ID of the entity
     * @param {object} diff - Details of the change (optional)
     * @param {string} note - Human readable note (optional)
     */
    async logAction({ userId, action, entity, entityId, diff, note }, session = null) {
        try {
            await dbConnect();

            await Log.create([{
                userId,
                action,
                entity,
                entityId,
                diff,
                note,
                date: new Date()
            }], { session });
        } catch (error) {
            // Non-blocking error logging
            console.error('Failed to create system log:', error);
        }
    },

    /**
     * Get all logs with pagination
     * @param {object} query - Query parameters
     * @param {number} query.limit - Number of logs per page
     * @param {number} query.page - Page number
     */
    async getAll(query = {}) {
        await dbConnect();
        const { page, limit, skip } = parsePagination(query);

        return await Log.find({})
            .populate('userId', 'name')
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
    },

    /**
     * Get logs for an entity
     */
    async getEntityLogs(entity, entityId, query = {}) {
        const { limit, skip } = parsePagination(query);
        await dbConnect();
        return await Log.find({ entity, entityId })
            .populate('userId', 'name')
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
    },

    /**
     * Get recent logs (system wide)
     */
    async getRecentLogs(query = {}) {
        await dbConnect();
        const { limit } = parsePagination(query);
        return await Log.find({})
            .populate('userId', 'name')
            .sort({ date: -1 })
            .limit(limit)
            .lean();
    }
};



