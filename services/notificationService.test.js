import { describe, it, expect, vi, beforeEach } from 'vitest';

const notificationMocks = vi.hoisted(() => ({
    create: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
    updateMany: vi.fn(),
}));

const userMocks = vi.hoisted(() => ({
    findById: vi.fn(),
}));

vi.mock('../models/Notification.js', () => ({ default: notificationMocks }));
vi.mock('../models/Product.js', () => ({ default: {} }));
vi.mock('../models/Invoice.js', () => ({ default: {} }));
vi.mock('../models/PurchaseOrder.js', () => ({ default: {} }));
vi.mock('../models/InvoiceSettings.js', () => ({ default: {} }));
vi.mock('../models/SystemMeta.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({
    default: { findById: userMocks.findById },
}));
vi.mock('../lib/db.js', () => ({ default: vi.fn() }));

const userMockChain = (role) => {
    const chain = { select: vi.fn().mockResolvedValue({ role }) };
    userMocks.findById.mockReturnValue(chain);
    return chain;
};

const { NotificationService } = await import('./notificationService.js');
const Notification = (await import('../models/Notification.js')).default;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('NotificationService Unit Tests', () => {
    describe('create with deduplication', () => {
        it('should create a notification if no duplicate exists', async () => {
            Notification.findOne.mockResolvedValue(null);
            Notification.create.mockResolvedValue({ _id: '123', title: 'Test' });

            const result = await NotificationService.create({
                title: 'Test Notification',
                message: 'Hello',
                deduplicationKey: 'key-1',
            });

            expect(Notification.findOne).toHaveBeenCalled();
            expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Test Notification',
                metadata: {},
            }));
            expect(result).toEqual({ _id: '123', title: 'Test' });
        });

        it('should return null if duplicate exists', async () => {
            Notification.findOne.mockResolvedValue({ _id: 'existing' });

            const result = await NotificationService.create({
                title: 'Test Notification',
                deduplicationKey: 'key-1',
            });

            expect(Notification.create).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });
    });

    describe('User Notifications', () => {
        it('should return paginated notifications for a manager', async () => {
            const mockNotifs = [{ title: 'A' }, { title: 'B' }];
            Notification.find.mockReturnValue({
                sort: vi.fn().mockReturnThis(),
                skip: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(mockNotifs),
            });
            Notification.countDocuments.mockResolvedValue(10);
            userMockChain('manager');

            const result = await NotificationService.getUserNotifications('user1', { limit: 2, page: 1 });

            expect(result.notifications).toEqual(mockNotifs);
            expect(result.pagination.total).toBe(10);
            expect(result.pagination.pages).toBe(5);
        });
    });

    describe('Legacy Mapping', () => {
        it('should map category and actionType to metadata', async () => {
            Notification.findOne.mockResolvedValue(null);
            Notification.create.mockResolvedValue({});

            await NotificationService.create({
                title: 'Legacy',
                category: 'FINANCIAL',
                actionType: 'PAY',
            });

            expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({
                metadata: {
                    category: 'FINANCIAL',
                    actionType: 'PAY',
                },
            }));
        });
    });
});
