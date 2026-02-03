export const ROLES = {
    OWNER: 'owner',
    MANAGER: 'manager',
    CASHIER: 'cashier',
    WAREHOUSE: 'warehouse',
    VIEWER: 'viewer'
};

export const PERMISSIONS = {
    [ROLES.OWNER]: ['*'], // Full Access
    [ROLES.MANAGER]: [
        'dashboard:view',
        'products:manage',
        'stock:manage',
        'invoices:manage',
        'financial:view',
        'financial:manage',
        'reports:view',
        'suppliers:manage',
        'transfers:manage',
        'users:manage',
        'activity:view',
        'settings:manage'
    ],
    [ROLES.CASHIER]: [
        'dashboard:view',
        'invoices:create',
        'invoices:view',
        'products:view',
        'products:read_stock'
    ],
    [ROLES.WAREHOUSE]: [
        'dashboard:view',
        'stock:manage',
        'transfers:manage',
        'products:view',
        'audit:manage'
    ],
    [ROLES.VIEWER]: [
        'dashboard:view',
        'products:view',
        'stock:view_only',
        'reports:view'
    ]
};

/**
 * Check if a role has a specific permission
 * @param {string} role 
 * @param {string} permission 
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
    if (!role) return false;
    if (role === 'owner') return true;

    const rolePermissions = PERMISSIONS[role] || [];
    if (rolePermissions.includes('*')) return true;

    return rolePermissions.includes(permission);
}

/**
 * Get authorized product query filter based on role
 * @param {string} role 
 * @returns {object} Mongoose filter object
 */
export function getProductFilterInternal(role) {
    if (role === 'owner' || role === 'manager') return {}; // All products
    if (role === 'warehouse') return {}; // Warehouse sees all? Or maybe just warehouse? Usually all to know what's coming.
    if (role === 'cashier') return { shopQty: { $gt: -1 } }; // Cashier needs to see shop products.
    return {};
}

/**
 * Require a user to have a specific permission, throw error if not
 * @param {Object} user - User object with role property
 * @param {string} permission - Permission string (e.g., 'products:manage')
 * @throws {string} Error message if user doesn't have permission
 */
export function requirePermission(user, permission) {
    if (!user) {
        throw 'Unauthorized - يجب تسجيل الدخول';
    }

    if (!hasPermission(user.role, permission)) {
        throw 'ليس لديك صلاحية لهذا الإجراء';
    }
}

/**
 * Check if user can manage resources (owner or manager)
 * @param {Object} user - User object with role property
 * @returns {boolean}
 */
export function canManage(user) {
    return user && (user.role === 'owner' || user.role === 'manager');
}

/**
 * Require user to be owner or manager
 * @param {Object} user - User object
 * @throws {string} Error if not authorized
 */
export function requireManager(user) {
    if (!canManage(user)) {
        throw 'هذه العملية تتطلب صلاحيات إدارية';
    }
}



