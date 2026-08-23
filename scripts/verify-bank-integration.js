// Sprint 05 / DATA-005: verify-bank-integration with safe execution modes.
//
//   node scripts/verify-bank-integration.js            # DRY_RUN: prints the
//                                                      # intended writes, touches nothing
//   node scripts/verify-bank-integration.js --write    # executes against a NON-production DB
//   PROD_URI_PATTERN='mongodb\\+srv' ... --write       # override production guard
//
// Guards:
// - Default is dry-run; writes require BOTH `--write` flag and WRITE=1 env.
// - Refuses to run in write mode when MONGODB_URI looks like production
//   (matches PROD_URI_PATTERN, default targets Atlas SRV strings).
// - Cleanup reverses BOTH the transaction rows AND the CashboxDaily increments.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const args = process.argv.slice(2);
const WRITE_FLAG = args.includes('--write');
const WRITE_ENV = process.env.WRITE === '1';
const DRY_RUN = !(WRITE_FLAG && WRITE_ENV);
const PROD_URI_PATTERN = process.env.PROD_URI_PATTERN || 'mongodb\\+srv|prod';

async function main() {
    const { default: mongoose } = await import('mongoose');
    const uri = process.env.MONGODB_URI;

    if (!DRY_RUN) {
        if (uri && new RegExp(PROD_URI_PATTERN, 'i').test(uri)) {
            console.error('❌ REFUSING TO WRITE: MONGODB_URI matches production pattern.',
                'Override with PROD_URI_PATTERN if this is genuinely safe.');
            process.exit(1);
        }
        console.log('⚠️  WRITE MODE — data will be created then cleaned up.');
    } else {
        console.log('🔍 DRY RUN (default). Intended writes shown below; nothing will be touched.');
        console.log('   To execute: node scripts/verify-bank-integration.js --write  (plus WRITE=1)');
    }

    const { TreasuryService } = await import('../services/treasuryService.js');
    const { default: TreasuryTransaction } = await import('../models/TreasuryTransaction.js');
    const { default: CashboxDaily } = await import('../models/CashboxDaily.js');
    const { default: dbConnect } = await import('../lib/db.js');

    await dbConnect();
    console.log('--- Verification Started ---');

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    try {
        if (DRY_RUN) {
            console.log('Plan:');
            console.log('  1. recordUnifiedCollection(customer=dummy, amount=750, method=bank)');
            console.log('     -> +1 TreasuryTransaction, CashboxDaily.bankIncome += 750');
            console.log('  2. addManualIncome(today, 250, "Manual Bank Test", method=bank)');
            console.log('     -> +1 TreasuryTransaction, CashboxDaily.bankIncome += 250');
            console.log('  3. Cleanup: delete both transactions, CashboxDaily.bankIncome -= 1000');
            return;
        }

        const dummyUser = new mongoose.Types.ObjectId();
        const amount = 750;
        const dummyCustomer = { _id: new mongoose.Types.ObjectId(), name: 'Test Bank Customer' };

        console.log(`Testing recordUnifiedCollection with Bank: ${amount}...`);
        await TreasuryService.recordUnifiedCollection(
            dummyCustomer,
            amount,
            dummyUser,
            'bank',
            'Verification Bank Payment'
        );

        let cashbox = await CashboxDaily.findOne({ date: startOfDay });
        console.log('- Bank Income after unified collection:', cashbox?.bankIncome ?? 0);
        if ((cashbox?.bankIncome ?? 0) >= amount) {
            console.log('✅ SUCCESS: Bank income correctly reflected in CashboxDaily.');
        } else {
            console.log('❌ FAILURE: Bank income not found/incorrect in CashboxDaily.');
        }

        console.log('\nTesting addManualIncome with Bank: 250...');
        await TreasuryService.addManualIncome(new Date(), 250, 'Manual Bank Test', dummyUser, 'bank');

        cashbox = await CashboxDaily.findOne({ date: startOfDay });
        console.log('- Updated Bank Income:', cashbox.bankIncome);
        if (cashbox.bankIncome >= amount + 250) {
            console.log('✅ SUCCESS: Manual bank income also reflected.');
        } else {
            console.log('❌ FAILURE: Manual bank income not reflected correctly.');
        }
    } catch (error) {
        console.error('Verification Error:', error);
    } finally {
        if (!DRY_RUN) {
            // Cleanup: reverse transactions AND cashbox increments.
            try {
                const { default: CashboxDailyModel } = await import('../models/CashboxDaily.js');
                await TreasuryTransaction.deleteMany({ description: /Verification|Manual Bank Test/ });
                const startOfDay2 = new Date();
                startOfDay2.setHours(0, 0, 0, 0);
                await CashboxDailyModel.findOneAndUpdate(
                    { date: startOfDay2 },
                    { $inc: { bankIncome: -1000 } }
                );
                console.log('Cleanup complete: transactions removed, cashbox reversed.');
            } catch (e) {
                console.error('CLEANUP FAILED — manual reversal required:', e.message);
            }
        }
        await mongoose.connection.close();
        console.log('--- Verification Finished ---');
    }
}

main();
