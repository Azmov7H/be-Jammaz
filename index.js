import 'dotenv/config';
import { logger } from './lib/logger.js';
import dbConnect from './lib/db.js';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import mongoose from 'mongoose';
import authRoutes from './routes/authRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import productRoutes from './routes/productRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import treasuryRoutes from './routes/treasuryRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import docsRoutes from './routes/docsRoutes.js';
import supplierRoutes from './routes/supplierRoutes.js';
import stockRoutes from './routes/stockRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import userRoutes from './routes/userRoutes.js';
import logRoutes from './routes/logRoutes.js';
import purchaseRoutes from './routes/purchaseRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import physicalInventoryRoutes from './routes/physicalInventoryRoutes.js';
import dailySalesRoutes from './routes/dailySalesRoutes.js';
import accountingRoutes from './routes/accountingRoutes.js';
import pricingRoutes from './routes/pricingRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';












const app = express();
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Environment policy (T-SEC-04 / SEC-003)
// ---------------------------------------------------------------------------
if (!process.env.NODE_ENV) {
    logger.warn('⚠️  NODE_ENV is not set — defaulting to "development". Set it explicitly (development|production|test).');
    process.env.NODE_ENV = 'development';
}
const IS_PROD_ENV = process.env.NODE_ENV === 'production';

// Middleware Configuration
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://jammaz.vercel.app',
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()) : []),
    process.env.NEXT_PUBLIC_BASE_URL
].filter(Boolean);

// Production hard-fails without an explicit origin list.
if (IS_PROD_ENV && allowedOrigins.length === 0) {
    throw new Error('[CONFIG] NODE_ENV=production requires explicit origins (ALLOWED_ORIGINS or NEXT_PUBLIC_BASE_URL).');
}
// Origin-less requests (curl, same-host tooling, health probes): denied in
// production unless ALLOW_ORIGIN_LESS=true opts back in.
const allowOriginLess = !IS_PROD_ENV || process.env.ALLOW_ORIGIN_LESS === 'true';

// CORS must be first to handle preflights and errors
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) {
            if (allowOriginLess) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        }
        if (allowedOrigins.indexOf(origin) !== -1 || (!IS_PROD_ENV)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

// Security Headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// NoSQL Injection Protection
app.use(mongoSanitize());

// HTTP Parameter Pollution Protection
app.use(hpp());

// Rate limiting (T-SEC-02 / RATE-001)
//
// CONSTRAINT: default MemoryStore — limits are per-process. Multi-instance
// deployments MUST move to a shared store (e.g. rate-limit-redis) before
// scaling horizontally.
const limiterOptions = (max) => ({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,   // RateLimit-* headers
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.', code: 'RATE_LIMITED' }
});

const limiter = rateLimit(limiterOptions(300)); // global: relaxed for dashboard chattiness

// Credential + token endpoints get a tight budget
const authLimiter = rateLimit(limiterOptions(10));

// Expensive report/aggregation surfaces
const heavyLimiter = rateLimit(limiterOptions(30));

if (process.env.NODE_ENV !== 'test') {
    app.use('/api/', limiter);
    app.use(['/api/auth/login', '/api/auth/google/callback', '/api/auth/refresh'], authLimiter);
    app.use(['/api/reports', '/api/dashboard', '/api/accounting/ledger'], heavyLimiter);
}

const PORT = process.env.PORT || 5000;

// T-PERF-05: explicit limit — 1mb accommodates multi-line invoices;
// do not raise without measuring payload sizes.
app.use(express.json({ limit: '1mb' }));
// T-PERF-04: gzip responses (default level). No SSE/streaming endpoints exist
// (verified Sprint 07) — safe to compress everything.
app.use(compression());
app.use(cookieParser());
app.use(morgan('dev'));

// Database Connection and Server Start
const startServer = async () => {
    try {
        await dbConnect();

        app.listen(PORT, '0.0.0.0', () => {
            logger.info(`✅ Server is running on http://127.0.0.1:${PORT}`);
        });
    } catch (err) {
        logger.error('❌ Failed to connect to database. Server not started:', err.message);
        process.exit(1);
    }
};

// Only bind the port when executed directly (not imported by tests/tools)
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const isMainProcess = process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMainProcess) {
    startServer();
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/treasury', treasuryRoutes);
app.use('/api/financial', financeRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api', reportRoutes); // reportRoutes handles /dashboard and /reports
app.use('/api/users', userRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/purchase-orders', purchaseRoutes); // canonical
app.use('/api/purchases', (_req, res, next) => {
    res.set('Deprecation', 'true');
    next();
}, purchaseRoutes); // deprecated alias — frontend verified to use /purchase-orders
app.use('/api/notifications', notificationRoutes);
app.use('/api/physical-inventory', physicalInventoryRoutes);
app.use('/api/daily-sales', dailySalesRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/settings', settingsRoutes);












app.get('/', (req, res) => {
    res.json({ message: 'Transfer ERP API is running' });
});

app.get('/api/health', async (req, res) => {
    const checks = { api: 'ok', mongodb: 'unknown' };
    try {
        const state = mongoose.connection.readyState;
        checks.mongodb = state === 1 ? 'ok' : 'disconnected';
        checks.mongodbState = ['disconnected', 'connected', 'connecting', 'disconnecting'][state] || 'unknown';
    } catch {
        checks.mongodb = 'error';
    }
    const healthy = checks.api === 'ok' && checks.mongodb === 'ok';
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'degraded',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        checks,
    });
});

// Error Handler
import { errorHandler } from './middlewares/errorHandler.js';
app.use(errorHandler);

export default app;
