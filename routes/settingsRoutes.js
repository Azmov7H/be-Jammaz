import express from 'express';
import { SettingsController } from '../controllers/settingsController.js';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware.js';
import { routeHandler } from '../lib/route-handler.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/invoice-design', routeHandler(SettingsController.getInvoiceDesign));
router.put('/invoice-design', roleMiddleware(['owner', 'manager']), routeHandler(SettingsController.updateInvoiceDesign));

export default router;
