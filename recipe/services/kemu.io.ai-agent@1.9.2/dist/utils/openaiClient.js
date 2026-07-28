import OpenAI from 'openai';
/**
 * Creates an OpenAI SDK client configured to talk to OpenRouter's OpenAI-compatible API.
 * This preserves current functionality (model slugs, plugins, provider routing) while
 * avoiding the beta OpenRouter SDK.
 *
 * @returns A configured OpenAI client instance
 */
export const createOpenRouterOpenAIClient = (config) => {
    const { apiKey, baseURL, httpReferer, xTitle, kemuApiKey } = config;
    return new OpenAI({
        apiKey,
        baseURL: baseURL ?? 'https://openrouter.ai/api/v1',
        defaultHeaders: {
            ...(httpReferer ? { 'HTTP-Referer': httpReferer } : {}),
            ...(xTitle ? { 'X-Title': xTitle } : {}),
            ...(kemuApiKey ? { 'kemu-api-key': kemuApiKey } : {}),
        },
    });
};
//# sourceMappingURL=openaiClient.js.map