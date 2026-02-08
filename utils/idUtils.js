/**
 * Safely extracts a string ID from various formats
 * @param {any} input - String, ObjectId, or object with _id or id
 * @returns {string|null} - The ID string or null if invalid
 */
export const toIdString = (input) => {
    if (!input) return null;

    // If it's already a string
    if (typeof input === 'string') return input;

    // If it's a Mongoose ObjectId or has a toString method (like from lean())
    if (input._id) return input._id.toString();
    if (input.id) return input.id.toString();

    if (typeof input.toString === 'function') {
        const str = input.toString();
        // Check if it's the default [object Object] which is what we want to avoid
        if (str === '[object Object]') {
            // If it's an object but toString failed to give ID, it's not a valid ID
            return null;
        }
        return str;
    }

    return null;
};
