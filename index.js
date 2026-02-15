import 'dotenv/config';
import dbConnect from './lib/db.js';
import express from 'express';
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

// Middleware Configuration
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://jammaz.vercel.app',
    process.env.NEXT_PUBLIC_BASE_URL
].filter(Boolean);

// CORS must be first to handle preflights and errors
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.' }
});

app.use('/api/', limiter);

const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// Database Connection and Server Start
const startServer = async () => {
    try {
        await dbConnect();

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Server is running on http://127.0.0.1:${PORT}`);
        });
    } catch (err) {
        console.error('❌ Failed to connect to database. Server not started:', err.message);
        process.exit(1);
    }
};

startServer();

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
app.use('/api/purchases', purchaseRoutes);
app.use('/api/purchase-orders', purchaseRoutes); // Alias for frontend compatibility
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

// Error Handler
import { errorHandler } from './middlewares/errorHandler.js';
app.use(errorHandler);
