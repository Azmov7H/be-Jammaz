import mongoose from 'mongoose';
import { logger } from './logger.js';

function mongoUri() {
    // FIN-IMPORT-01 (T-16): read lazily, never at import time. Service
    // modules are statically imported by tests before the harness sets
    // MONGODB_URI — an import-time throw (or a frozen stale value) breaks
    // that. Same error, raised at first connect instead.
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        logger.error('CRITICAL: MONGODB_URI is not defined in process.env');
        throw new Error('Please define the MONGODB_URI environment variable inside .env');
    }
    return uri;
}

/**
 * Global cache to prevent multiple connections in development
 */
let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

async function dbConnect() {
    if (cached.conn) {
        return cached.conn;
    }

    if (!cached.promise) {
        // Disable buffering globally so we get immediate errors if not connected
        mongoose.set('bufferCommands', false);

        const opts = {
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000,
            family: 4 // Force IPv4 to avoid some nodejs/mongo ipv6 lookup issues
        };

        logger.info('Connecting to MongoDB...');
        cached.promise = mongoose.connect(mongoUri(), opts).then((mongoose) => {
            logger.info('✅ MongoDB Connected Successfully');
            return mongoose;
        }).catch(err => {
            logger.error('❌ MongoDB Connection Error:', err.message);

            if (err.code === 'ETIMEOUT' && err.syscall === 'queryTxt') {
                logger.error('---');
                logger.error('تنبيه: فشل في الوصول إلى DNS الخاص بـ MongoDB Atlas.');
                logger.error('هذا يعني غالباً أن مزود الإنترنت لديك يحجب الاتصال بالسيرفر أو أن اتصالك بالإنترنت ضعيف جداً.');
                logger.error('الحلول المقترحة:');
                logger.error('1. جرب تغيير الـ DNS في جهازك إلى Google DNS (8.8.8.8).');
                logger.error('2. استخدم VPN أو نقطة اتصال إنترنت مختلفة.');
                logger.error('3. استخدم MongoDB محلي بدلاً من Atlas.');
                logger.error('---');
            } else if (err.message.includes('ETIMEOUT') || err.message.includes('selection timed out')) {
                logger.error('---');
                logger.error('تنبيه: تعذر الاتصال بسيرفر MongoDB.');
                logger.error('إذا كنت تستخدم MongoDB Atlas، يرجى التأكد من إضافة عنوان IP الخاص بك في Network Access.');
                logger.error('---');
            }
            throw err;
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }

    return cached.conn;
}

export default dbConnect;


