import Notification from '../models/Notification.js';
import Product from '../models/Product.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import InvoiceSettings from '../models/InvoiceSettings.js';
import SystemMeta from '../models/SystemMeta.js';
import User from '../models/User.js';
import dbConnect from '../lib/db.js';

export class NotificationService {
    /**
     * Centralized Notification Creation
     * Handles deduplication, broadcasting (future), and persistence.
     */
    static async create({
        title,
        message,
        type = 'system',
        severity = 'info',
        source = 'System',
        recipientId = null,
        targetRole = null,
        isGlobal = false,
        link = null,
        metadata = {},
        deduplicationKey = null,
        deduplicationTimeWindow = 24 * 60 * 60 * 1000,
        // Legacy/Scanner fields mapping
        category = null,
        actionType = null,
        actionParams = {}
    }) {
        await dbConnect();

        // Map legacy fields to metadata if present
        if (category) metadata.category = category;
        if (actionType) metadata.actionType = actionType;
        if (Object.keys(actionParams).length > 0) metadata.actionParams = actionParams;

        // 1. Deduplication Check
        if (deduplicationKey) {
            const timeWindow = new Date(Date.now() - deduplicationTimeWindow);

            const query = {
                title,
                createdAt: { $gte: timeWindow }
            };

            if (recipientId) query.recipientId = recipientId;
            if (targetRole) query.targetRole = targetRole;
            if (isGlobal) query.isGlobal = true;

            const exists = await Notification.findOne(query);
            if (exists) {
                return null;
            }
        }

        // 2. Create Notification
        const notification = await Notification.create({
            title,
            message,
            type,
            severity,
            source,
            recipientId,
            targetRole,
            isGlobal,
            link,
            metadata,
            isRead: false
        });

        return notification;
    }

