import express from 'express';
import { routeHandler } from '../lib/route-handler.js';

const router = express.Router();

const apiDocs = {
    version: "1.0.0",
    description: "Jammaz ERP API - Comprehensive System for Inventory, Sales, and Finance",
    baseUrl: "/api",
    responseFormat: {
        success: "boolean",
        data: "any",
        message: "string | null",
        error: "string (only if success is false)"
    },
    resources: {
        auth: {
            prefix: "/auth",
            endpoints: [
                { method: "POST", path: "/login", description: "Login user" },
                { method: "POST", path: "/register", description: "Register new user" },
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
        purchases: {
            prefix: "/purchases",
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
