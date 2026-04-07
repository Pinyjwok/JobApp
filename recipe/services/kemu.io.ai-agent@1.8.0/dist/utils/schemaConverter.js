import { getTypeScriptReader, getOpenApiWriter, makeConverter } from 'typeconv';
/**
 * Safely parses JSON
 */
export const safeJsonParse = (value) => {
    try {
        return JSON.parse(value);
    }
    catch (e) {
        return null;
    }
};
/**
 * Converts TypeScript types to JSON schema
 */
export const getSchemaFromTypes = async (types) => {
    const reader = getTypeScriptReader();
    const writer = getOpenApiWriter({ format: 'json', title: 'My API', version: 'v1', schemaVersion: '3.0.0' });
    const { convert } = makeConverter(reader, writer, { simplify: false });
    const prefix = 'export type Schema =';
    const { data } = await convert({
        data: !types.trim().startsWith(prefix) ? `${prefix} ${types}` : types,
    });
    return safeJsonParse(data);
};
/**
 * Validates and parses JSON schema directly
 */
export const parseJsonSchema = (jsonSchemaString) => {
    const parsed = safeJsonParse(jsonSchemaString);
    if (!parsed) {
        throw new Error('Invalid JSON format');
    }
    // Basic validation for JSON schema structure
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('JSON schema must be an object');
    }
    // Check for required properties in a valid JSON schema
    if (!parsed.type && !parsed.properties && !parsed.$ref) {
        throw new Error('JSON schema must have at least one of: type, properties, or $ref');
    }
    return parsed;
};
/**
 * Cleans up OpenAPI schema for OpenRouter compatibility
 */
export const cleanupOpenApiSchema = (schema, isRootObject = true) => {
    const cleaned = { ...schema };
    // Remove specified properties at current level
    if (isRootObject) {
        delete cleaned.title;
    }
    // delete cleaned.additionalProperties;
    // Recursively clean nested objects
    Object.entries(cleaned).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            cleaned[key] = value.map(item => typeof item === 'object' && item !== null ? cleanupOpenApiSchema(item) : item);
        }
        else if (typeof value === 'object' && value !== null) {
            cleaned[key] = cleanupOpenApiSchema(value, false);
        }
    });
    return cleaned;
};
//# sourceMappingURL=schemaConverter.js.map