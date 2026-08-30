import dbConnect from '../lib/db.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

/**
 * Server-side export (Sprint 8 — FIN-EXP-001..004 / SEC-EXP-001..003).
 *
 * Renders module data to CSV (UTF-8 BOM so Arabic opens correctly in Excel),
 * honoring the same filters the UI uses, scoping to role permissions, masking
 * sensitive columns (sourceNumber) unless owner/manager, and NEVER accepting a
 * raw `_id`/`partnerId` list from the client (anti-IDOR: SEC-EXP-001).
 */

// Allowed filter keys per module. Anything unknown is rejected (SEC-EXP-002) —
// filters are schema-validated, never passed straight into Mongo.
const FILTER_SCHEMAS = {
    customers: ['search'],
    suppliers: ['search'],
    products: ['search'],
    invoices: ['startDate', 'endDate', 'paymentType', 'status', 'customer'],
    purchaseOrders: ['startDate', 'endDate', 'paymentType', 'status', 'supplier'],
    treasuryTransactions: ['startDate', 'endDate', 'type', 'method']
};

const SENSITIVE_PRIVILEGED_ROLES = ['owner', 'manager'];

const MODULES = {
    customers: {
        label: 'العملاء',
        async load() { return (await import('../models/Customer.js')).default; },
        columns: [
            { key: 'name', header: 'الاسم' },
            { key: 'phone', header: 'الهاتف' },
            { key: 'address', header: 'العنوان' },
            { key: 'balance', header: 'الرصيد' },
            { key: 'creditLimit', header: 'سقف الائتمان' },
            { key: 'taxNumber', header: 'الرقم الضريبي' },
            { key: 'isSupplier', header: 'مورد أيضًا' }
        ],
        async query(filters) {
            const model = await MODULES.customers.load();
            const q = {};
            if (filters.search) q.$or = [{ name: new RegExp(filters.search, 'i') }, { phone: new RegExp(filters.search, 'i') }];
            return model.find(q).sort({ createdAt: -1 }).lean();
        },
        map: (r) => ({
            name: r.name, phone: r.phone, address: r.address, balance: r.balance ?? 0,
            creditLimit: r.creditLimit ?? 0, taxNumber: r.taxNumber ?? '', isSupplier: r.isSupplier ? 'نعم' : 'لا'
        })
    },
    suppliers: {
        label: 'الموردون',
        async load() { return (await import('../models/Supplier.js')).default; },
        columns: [
            { key: 'name', header: 'الاسم' },
            { key: 'phone', header: 'الهاتف' },
            { key: 'address', header: 'العنوان' },
            { key: 'balance', header: 'الرصيد' },
            { key: 'taxNumber', header: 'الرقم الضريبي' },
            { key: 'isCustomer', header: 'عميل أيضًا' }
        ],
        async query(filters) {
            const model = await MODULES.suppliers.load();
            const q = {};
            if (filters.search) q.$or = [{ name: new RegExp(filters.search, 'i') }, { phone: new RegExp(filters.search, 'i') }];
            return model.find(q).sort({ createdAt: -1 }).lean();
        },
        map: (r) => ({
            name: r.name, phone: r.phone, address: r.address, balance: r.balance ?? 0,
            taxNumber: r.taxNumber ?? '', isCustomer: r.isCustomer ? 'نعم' : 'لا'
        })
    },
    products: {
        label: 'المنتجات',
        async load() { return (await import('../models/Product.js')).default; },
        columns: [
            { key: 'name', header: 'الاسم' },
            { key: 'code', header: 'الكود' },
            { key: 'category', header: 'الفئة' },
            { key: 'buyPrice', header: 'سعر الشراء' },
            { key: 'retailPrice', header: 'سعر البيع' },
            { key: 'warehouseQty', header: 'كمية المخزن' },
            { key: 'shopQty', header: 'كمية المتجر' },
            { key: 'stockQty', header: 'إجمالي المخزون' }
        ],
        async query(filters) {
            const model = await MODULES.products.load();
            const q = {};
            if (filters.search) q.$or = [{ name: new RegExp(filters.search, 'i') }, { code: new RegExp(filters.search, 'i') }];
            return model.find(q).sort({ createdAt: -1 }).lean();
        },
        map: (r) => ({
            name: r.name, code: r.code, category: r.category ?? '', buyPrice: r.buyPrice ?? 0,
            retailPrice: r.retailPrice ?? 0, warehouseQty: r.warehouseQty ?? 0, shopQty: r.shopQty ?? 0,
            stockQty: (r.warehouseQty ?? 0) + (r.shopQty ?? 0)
        })
    },
    invoices: {
        label: 'الفواتير',
        async load() { return (await import('../models/Invoice.js')).default; },
        columns: [
            { key: 'number', header: 'رقم الفاتورة' },
            { key: 'date', header: 'التاريخ' },
            { key: 'customer', header: 'العميل' },
            { key: 'total', header: 'الإجمالي' },
            { key: 'paymentType', header: 'طريقة الدفع' },
            { key: 'paymentStatus', header: 'حالة الدفع' }
        ],
        async query(filters) {
            const model = await MODULES.invoices.load();
            const q = {};
            if (filters.startDate || filters.endDate) {
                q.date = {};
                if (filters.startDate) q.date.$gte = new Date(filters.startDate);
                if (filters.endDate) q.date.$lte = new Date(filters.endDate);
            }
            if (filters.paymentType) q.paymentType = filters.paymentType;
            if (filters.paymentStatus) q.paymentStatus = filters.paymentStatus;
            if (filters.customer) q.customer = filters.customer;
            return model.find(q).sort({ date: -1 }).lean();
        },
        async map(r) {
            let customer = '';
            if (r.customer) {
                const Customer = (await import('../models/Customer.js')).default;
                const c = await Customer.findById(r.customer).select('name').lean();
                customer = c?.name ?? '';
            }
            return {
                number: r.number || '',
                date: r.date ? r.date.toISOString().slice(0, 10) : '',
                customer,
                total: r.total ?? 0,
                paymentType: r.paymentType ?? '',
                paymentStatus: r.paymentStatus ?? ''
            };
        }
    },
    purchaseOrders: {
        label: 'أوامر الشراء',
        async load() { return (await import('../models/PurchaseOrder.js')).default; },
        columns: [
            { key: 'poNumber', header: 'رقم الأمر' },
            { key: 'date', header: 'التاريخ' },
            { key: 'supplier', header: 'المورد' },
            { key: 'totalCost', header: 'التكلفة' },
            { key: 'paymentType', header: 'طريقة الدفع' },
            { key: 'paymentStatus', header: 'حالة الدفع' },
            { key: 'status', header: 'الحالة' }
        ],
        async query(filters) {
            const model = await MODULES.purchaseOrders.load();
            const q = {};
            if (filters.startDate || filters.endDate) {
                q.createdAt = {};
                if (filters.startDate) q.createdAt.$gte = new Date(filters.startDate);
                if (filters.endDate) q.createdAt.$lte = new Date(filters.endDate);
            }
            if (filters.paymentType) q.paymentType = filters.paymentType;
            if (filters.paymentStatus) q.paymentStatus = filters.paymentStatus;
            if (filters.status) q.status = filters.status;
            if (filters.supplier) q.supplier = filters.supplier;
            return model.find(q).sort({ createdAt: -1 }).lean();
        },
        async map(r) {
            let supplier = '';
            if (r.supplier) {
                const Supplier = (await import('../models/Supplier.js')).default;
                const s = await Supplier.findById(r.supplier).select('name').lean();
                supplier = s?.name ?? '';
            }
            return {
                poNumber: r.poNumber || '',
                date: r.createdAt ? r.createdAt.toISOString().slice(0, 10) : '',
                supplier,
                totalCost: r.totalCost ?? 0,
                paymentType: r.paymentType ?? '',
                paymentStatus: r.paymentStatus ?? '',
                status: r.status ?? ''
            };
        }
    },
    treasuryTransactions: {
        label: 'حركة الخزينة',
        async load() { return (await import('../models/TreasuryTransaction.js')).default; },
        columns: [
            { key: 'date', header: 'التاريخ' },
            { key: 'type', header: 'النوع' },
            { key: 'method', header: 'الطريقة' },
            { key: 'amount', header: 'المبلغ' },
            { key: 'description', header: 'الوصف' },
            { key: 'receiptNumber', header: 'رقم الإيصال' },
            { key: 'sourceNumber', header: 'رقم التحويل', sensitive: true }
        ],
        async query(filters) {
            const model = await MODULES.treasuryTransactions.load();
            const q = {};
            if (filters.startDate || filters.endDate) {
                q.date = {};
                if (filters.startDate) q.date.$gte = new Date(filters.startDate);
                if (filters.endDate) q.date.$lte = new Date(filters.endDate);
            }
            if (filters.type) q.type = filters.type;
            if (filters.method) q.method = filters.method;
            return model.find(q).sort({ date: -1 }).lean();
        },
        map: (r) => ({
            date: r.date ? r.date.toISOString().slice(0, 10) : '',
            type: r.type ?? '',
            method: r.method ?? '',
            amount: r.amount ?? 0,
            description: r.description ?? '',
            receiptNumber: r.receiptNumber ?? '',
            sourceNumber: r.sourceNumber ?? ''
        })
    }
};

