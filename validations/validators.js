import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives & shared bounds (T-VAL-03)
// ---------------------------------------------------------------------------
export const idSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ID');
const idField = idSchema;

// Money: bounded to 1e9; rounding rule documented — services round to 2dp
// via toFixed/parseFloat at persistence boundaries.
const money = z.coerce.number().min(0).max(1e9);
const positiveMoney = z.coerce.number().positive().max(1e9);
const qty = z.coerce.number().positive().max(1e6);

const dateField = z.union([z.string(), z.date()]).optional().nullable();

/**
 * Shared pagination contract (also consumed by the T-PERF-01 query helper).
 */
export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(200).optional(),
});

const paymentMethod = z.enum(['cash', 'bank', 'wallet', 'check']).optional();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const loginSchema = z.object({
    email: z.string().email('البريد الإلكتروني غير صالح'),
    password: z.string().min(1, 'كلمة المرور مطلوبة'),
});

// ---------------------------------------------------------------------------
// Users (canonical role set per Sprint 02)
// ---------------------------------------------------------------------------
export const userSchema = z.object({
    name: z.string().min(2, 'الاسم يجب أن يكون حرفين على الأقل').max(100),
    email: z.string().email('البريد الإلكتروني غير صالح'),
    password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل').max(128),
    role: z.enum(['owner', 'manager', 'cashier', 'warehouse', 'viewer'], {
        errorMap: () => ({ message: 'الدور الوظيفي غير صالح' })
    }),
    picture: z.string().max(500).optional(),
    isActive: z.boolean().optional(),
});

export const updateUserSchema = userSchema.partial();

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export const productSchema = z.object({
    name: z.string().min(1, 'اسم المنتج مطلوب').max(200),
    code: z.string().min(1, 'كود المنتج مطلوب').max(100),
    buyPrice: money.default(0),
    retailPrice: money.default(0),
    wholesalePrice: money.optional(),
    specialPrice: money.optional(),
    category: z.string().max(100).optional(),
    brand: z.string().max(100).optional(),
    subsection: z.string().max(100).optional(),
    size: z.string().max(50).optional(),
    color: z.string().max(50).optional(),
    gender: z.enum(['men', 'women', 'unisex', 'kids', 'none']).default('none'),
    season: z.string().max(50).optional(),
    minLevel: z.coerce.number().min(0).max(1e6).default(5),
    warehouseQty: z.coerce.number().min(0).max(1e6).default(0),
    shopQty: z.coerce.number().min(0).max(1e6).default(0),
    unit: z.string().max(30).default('piece'),
    isActive: z.boolean().default(true),
    images: z.array(z.string().max(500)).max(10).optional(),
});

export const updateProductSchema = productSchema.partial();

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------
export const stockMoveSchema = z.object({
    productId: idField.optional(),
    qty: qty.optional(),
    type: z.enum(['IN', 'OUT', 'SALE', 'TRANSFER_TO_SHOP', 'TRANSFER_TO_WAREHOUSE', 'ADJUST']),
    note: z.string().max(500).optional(),
    refId: idField.optional(),
    items: z.array(z.object({
        productId: idField,
        qty,
        type: z.string().max(30).optional(),
        note: z.string().max(500).optional()
    })).max(500).optional()
}).refine(data => (data.items && data.items.length > 0) || (data.productId && data.qty), {
    message: "Must provide either 'items' array or 'productId' and 'qty'"
});

export const stockTransferSchema = z.object({
    productId: idField,
    from: z.enum(['shop', 'warehouse']),
    to: z.enum(['shop', 'warehouse']),
    qty,
    quantity: qty.optional(), // legacy alias accepted by route
    note: z.string().max(500).optional(),
}).refine(data => data.from !== data.to, {
    message: 'لا يمكن التحويل لنفس الموقع'
});

export const stockAdjustSchema = z.object({
    productId: idField,
    location: z.enum(['shop', 'warehouse']),
    newQty: z.coerce.number().min(0).max(1e6),
    reason: z.string().min(2, 'يجب ذكر سبب التعديل').max(500),
});

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------
export const customerSchema = z.object({
    name: z.string().min(2, 'الاسم مطلوب').max(200),
    phone: z.string().min(5, 'رقم الهاتف مطلوب').max(30),
    priceType: z.enum(['retail', 'wholesale', 'special']).default('retail'),
    creditLimit: z.coerce.number().min(0).max(1e9).default(0),
    address: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    isActive: z.boolean().optional(),
    financialTrackingEnabled: z.boolean().optional(),
    collectionDay: z.string().max(30).optional(),
    paymentTerms: z.coerce.number().int().min(0).max(365).optional(),
    shippingCompany: z.string().max(200).optional(),
    openingBalance: money.optional(),
    openingBalanceType: z.enum(['debit', 'credit']).optional()
});

export const supplierSchema = z.object({
    name: z.string().min(2, 'الاسم مطلوب').max(200),
    contactName: z.string().max(200).optional(),
    phone: z.string().max(30).optional(),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    taxNumber: z.string().max(50).optional(),
    paymentTerms: z.coerce.number().int().min(0).max(365).default(0),
    openingBalance: money.optional(),
    openingBalanceType: z.enum(['debit', 'credit']).optional()
});

