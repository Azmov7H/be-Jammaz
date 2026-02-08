import { z } from 'zod';

export const idSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ID');

export const paginationSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10),
    search: z.string().optional(),
});

export const loginSchema = z.object({
    email: z.string().email('البريد الإلكتروني غير صالح'),
    password: z.string().min(1, 'كلمة المرور مطلوبة'),
});

export const userSchema = z.object({
    name: z.string().min(2, 'الاسم يجب أن يكون حرفين على الأقل'),
    email: z.string().email('البريد الإلكتروني غير صالح'),
    password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
    role: z.enum(['owner', 'manager', 'accountant', 'sales', 'warehouse', 'viewer', 'cashier'], {
        errorMap: () => ({ message: 'الدور الوظيفي غير صالح' })
    }),
});

export const updateUserSchema = userSchema.partial().omit({ password: true }).extend({
    password: z.string().min(6).optional()
});

export const productSchema = z.object({
    name: z.string().min(2, 'الاسم مطلوب'),
    code: z.string().min(1, 'الكود مطلوب'),
    retailPrice: z.coerce.number().min(0, 'سعر البيع مطلوب'),
    buyPrice: z.coerce.number().min(0, 'سعر الشراء مطلوب'),
    minLevel: z.coerce.number().default(5),
    shopQty: z.coerce.number().default(0),
    warehouseQty: z.coerce.number().default(0),
    // Optional fields
    brand: z.string().optional(),
    category: z.string().optional(),
    subsection: z.string().optional(),
    size: z.string().optional(),
    color: z.string().optional(),
    gender: z.string().optional(),
    season: z.string().optional(),
    minProfitMargin: z.coerce.number().optional(),
    images: z.array(z.string()).optional()
});

export const stockMoveSchema = z.object({
    productId: z.string().optional(), // Optional for bulk if items present
    qty: z.coerce.number().optional(),
    type: z.enum(['IN', 'OUT', 'SALE', 'TRANSFER_TO_SHOP', 'TRANSFER_TO_WAREHOUSE', 'ADJUST']),
    note: z.string().optional(),
    items: z.array(z.object({
        productId: z.string(),
        qty: z.coerce.number(),
        type: z.string().optional(),
        note: z.string().optional()
    })).optional()
}).refine(data => (data.items && data.items.length > 0) || (data.productId && data.qty), {
    message: "Must provide either 'items' array or 'productId' and 'qty'"
});

export const customerSchema = z.object({
    name: z.string().min(2, 'الاسم مطلوب'),
    phone: z.string().min(5, 'رقم الهاتف مطلوب'),
    priceType: z.enum(['retail', 'wholesale', 'special']).default('retail'),
    creditLimit: z.coerce.number().default(0),
    address: z.string().optional(),
    notes: z.string().optional(),
    isActive: z.boolean().optional(),
    financialTrackingEnabled: z.boolean().optional(),
    collectionDay: z.string().optional(),
    paymentTerms: z.coerce.number().optional(),
    shippingCompany: z.string().optional(),
    // Opening Balance (Only for creation)
    openingBalance: z.coerce.number().optional(),
    openingBalanceType: z.enum(['debit', 'credit']).optional()
});

export const supplierSchema = z.object({
    name: z.string().min(2, 'الاسم مطلوب'),
    contactName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().optional(),
    notes: z.string().optional(),
    taxNumber: z.string().optional(),
    paymentTerms: z.coerce.number().default(0),
    // Opening Balance (Only for creation)
    openingBalance: z.coerce.number().optional(),
    openingBalanceType: z.enum(['debit', 'credit']).optional()
});

export const invoiceSchema = z.object({
    items: z.array(z.object({
        productId: z.string().optional().nullable(),
        name: z.string().optional(),
        qty: z.coerce.number().min(0.01),
        unitPrice: z.coerce.number().min(0),
        isService: z.boolean().optional(),
        source: z.enum(['shop', 'warehouse']).default('shop')
    })).min(1, 'السلة فارغة'),
    customerId: z.string().optional().nullable(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    tax: z.coerce.number().default(0),
    paymentType: z.enum(['cash', 'credit', 'bank', 'wallet', 'check']).default('cash'),
    dueDate: z.string().optional().nullable(),
    shippingCompany: z.string().optional()
}).refine(data => data.customerId || (data.customerName && data.customerPhone) || (data.paymentType === 'cash'), {
    message: "يجب تحديد عميل للمبيعات الآجلة أو إدخال اسم ورقم هاتف للعملاء الجدد"
});

export const purchaseOrderSchema = z.object({
    supplierId: z.string().optional().nullable(),
    items: z.array(z.object({
        productId: z.string(),
        quantity: z.coerce.number().positive(),
        costPrice: z.coerce.number().positive()
    })).min(1, 'قائمة الأصناف فارغة'),
    notes: z.string().optional(),
    expectedDate: z.string().optional().nullable(),
    paymentType: z.enum(['cash', 'bank', 'credit', 'wallet', 'check']).default('cash')
});

export const poReceiveSchema = z.object({
    id: z.string(),
    status: z.literal('RECEIVED'),
    paymentType: z.enum(['cash', 'bank', 'credit', 'wallet', 'check']).default('cash')
});

export const expenseSchema = z.object({
    amount: z.coerce.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
    reason: z.string().min(2, 'يجب ذكر سبب المصروف'),
    category: z.string().min(2, 'يجب اختيار التصنيف'),
    date: z.string().optional().nullable()
});


