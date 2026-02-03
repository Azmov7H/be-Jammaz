import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env');
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

        console.log('Attempting to connect to MongoDB...');
        cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
            console.log('✅ MongoDB Connected Successfully');
            return mongoose;
        }).catch(err => {
            console.error('❌ MongoDB Connection Error:', err.message);

            if (err.code === 'ETIMEOUT' && err.syscall === 'queryTxt') {
                console.error('---');
                console.error('تنبيه: فشل في الوصول إلى DNS الخاص بـ MongoDB Atlas.');
                console.error('هذا يعني غالباً أن مزود الإنترنت لديك يحجب الاتصال بالسيرفر أو أن اتصالك بالإنترنت ضعيف جداً.');
                console.error('الحلول المقترحة:');
                console.error('1. جرب تغيير الـ DNS في جهازك إلى Google DNS (8.8.8.8).');
                console.error('2. استخدم VPN أو نقطة اتصال إنترنت مختلفة.');
                console.error('3. استخدم MongoDB محلي بدلاً من Atlas.');
                console.error('---');
            } else if (err.message.includes('ETIMEOUT') || err.message.includes('selection timed out')) {
                console.error('---');
                console.error('تنبيه: تعذر الاتصال بسيرفر MongoDB.');
                console.error('إذا كنت تستخدم MongoDB Atlas، يرجى التأكد من إضافة عنوان IP الخاص بك في Network Access.');
                console.error('---');
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