const TO_CSV = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const ExportService = {
    /**
     * Export a module.
     * @param {string} type one of MODULES keys
     * @param {object} filters validated allowed keys
     * @param {string} format 'csv' (default)
     * @param {{role:string}} user
     * @returns {{filename:string, csv:string}}
     */
    async export(type, filters = {}, format = 'csv', user) {
        await dbConnect();
        const mod = MODULES[type];
        if (!mod) throw new NotFoundError(`نوع التصدير غير مدعوم: ${type}`);
        if (format !== 'csv' && format !== 'xlsx') throw new BadRequestError('صيغة التصدير غير مدعومة');

        // Validate filters: only allow-listed keys (SEC-EXP-002).
        const allowed = FILTER_SCHEMAS[type] || [];
        for (const key of Object.keys(filters)) {
            if (!allowed.includes(key)) {
                throw new BadRequestError(`مرشح غير مدعوم: ${key}`);
            }
        }

        // Sensitive columns only for privileged roles (SEC-EXP-001 / FIN-EXP-004).
        const privileged = SENSITIVE_PRIVILEGED_ROLES.includes(user?.role);
        const cols = mod.columns.filter((c) => !c.sensitive || privileged);

        const rows = await mod.query(filters);

        let csv = '\uFEFF'; // UTF-8 BOM for Arabic in Excel.
        csv += cols.map((c) => TO_CSV(c.header)).join(',') + '\r\n';
        for (const r of rows) {
            const mapped = await mod.map(r);
            csv += cols.map((c) => TO_CSV(mapped[c.key])).join(',') + '\r\n';
        }

        return { filename: `${type}_${new Date().toISOString().slice(0, 10)}.csv`, csv, count: rows.length };
    }
};

export default ExportService;
