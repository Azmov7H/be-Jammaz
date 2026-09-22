import { SignJWT, jwtVerify } from 'jose';

if (!process.env.JWT_SECRET) {
    throw new Error('Please define the JWT_SECRET environment variable inside .env');
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
// T-AUTH-02: access tokens; refresh handled via RefreshToken model.
// ACCESS_TOKEN_TTL wins over the legacy JWT_EXPIRES_IN name.
const JWT_EXPIRES_IN = process.env.ACCESS_TOKEN_TTL || process.env.JWT_EXPIRES_IN || '15m';

/**
 * Parse a jose-style duration string ("15m", "3d", "1w", "500ms") into
 * milliseconds. Numbers are treated as seconds. Returns null when unparseable.
 */
export function parseDuration(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') return value * 1000;
    const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/i);
    if (!match) return null;
    const n = parseFloat(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
    return n * multipliers[unit];
}

// Cookie lifetime for the access token: keep the browser cookie alive as long
// as the JWT itself, so the session lasts the full configured TTL.
export const JWT_EXPIRES_IN_MS = parseDuration(JWT_EXPIRES_IN) || 15 * 60 * 1000;

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



