import { AGENT_SETTINGS_AI_REWRITE_MODEL } from '../constants.js';
const getFieldLabel = (field) => {
    switch (field) {
        case 'systemInstructions':
            return 'System Instructions';
        case 'query':
            return 'Default Query';
        case 'jsonFormat':
            return 'JSON Response Format';
        default:
            return field;
    }
};
const getFieldFormatRequirements = (context) => {
    if (context.field === 'systemInstructions') {
        return [
            'Return the result in markdown format unless the user specifically requests a different format.',
            'Generate examples when appropriate unless the user specifically requests not to.',
            'Return only the updated system instructions content.',
        ].join(' ');
    }
    if (context.field !== 'jsonFormat') {
        return 'Return plain text for this field only. Do not add wrappers, headings, code fences, or explanations.';
    }
    if (context.jsonSchemaMode === 'json-schema') {
        return 'Return only valid JSON Schema content for this field. Add JSDoc comments above each field unless the user specifically requests not to. Do not convert to TypeScript. Do not include markdown fences or explanations.';
    }
    return 'Return only a TypeScript type shape for this field. The response must begin directly with "{" and must not include a named type alias, interface name, or wrapper such as "type Example =". Add JSDoc comments above each field unless the user specifically requests not to. Do not convert to JSON Schema. Do not include markdown fences or explanations.';
};
/**
 * Builds the system prompt for agent settings field rewriting.
 *
 * @param context - Rewrite context for the invoked field.
 * @returns System instructions for the rewrite model.
 */
export const buildAgentFieldRewriteSystemPrompt = (context) => {
    return [
        'You help users write and refine configuration fields for an AI agent settings modal.',
        `You are editing only the "${getFieldLabel(context.field)}" field.`,
        'You may be aware that the settings modal also contains System Instructions, Default Query, and JSON Response Format fields.',
        'Only produce replacement content for the invoked field.',
        'Do not describe changes, ask follow up questions, or mention any other field in the output.',
        getFieldFormatRequirements(context),
    ].join('\n');
};
/**
 * Builds the user message for agent settings field rewriting.
 *
 * @param context - Rewrite context for the invoked field.
 * @returns User prompt content for the rewrite model.
 */
export const buildAgentFieldRewriteUserPrompt = (context) => {
    const otherFieldSummaries = [
        `System Instructions context: ${context.systemInstructions ?? ''}`,
        `Default Query context: ${context.query ?? ''}`,
        `JSON Response Format context: ${context.jsonFormat ?? ''}`,
    ].join('\n\n');
    return [
        `Invoked field: ${getFieldLabel(context.field)}`,
        context.field === 'jsonFormat'
            ? `JSON mode: ${context.jsonSchemaMode ?? 'typescript'}`
            : null,
        '',
        'Current field content:',
        context.currentContent || '(empty)',
        '',
        'Requested changes:',
        context.userPrompt,
        '',
        'Other field context for awareness only:',
        otherFieldSummaries,
        '',
        'Return only the full updated content for the invoked field.',
    ].filter(Boolean).join('\n');
};
/**
 * Removes markdown code fences if the model wraps the response.
 *
 * @param value - Raw model output.
 * @returns Cleaned field content.
 */
export const stripMarkdownFences = (value) => {
    const trimmed = value.trim();
    const fencedMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
    if (fencedMatch) {
        return fencedMatch[1].trim();
    }
    return trimmed;
};
/**
 * Attempts to parse a JSON string without throwing.
 *
 * @param value - Raw string value.
 * @returns Parsed JSON value when valid, otherwise null.
 */
const tryParseJson = (value) => {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
};
/**
 * Extracts a string from JSON-encoded string content while preserving JSON object text.
 *
 * @param value - Content string returned by the model.
 * @returns Unwrapped string when the content is a quoted JSON string, otherwise the original value.
 */
const unwrapJsonEncodedString = (value) => {
    const trimmed = value.trim();
    if (!trimmed.startsWith('"')) {
        return value;
    }
    const parsed = tryParseJson(trimmed);
    return typeof parsed === 'string' ? parsed : value;
};
/**
 * Extracts text content from OpenAI-compatible completion response shapes.
 *
 * @param response - Raw SDK response payload.
 * @returns Generated text content when present.
 */
const getCompletionText = (response) => {
    if (typeof response === 'string') {
        const parsedResponse = tryParseJson(response);
        if (parsedResponse !== null) {
            const parsedText = getCompletionText(parsedResponse);
            if (parsedText) {
                return parsedText;
            }
            return typeof parsedResponse === 'string' ? parsedResponse : response;
        }
        return response;
    }
    if (!response || typeof response !== 'object') {
        return null;
    }
    const responseRecord = response;
    const choices = responseRecord.choices;
    if (Array.isArray(choices) && choices.length > 0) {
        const firstChoice = choices[0];
        const message = firstChoice?.message;
        const content = message?.content;
        if (typeof content === 'string') {
            return unwrapJsonEncodedString(content);
        }
        if (Array.isArray(content)) {
            const text = content
                .map((item) => {
                if (!item || typeof item !== 'object') {
                    return '';
                }
                const part = item;
                return typeof part.text === 'string' ? part.text : '';
            })
                .filter(Boolean)
                .join('\n');
            if (text) {
                return text;
            }
        }
    }
    const output = responseRecord.output;
    if (Array.isArray(output) && output.length > 0) {
        const text = output
            .flatMap((item) => {
            if (!item || typeof item !== 'object') {
                return [];
            }
            const content = item.content;
            return Array.isArray(content) ? content : [];
        })
            .map((item) => {
            if (!item || typeof item !== 'object') {
                return '';
            }
            const part = item;
            return typeof part.text === 'string' ? part.text : '';
        })
            .filter(Boolean)
            .join('\n');
        if (text) {
            return text;
        }
    }
    return null;
};
/**
 * Generates replacement content for a single agent settings field.
 *
 * @param config - OpenAI client and rewrite context.
 * @returns Updated field content.
 */
export const generateAgentFieldRewrite = async (config) => {
    const { openai, context, signal } = config;
    const request = {
        model: AGENT_SETTINGS_AI_REWRITE_MODEL,
        stream: false,
        plugins: [{ id: 'web' }],
        reasoning_effort: 'medium',
        messages: [
            {
                role: 'system',
                content: buildAgentFieldRewriteSystemPrompt(context),
            },
            {
                role: 'user',
                content: buildAgentFieldRewriteUserPrompt(context),
            },
        ],
    };
    const response = await openai.chat.completions.create(request, {
        signal,
    });
    const content = getCompletionText(response);
    if (!content || !content.trim()) {
        throw new Error('The AI rewrite request returned an empty response.');
    }
    return stripMarkdownFences(content);
};
//# sourceMappingURL=agentFieldRewrite.js.map