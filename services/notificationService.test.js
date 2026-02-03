/**
 * @jest-environment node
 */
import { NotificationService } from './notificationService.js';
import Notification from '../models/Notification.js';

// Mock the Mongoose models
jest.mock('../models/Notification', () => ({
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    updateMany: jest.fn(),
}));

jest.mock('../models/User', () => ({
    findById: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue({ role: 'admin' }),
}));

jest.mock('../lib/db', () => jest.fn()); // Mock dbConnect

describe('NotificationService Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('create with deduplication', () => {
        it('should create a notification if no duplicate exists', async () => {
            // Setup
            Notification.findOne.mockResolvedValue(null);
            Notification.create.mockResolvedValue({ _id: '123', title: 'Test' });

            // Execute
            const result = await NotificationService.create({
                title: 'Test Notification',
                message: 'Hello',
                deduplicationKey: 'key-1'
            });

            // Verify
            expect(Notification.findOne).toHaveBeenCalled(); // Checks deduplication
            expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Test Notification',
                metadata: {}
            }));
            expect(result).toEqual({ _id: '123', title: 'Test' });
        });

        it('should return null if duplicate exists', async () => {
            // Setup: findOne finds something
            Notification.findOne.mockResolvedValue({ _id: 'existing' });

            // Execute
            const result = await NotificationService.create({
                title: 'Test Notification',
                deduplicationKey: 'key-1'
            });

            // Verify
            expect(Notification.create).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });
    });

    describe('User Notifications', () => {
        it('should return paginated notifications', async () => {
            const mockNotifs = [{ title: 'A' }, { title: 'B' }];
            const mockFind = {
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(mockNotifs)
            };
            Notification.find.mockReturnValue(mockFind);
            Notification.countDocuments.mockResolvedValue(10); // total 10

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
                actionType: 'PAY'
            });

            expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({
                metadata: {
                    category: 'FINANCIAL',
                    actionType: 'PAY'
                }
            }));
        });
    });
});



