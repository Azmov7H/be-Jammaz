import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

dotenv.config({ path: envPath });
console.log('Resolved .env path:', envPath);

// Use dynamic imports to ensure dotenv.config() runs first
async function main() {
    const { default: mongoose } = await import('mongoose');
    const { TreasuryService } = await import('../services/treasuryService.js');
    const { default: TreasuryTransaction } = await import('../models/TreasuryTransaction.js');
    const { default: CashboxDaily } = await import('../models/CashboxDaily.js');
    const { default: dbConnect } = await import('../lib/db.js');

    await dbConnect();
    console.log('--- Verification Started ---');

    try {
        const dummyUser = new mongoose.Types.ObjectId();
        const amount = 750;

        const dummyCustomer = { _id: new mongoose.Types.ObjectId(), name: 'Test Bank Customer' };

        console.log(`Testing recordUnifiedCollection with Bank: ${amount}...`);
        const tx = await TreasuryService.recordUnifiedCollection(
            dummyCustomer,
            amount,
            dummyUser,
            'bank',
            'Verification Bank Payment'
        );

        console.log('Transaction Created:', tx.description, 'Method:', tx.method);

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const cashbox = await CashboxDaily.findOne({ date: startOfDay });

        console.log('Cashbox Snapshot:');
        console.log('- Total Income:', cashbox.totalIncome);
        console.log('- Bank Income:', cashbox.bankIncome);
        console.log('- Sales Income (Cash):', cashbox.salesIncome);
        console.log('- Net Change:', cashbox.netChange);

        if (cashbox.bankIncome >= amount) {
            console.log('✅ SUCCESS: Bank income correctly reflected in CashboxDaily.');
        } else {
            console.log('❌ FAILURE: Bank income not found/incorrect in CashboxDaily.');
        }

        // Test Manual Income with Bank
        console.log('\nTesting addManualIncome with Bank: 250...');
        await TreasuryService.addManualIncome(new Date(), 250, 'Manual Bank Test', dummyUser, 'bank');

        const updatedCashbox = await CashboxDaily.findOne({ date: startOfDay });
        console.log('- Updated Bank Income:', updatedCashbox.bankIncome);

        if (updatedCashbox.bankIncome >= amount + 250) {
            console.log('✅ SUCCESS: Manual bank income also reflected.');
        } else {
            console.log('❌ FAILURE: Manual bank income not reflected correctly.');
        }

        // Cleanup test data (optional in dev, but good practice)
        await TreasuryTransaction.deleteMany({ description: /Verification/ });
        console.log('Test transactions cleaned up.');

    } catch (error) {
        console.error('Verification Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('--- Verification Finished ---');
    }
}

main();
