import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import mongoose from 'mongoose';
import { WarehouseService } from '../services/warehouseService.js';

const main = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const primary = await WarehouseService.ensurePrimaryWarehouse();
    console.log('✅ Primary warehouse ready:', primary.name, `(code: ${primary.code})`);
    await mongoose.connection.close();
};

main().catch((err) => {
    console.error('❌ Bootstrap failed:', err.message);
    process.exit(1);
});