    /**
     * Get notifications for a specific user
     * Supports pagination and filtering
     */
    static async getUserNotifications(userId, {
        limit = 20,
        page = 1,
        unreadOnly = false,
        type = null
    } = {}) {
        await dbConnect();
        const user = await User.findById(userId).select('role');
        const role = user?.role;

        const query = role === 'owner' ? {} : {
            $or: [
                { recipientId: userId },
                { isGlobal: true },
                { targetRole: role }
            ]
        };

        if (unreadOnly) {
            query.isRead = false;
        }

        if (type) {
            query.type = type;
        }

        const skip = (page - 1) * limit;

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Notification.countDocuments(query),
            Notification.countDocuments({ ...query, isRead: false })
        ]);

        return {
            notifications,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            },
            unreadCount
        };
    }

    /**
     * Mark notifications as read
     */
    static async markRead(userId, ids, markAll = false) {
        await dbConnect();

        if (markAll) {
            const user = await User.findById(userId).select('role');
            const role = user?.role;
            const query = { isRead: false };
            if (role !== 'owner') {
                query.$or = [
                    { recipientId: userId },
                    { isGlobal: true },
                    { targetRole: role }
                ];
            }
            await Notification.updateMany(query, { isRead: true });
        } else if (Array.isArray(ids) && ids.length > 0) {
            await Notification.updateMany(
                { _id: { $in: ids } },
                { isRead: true }
            );
        }

        return { success: true };
    }

    /**
     * Delete specific notification
     */
    static async delete(userId, id) {
        await dbConnect();
        const user = await User.findById(userId).select('role');
        const role = user?.role;

        const query = { _id: id };
        if (role !== 'owner') {
            query.recipientId = userId;
        }

        const notification = await Notification.findOneAndDelete(query);
        if (!notification) throw 'Notification not found';
        return { success: true };
    }

    /**
     * Delete all notifications for user
     */
    static async deleteAll(userId) {
        await dbConnect();
        const user = await User.findById(userId).select('role');
        const role = user?.role;

        const query = role === 'owner' ? {} : { recipientId: userId };
        await Notification.deleteMany(query);
        return { success: true };
    }

    /**
     * Helper: Normalize string
     */
    static normalize(str) {
        return str?.trim().replace(/\s+/g, ' ') || '';
    }

    /**
     * Legacy Scanner: Stock Alerts (Refactored)
     */
    static async syncStockAlerts(settings) {
        const threshold = settings.stockAlertThreshold || 5;

        const products = await Product.find({
            isActive: true,
            $or: [
                { shopQty: { $lte: threshold } },
                { warehouseQty: { $lte: threshold } }
            ]
        });

        for (const product of products) {
            if (product.shopQty <= (product.minLevel || threshold)) {
                await this.create({
                    title: `نقص في المحل: ${product.name}`,
                    message: `الكمية الحالية في المحل (${product.shopQty}) وصلت للحد الأدنى.`,
                    type: 'business',
                    severity: 'warning',
                    source: 'InventoryService',
                    targetRole: 'warehouse',
                    link: `/products/${product._id}`,
                    deduplicationKey: `shop_low_${product._id}`,
                    metadata: { productId: product._id, location: 'shop' }
                });
            }

            if (product.warehouseQty <= (product.minLevel || threshold)) {
                await this.create({
                    title: `نقص في المخزن: ${product.name}`,
                    message: `الكمية الحالية في المخزن (${product.warehouseQty}) وصلت للحد الأدنى.`,
                    type: 'business',
                    severity: 'warning',
                    source: 'InventoryService',
                    targetRole: 'manager',
                    link: `/products/${product._id}`,
                    deduplicationKey: `wh_low_${product._id}`,
                    metadata: { productId: product._id, location: 'warehouse' }
                });
            }
        }
    }

    /**
     * Legacy Scanner: Supplier Alerts (Refactored)
     */
    static async syncSupplierAlerts(settings) {
        const days = settings.supplierPaymentAlertDays || 3;
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + days);

        const pendingPOs = await PurchaseOrder.find({
            status: 'PENDING',
            expectedDate: { $lte: targetDate, $gte: new Date() }
        }).populate('supplier', 'name financialTrackingEnabled');

        for (const po of pendingPOs) {
            if (!po.supplier?.financialTrackingEnabled) continue;

            await this.create({
                title: `مستحق للمورد: ${po.supplier.name}`,
                message: `طلب الشراء #${po.poNumber} بقيمة ${po.totalCost.toLocaleString()} ج.م يستحق خلال ${days} أيام.`,
                type: 'business',
                severity: 'info',
                source: 'PurchaseService',
                targetRole: 'manager',
                link: `/purchase-orders/${po._id}`,
                deduplicationKey: `po_due_${po._id}`,
                metadata: { poId: po._id, action: 'PAY_SUPPLIER' }
            });
        }
    }

    /**
     * Legacy Scanner: Debt & Reminders (Refactored)
     */
    static async syncDebtReminders(userId = null, settings = null) {
        if (!settings) settings = await InvoiceSettings.getSettings();
        const minAmount = settings.minDebtNotificationAmount || 10;
        const now = new Date();

        // 1. Overdue Invoices
        const overdueInvoices = await Invoice.find({
            paymentStatus: { $in: ['pending', 'partial'] },
            paymentType: 'credit',
            dueDate: { $lt: now },
            total: { $gte: minAmount }
        }).populate('customer', 'name');

        for (const inv of overdueInvoices) {
            const balance = inv.total - inv.paidAmount;

            await this.create({
                title: `متأخرات سداد: ${inv.customer.name}`,
                message: `الفاتورة #${inv.number} متأخرة بمبلغ ${balance.toLocaleString()} ج.م.`,
                type: 'business',
                severity: 'critical',
                source: 'FinanceService',
                targetRole: 'manager',
                link: `/invoices/${inv._id}`,
                deduplicationKey: `inv_overdue_${inv._id}`,
                metadata: { invoiceId: inv._id, balance, action: 'COLLECT_DEBT', category: 'FINANCIAL' }
            });
        }

        // 2. Upcoming Collections (Control Period)
        const collectionDays = settings.customerCollectionAlertDays || 3;
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + collectionDays);

        const upcomingInvoices = await Invoice.find({
            paymentStatus: { $in: ['pending', 'partial'] },
            paymentType: 'credit',
            dueDate: { $lte: targetDate, $gte: now },
            total: { $gte: minAmount }
        }).populate('customer', 'name');

        for (const inv of upcomingInvoices) {
            const balance = inv.total - inv.paidAmount;
            await this.create({
                title: `تحصيل قريب: ${inv.customer.name}`,
                message: `الفاتورة #${inv.number} تستحق خلال ${collectionDays} أيام بقيمة ${balance.toLocaleString()} ج.م.`,
                type: 'business',
                severity: 'info',
                targetRole: 'manager',
                link: `/invoices/${inv._id}`,
                deduplicationKey: `inv_due_soon_${inv._id}`,
                metadata: { invoiceId: inv._id, balance, action: 'COLLECT_DEBT', category: 'FINANCIAL' }
            });
        }
    }

    /**
     * Scanner: Payment Schedules (Installments)
     */
    static async syncInstallmentReminders(settings = null) {
        const { default: PaymentSchedule } = await import('../models/PaymentSchedule.js');
        const { default: Debt } = await import('../models/Debt.js');
        const now = new Date();
        const alertDays = settings?.customerCollectionAlertDays || 3;
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + alertDays);


        const soonInstallments = await PaymentSchedule.find({
            status: { $in: ['PENDING', 'OVERDUE'] },
            dueDate: { $lte: targetDate }
        }).populate({
            path: 'debtId',
            populate: { path: 'debtorId' }
        });


        for (const schedule of soonInstallments) {
            if (!schedule.debtId) {
                continue;
            }

            const debtor = schedule.debtId.debtorId;
            const isOverdue = schedule.dueDate < now;
            const type = schedule.entityType === 'Customer' ? 'تحصيل' : 'سداد';
            const statusLabel = isOverdue ? 'متأخر' : 'قادم';

            await this.create({
                title: `${type} قسط ${statusLabel}: ${debtor?.name || 'مجهول'}`,
                message: `قسط بقيمة ${schedule.amount.toLocaleString()} د.ل يستحق في ${schedule.dueDate.toLocaleDateString('ar-EG')}.`,
                type: 'business',
                severity: isOverdue ? 'critical' : 'info',
                targetRole: 'manager',
                link: `/financial/debt-center/${schedule.debtId._id}?autoPay=true`,
                deduplicationKey: `schedule_${schedule._id}_${isOverdue ? 'overdue' : 'soon'}`,
                metadata: {
                    debtId: schedule.debtId._id,
                    installmentId: schedule._id,
                    amount: schedule.amount,
                    action: schedule.entityType === 'Customer' ? 'COLLECT_DEBT' : 'PAY_SUPPLIER'
                }
            });
        }
    }

    /**
     * Sync All (Entry Point)
     */
    static async syncAllAlerts(force = false) {
        await dbConnect();

        if (!force) {
            const lastSync = await SystemMeta.findOne({ key: 'notifications_last_sync' }).lean();
            if (lastSync && (Date.now() - new Date(lastSync.updatedAt)) < 5 * 60 * 1000) {
                return; // Cached
            }
        }

        const settings = await InvoiceSettings.getSettings();

        // Run scanners
        await Promise.allSettled([
            this.syncStockAlerts(settings),
            this.syncSupplierAlerts(settings),
            this.syncDebtReminders(null, settings),
            this.syncInstallmentReminders(settings)
        ]);

        await SystemMeta.findOneAndUpdate(
            { key: 'notifications_last_sync' },
            { updatedAt: new Date() },
            { upsert: true }
        );
    }
}



