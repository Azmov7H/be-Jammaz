import mongoose from 'mongoose';
import { hash } from 'bcryptjs';
import dotenv from 'dotenv';

const envFile = '.env.local';
const hasLocalEnv = await import('node:fs/promises').then(fs => fs.access(envFile).then(() => true).catch(() => false));

dotenv.config({ path: hasLocalEnv ? envFile : '.env' });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('Please define the MONGODB_URI environment variable inside .env or .env.local');
    process.exit(1);
}

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['owner', 'manager', 'cashier', 'warehouse', 'viewer'], default: 'cashier' },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', UserSchema);

async function createOwner() {
    try {
        const uri = MONGODB_URI.replace('localhost', '127.0.0.1');
        await mongoose.connect(uri);
        console.log('Connected to MongoDB');

        const email = 'admin@system.com';
        const password = 'password123';
        const name = 'System Owner';

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log('User already exists. Updating role to owner...');
            existingUser.role = 'owner';
            existingUser.password = await hash(password, 10);
            await existingUser.save();
            console.log('User updated successfully.');
        } else {
            console.log('Creating new owner user...');
            const hashedPassword = await hash(password, 10);
            await User.create({
                name,
                email,
                password: hashedPassword,
                role: 'owner',
                isActive: true
            });
            console.log('Owner user created successfully.');
        }

        console.log(`\nCredentials:\nEmail: ${email}\nPassword: ${password}\n`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
}

await createOwner();