// ---------------------------------------------------------------------------
// Invoices  (T-VAL-04: credit sale requires customer)
// ---------------------------------------------------------------------------
export const invoiceSchema = z.object({
    items: z.array(z.object({
        productId: idField.optional().nullable(),
        name: z.string().max(200).optional(),
        qty: qty,
        unitPrice: money,
        isService: z.boolean().optional(),
        source: z.enum(['shop', 'warehouse']).default('shop'),
        buyPrice: money.optional()
    })).min(1, 'السلة فارغة').max(500),
    customerId: idField.optional().nullable(),
    customerName: z.string().max(200).optional(),
    customerPhone: z.string().max(30).optional(),
    tax: money.default(0),
    discount: money.optional(),
    notes: z.string().max(2000).optional(),
    paymentType: z.enum(['cash', 'credit', 'bank', 'wallet', 'check']).default('cash'),
    dueDate: dateField,
    shippingCompany: z.string().max(200).optional()
}).refine(
    data => data.paymentType !== 'credit' || !!data.customerId ||
        (data.customerName && data.customerPhone),
    {
        message: 'يجب تحديد عميل للمبيعات الآجلة أو إدخال اسم ورقم هاتف للعملاء الجدد'
    }
);

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------
export const purchaseOrderSchema = z.object({
    supplierId: idField.optional().nullable(),
    items: z.array(z.object({
        productId: idField,
        quantity: qty,
        costPrice: positiveMoney
    })).min(1, 'قائمة الأصناف فارغة').max(500),
    notes: z.string().max(2000).optional(),
    expectedDate: dateField,
    paymentType: z.enum(['cash', 'bank', 'credit', 'wallet', 'check']).default('cash')
});

export const poStatusSchema = z.object({
    status: z.enum(['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']),
    paymentType: z.enum(['cash', 'bank', 'credit', 'wallet', 'check']).optional()
});

export const poReceiveSchema = z.object({
    paymentType: z.enum(['cash', 'bank', 'credit', 'wallet', 'check']).default('cash'),
    receivedItems: z.array(z.object({
        productId: idField,
        quantity: qty,
        costPrice: positiveMoney
    }).partial({ productId: true, quantity: true, costPrice: true })).max(500).optional()
}).loose();

// ---------------------------------------------------------------------------
// Payments & finance
// ---------------------------------------------------------------------------
const noteField = z.string().max(500).optional();

export const customerPaymentSchema = z.object({
    invoice: idField,
    amount: positiveMoney,
    method: paymentMethod,
    note: noteField,
});

export const counterpartyPaymentSchema = z.object({
    customerId: idField.optional(),
    supplierId: idField.optional(),
    debtId: idField.optional(),
    amount: positiveMoney,
    method: paymentMethod,
    note: noteField,
}).refine(data => data.customerId || data.supplierId || data.debtId, {
    message: 'يجب تحديد العميل أو المورد أو الدين'
});

export const supplierPaymentSchema = z.object({
    po: idField,
    amount: positiveMoney,
    method: paymentMethod,
    note: noteField,
});

export const debtPaymentSchema = z.object({
    debt: idField,
    amount: positiveMoney,
    method: paymentMethod,
    note: noteField,
});

export const saleReturnSchema = z.object({
    invoice: idField,
    returnData: z.object({
        returnItems: z.array(z.object({
            productId: idField,
            qty,
            unitPrice: money.optional(),
        })).min(1).max(500),
        totalRefund: positiveMoney,
    }),
    refundMethod: z.string().max(30).optional(),
});

export const expenseSchema = z.object({
    amount: positiveMoney,
    reason: z.string().min(2, 'يجب ذكر سبب المصروف').max(500),
    category: z.string().min(2, 'يجب اختيار التصنيف').max(100),
    date: dateField,
    method: paymentMethod,
});

export const installmentPlanSchema = z.object({
    installmentsCount: z.coerce.number().int().min(1).max(60),
    interval: z.enum(['monthly', 'weekly', 'daily']).default('monthly'),
    startDate: dateField,
});

// ---------------------------------------------------------------------------
// Treasury & GL
// ---------------------------------------------------------------------------
export const treasuryTransactionSchema = z.object({
    amount: positiveMoney,
    description: z.string().min(2, 'الوصف مطلوب').max(500),
    type: z.enum(['INCOME', 'EXPENSE']),
    category: z.string().max(100).optional(),
    date: dateField,
    method: paymentMethod,
});

export const reconcileSchema = z.object({
    date: dateField,
    actualClosingBalance: z.coerce.number().min(-1e9).max(1e9),
    notes: z.string().max(2000).optional(),
});

export const glExpenseEntrySchema = z.object({
    amount: positiveMoney,
    category: z.string().min(2, 'يجب اختيار التصنيف').max(100),
    description: z.string().min(2, 'الوصف مطلوب').max(500),
    date: dateField,
});

export const glIncomeEntrySchema = z.object({
    amount: positiveMoney,
    description: z.string().min(2, 'الوصف مطلوب').max(500),
    date: dateField,
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
export const customPriceSchema = z.object({
    customerId: idField,
    productId: idField,
    price: money,
});

export const removeCustomPriceSchema = z.object({
    customerId: idField,
    productId: idField,
});

// ---------------------------------------------------------------------------
// Physical inventory
// ---------------------------------------------------------------------------
export const physicalInventoryCreateSchema = z.object({
    location: z.string().min(1, 'الموقع مطلوب').max(200),
    options: z.object({
        zeroOut: z.boolean().optional(),
        categories: z.array(z.string().max(100)).max(50).optional(),
    }).optional(),
});

export const physicalInventoryUpdateSchema = z.object({
    itemUpdates: z.array(z.object({
        productId: idField,
        countedQty: z.coerce.number().min(0).max(1e6),
    })).min(1).max(1000).optional(),
    notes: z.string().max(2000).optional(),
}).refine(data => data.itemUpdates || data.notes !== undefined, {
    message: 'لا يوجد ما يتم تحديثه'
});

export const unlockSchema = z.object({
    password: z.string().min(1, 'كلمة المرور مطلوبة').max(128),
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const markReadSchema = z.union([
    z.literal('all'),
    idSchema,
    z.array(idSchema).min(1).max(100)
]);
