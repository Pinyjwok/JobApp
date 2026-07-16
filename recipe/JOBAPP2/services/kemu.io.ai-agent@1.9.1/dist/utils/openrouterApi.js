/**
 * Checks whether a value is a plain object.
 *
 * @returns true if value is a non-null object (but not an array), false otherwise
 */
const isObject = (value) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};
/**
 * Reads an unknown value as a string, returning undefined when not a string.
 *
 * @returns the string value or undefined
 */
const asString = (value) => {
    return typeof value === 'string' ? value : undefined;
};
/**
 * Reads an unknown value as a number, returning undefined when not a number.
 *
 * @returns the number value or undefined
 */
const asNumber = (value) => {
    return typeof value === 'number' ? value : undefined;
};
/**
 * Reads an unknown value as an array of strings, returning undefined when invalid.
 *
 * @returns an array of strings or undefined
 */
const asStringArray = (value) => {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const result = [];
    for (const v of value) {
        if (typeof v !== 'string') {
            return undefined;
        }
        result.push(v);
    }
    return result;
};
/**
 * Builds standard headers for OpenRouter API calls.
 *
 * @returns Headers object for OpenRouter requests
 */
const buildHeaders = (config) => {
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${config.apiKey}`);
    headers.set('Content-Type', 'application/json');
    if (config.httpReferer) {
        headers.set('HTTP-Referer', config.httpReferer);
    }
    if (config.xTitle) {
        headers.set('X-Title', config.xTitle);
    }
    if (config.kemuApiKey) {
        headers.set('kemu-api-key', config.kemuApiKey);
    }
    return headers;
};
/**
 * Fetches JSON from OpenRouter and returns the decoded payload.
 *
 * @returns unknown JSON payload
 */
const fetchOpenRouterJson = async (path, config) => {
    const baseURL = config.baseURL ?? 'https://openrouter.ai/api/v1';
    const url = `${baseURL}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(config),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenRouter request failed (${res.status}) ${text}`);
    }
    return (await res.json());
};
const normalizeArchitecture = (value) => {
    if (!isObject(value)) {
        return undefined;
    }
    const inputModalities = asStringArray(value.inputModalities) ?? asStringArray(value.input_modalities);
    const outputModalities = asStringArray(value.outputModalities) ?? asStringArray(value.output_modalities);
    const modality = asString(value.modality);
    return {
        inputModalities: inputModalities ?? null,
        outputModalities: outputModalities ?? null,
        modality: modality ?? null,
    };
};
const normalizeTopProvider = (value) => {
    if (!isObject(value)) {
        return undefined;
    }
    const maxCompletionTokens = asNumber(value.maxCompletionTokens) ?? asNumber(value.max_completion_tokens);
    return {
        maxCompletionTokens: maxCompletionTokens ?? null,
    };
};
const normalizePricing = (value) => {
    if (!isObject(value)) {
        return undefined;
    }
    const prompt = asString(value.prompt);
    const completion = asString(value.completion);
    return {
        prompt: prompt ?? null,
        completion: completion ?? null,
    };
};
const normalizeModel = (value) => {
    if (!isObject(value)) {
        throw new Error('OpenRouter model item is not an object');
    }
    const id = asString(value.id);
    const canonicalSlug = asString(value.canonicalSlug) ?? asString(value.canonical_slug);
    if (!id || !canonicalSlug) {
        throw new Error('OpenRouter model item missing required fields (id, canonical_slug)');
    }
    const name = asString(value.name) ?? null;
    const description = asString(value.description) ?? null;
    const contextLength = asNumber(value.contextLength) ?? asNumber(value.context_length) ?? null;
    const supportedParameters = asStringArray(value.supportedParameters) ?? asStringArray(value.supported_parameters) ?? null;
    return {
        id,
        canonicalSlug,
        name,
        description,
        architecture: normalizeArchitecture(value.architecture) ?? null,
        pricing: normalizePricing(value.pricing) ?? null,
        contextLength,
        topProvider: normalizeTopProvider(value.topProvider ?? value.top_provider) ?? null,
        supportedParameters,
    };
};
const normalizeProvider = (value) => {
    if (!isObject(value)) {
        throw new Error('OpenRouter provider item is not an object');
    }
    return {
        id: asString(value.id),
        slug: asString(value.slug),
        name: asString(value.name),
    };
};
/**
 * Fetches available models from OpenRouter REST API.
 *
 * @returns Array of normalized OpenRouter models
 */
export const fetchOpenRouterModels = async (config) => {
    const payload = await fetchOpenRouterJson('/models', config);
    if (!isObject(payload)) {
        throw new Error('OpenRouter /models response is not an object');
    }
    const data = payload.data;
    if (!Array.isArray(data)) {
        throw new Error('OpenRouter /models response missing data array');
    }
    return data.map(normalizeModel);
};
/**
 * Fetches available providers from OpenRouter REST API.
 *
 * @returns Array of normalized OpenRouter providers
 */
export const fetchOpenRouterProviders = async (config) => {
    const payload = await fetchOpenRouterJson('/providers', config);
    if (!isObject(payload)) {
        throw new Error('OpenRouter /providers response is not an object');
    }
    const data = payload.data;
    if (!Array.isArray(data)) {
        throw new Error('OpenRouter /providers response missing data array');
    }
    return data.map(normalizeProvider);
};
//# sourceMappingURL=openrouterApi.js.map