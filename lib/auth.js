import { SignJWT, jwtVerify } from 'jose';

if (!process.env.JWT_SECRET) {
    throw new Error('Please define the JWT_SECRET environment variable inside .env');
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

/**
 * Sign a JWT token with the user payload
 */
export async function signToken(payload) {
    const jwt = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(JWT_EXPIRES_IN)
        .sign(JWT_SECRET);
    return jwt;
}

/**
 * Verify a JWT token
 */
export async function verifyToken(token) {
    try {
        if (!token) return null;
        const { payload } = await jwtVerify(token, JWT_SECRET);
        return payload;
    } catch (error) {
        return null;
    }
}



