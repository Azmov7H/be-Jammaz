import express from 'express';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// T-SEC-03: internal API docs require an authenticated session.
router.use(authMiddleware);

const apiDocs = {
    version: "1.0.0",
    description: "Jammaz ERP API - Comprehensive System for Inventory, Sales, and Finance",
    baseUrl: "/api",
    responseFormat: {
        success: "boolean",
        data: "any",
        message: "string | null",
        code: "string (stable machine-readable code, on errors)",
        details: "object (field-level validation info, 400s only)",
        timestamp: "ISO string"
    },
    resources: {
        auth: {
            prefix: "/auth",
            endpoints: [
                { method: "POST", path: "/login", description: "Login user" },
                { method: "GET", path: "/me", description: "Get current user profile" }
            ]
        },
        invoices: {
            prefix: "/invoices",
            endpoints: [
                { method: "GET", path: "/", description: "List invoices (paginated)" },
                { method: "POST", path: "/", description: "Create new invoice" },
                { method: "GET", path: "/:id", description: "Get invoice details" }
            ]
        },
        stock: {
            prefix: "/stock",
            endpoints: [
                { method: "GET", path: "/", description: "Get stock levels" },
                { method: "GET", path: "/movements", description: "Get stock movement history" },
                { method: "POST", path: "/move", description: "Move stock manually" }
            ]
        },
        purchaseOrders: {
            prefix: "/purchase-orders", // /purchases is a deprecated alias
            endpoints: [
                { method: "GET", path: "/", description: "List purchase orders" },
                { method: "POST", path: "/", description: "Create purchase order" }
            ]
        }
    }
};

router.get('/', routeHandler(async (req) => {
    return apiDocs;
}));

export default router;
