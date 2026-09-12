import express from 'express';
import { TahweeshService } from '../services/tahweeshService.js';
import { routeHandler } from '../lib/route-handler.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../lib/validate.js';
import { tahweeshTransferSchema, tahweeshWithdrawSchema } from '../validations/index.js';

const router = express.Router();

router.use(authMiddleware);

// Current set-aside balance (stored doc, rebuilt from the ledger when missing).
router.get('/balance', routeHandler(async () => {
    return { balance: await TahweeshService.getBalance() };
}));

// Move money from an operating channel into the set-aside.
// Idempotent on transferId — safe to retry.
router.post('/deposit', roleMiddleware(['owner', 'manager']), validate(tahweeshTransferSchema), routeHandler(async (req) => {
    const { source, amount, note, transferId, sourceNumber } = req.body;
    return await TahweeshService.deposit(
        { source, amount, note, transferId, sourceNumber },
        req.user._id
    );
}));

// Return set-aside money to cash. Funding a business payment is NOT a
// withdraw — spend through the payment paths with method:'tahweesh'.
router.post('/withdraw', roleMiddleware(['owner', 'manager']), validate(tahweeshWithdrawSchema), routeHandler(async (req) => {
    const { amount, note, transferId } = req.body;
    return await TahweeshService.withdraw({ amount, note, transferId }, req.user._id);
}));

export default router;
