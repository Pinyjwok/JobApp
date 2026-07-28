import { TOOL_ARGUMENT_DATA_TYPES, TOOL_ARGUMENT_TYPE_DEFINITION_MODES, TOOL_SETTINGS_AI_DEFINITION_MODEL, } from '../constants.js';
import { hasExplicitUrlRequest } from './urlIntent.js';
const TOOL_DEFINITION_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'description', 'timeout', 'arguments'],
    properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        timeout: {
            type: 'integer',
            minimum: 0,
        },
        arguments: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'description', 'dataType', 'required'],
                properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    dataType: {
                        type: 'string',
                        enum: TOOL_ARGUMENT_DATA_TYPES,
                    },
                    required: { type: 'boolean' },
                    typeDefinitionMode: {
                        type: 'string',
                        enum: TOOL_ARGUMENT_TYPE_DEFINITION_MODES,
                    },
                    typeDefinition: { type: 'string' },
                },
            },
        },
    },
};
/**
 * Checks whether a value is a plain object.
 *
 * @param value - Value to inspect.
 * @returns True when the value is a non-null object and not an array.
 */
const isObject = (value) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};
/**
 * Attempts to parse JSON text without throwing.
 *
 * @param value - Raw JSON string.
 * @returns Parsed value when valid, otherwise null.
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
 * Removes markdown code fences when a model wraps JSON output.
 *
 * @param value - Raw model output.
 * @returns Unfenced text.
 */
const stripMarkdownFences = (value) => {
    const trimmed = value.trim();
    const fencedMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
    if (fencedMatch) {
        return fencedMatch[1].trim();
    }
    return trimmed;
};
/**
 * Extracts text content from OpenAI-compatible completion responses.
 *
 * @param response - Raw SDK response.
 * @returns Completion text when available, otherwise null.
 */
const getCompletionText = (response) => {
    if (typeof response === 'string') {
        const parsed = tryParseJson(response);
        if (parsed !== null) {
            const parsedText = getCompletionText(parsed);
            if (parsedText) {
                return parsedText;
            }
            return typeof parsed === 'string' ? parsed : response;
        }
        return response;
    }
    if (!isObject(response)) {
        return null;
    }
    const choices = response.choices;
    if (Array.isArray(choices) && choices.length > 0) {
        const firstChoice = choices[0];
        if (isObject(firstChoice) && isObject(firstChoice.message)) {
            const content = firstChoice.message.content;
            if (typeof content === 'string') {
                return content;
            }
            if (Array.isArray(content)) {
                const text = content
                    .map((item) => {
                    if (!isObject(item)) {
                        return '';
                    }
                    return typeof item.text === 'string' ? item.text : '';
                })
                    .filter(Boolean)
                    .join('\n');
                if (text) {
                    return text;
                }
            }
        }
    }
    const output = response.output;
    if (Array.isArray(output) && output.length > 0) {
        const text = output
            .flatMap((item) => {
            if (!isObject(item)) {
                return [];
            }
            return Array.isArray(item.content) ? item.content : [];
        })
            .map((item) => {
            if (!isObject(item)) {
                return '';
            }
            return typeof item.text === 'string' ? item.text : '';
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
 * Returns true when the tool argument type is supported by the Tool settings UI.
 *
 * @param value - Candidate data type value.
 * @returns True when the value matches a supported type.
 */
const isSupportedToolArgumentDataType = (value) => {
    return (typeof value === 'string' &&
        TOOL_ARGUMENT_DATA_TYPES.includes(value));
};
/**
 * Returns true when the tool type definition mode is supported by the Tool settings UI.
 *
 * @param value - Candidate mode value.
 * @returns True when the value matches a supported mode.
 */
const isSupportedTypeDefinitionMode = (value) => {
    return (typeof value === 'string' &&
        TOOL_ARGUMENT_TYPE_DEFINITION_MODES.includes(value));
};
/**
 * Normalizes a required name field and rejects values with whitespace.
 *
 * @param value - Raw name value.
 * @param label - Error label for the field.
 * @returns Trimmed name.
 */
const normalizeName = (value, label) => {
    if (typeof value !== 'string') {
        throw new Error(`${label} is required.`);
    }
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        throw new Error(`${label} is required.`);
    }
    if (/\s/.test(normalizedValue)) {
        throw new Error(`${label} cannot contain spaces.`);
    }
    return normalizedValue;
};
/**
 * Normalizes a required string field.
 *
 * @param value - Raw string value.
 * @param label - Error label for the field.
 * @returns Trimmed string content.
 */
const normalizeRequiredText = (value, label) => {
    if (typeof value !== 'string') {
        throw new Error(`${label} is required.`);
    }
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        throw new Error(`${label} is required.`);
    }
    return normalizedValue;
};
/**
 * Normalizes the tool timeout to a non-negative integer.
 *
 * @param value - Raw timeout value.
 * @returns Normalized timeout in seconds.
 */
const normalizeTimeout = (value) => {
    if (value === undefined || value === null || value === '') {
        return 0;
    }
    const normalizedValue = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
        throw new Error('Tool timeout must be a non-negative number.');
    }
    return Math.floor(normalizedValue);
};
/**
 * Normalizes one tool argument from AI output into the UI state shape.
 *
 * @param value - Raw argument value.
 * @param index - Argument index for error messages.
 * @returns Normalized tool argument.
 */
const normalizeToolArgument = (value, index) => {
    if (!isObject(value)) {
        throw new Error(`Argument ${index + 1} is invalid.`);
    }
    const dataType = value.dataType;
    if (!isSupportedToolArgumentDataType(dataType)) {
        throw new Error(`Argument ${index + 1} has an unsupported data type.`);
    }
    const isComplexType = dataType === 'JsonObj' || dataType === 'Array';
    const typeDefinition = isComplexType && typeof value.typeDefinition === 'string'
        ? value.typeDefinition.trim()
        : '';
    const typeDefinitionMode = isComplexType
        ? isSupportedTypeDefinitionMode(value.typeDefinitionMode)
            ? value.typeDefinitionMode
            : 'typescript'
        : undefined;
    return {
        name: normalizeName(value.name, `Argument ${index + 1} name`),
        description: normalizeRequiredText(value.description, `Argument ${index + 1} description`),
        dataType,
        required: typeof value.required === 'boolean' ? value.required : true,
        typeDefinitionMode,
        typeDefinition: isComplexType && typeDefinition ? typeDefinition : undefined,
    };
};
/**
 * Normalizes and validates a full AI-generated tool draft.
 *
 * @param draft - Raw tool draft returned by the model.
 * @returns Tool state safe to apply in the UI.
 */
export const normalizeToolDefinitionDraft = (draft) => {
    if (!isObject(draft)) {
        throw new Error('Tool definition response is invalid.');
    }
    if (!Array.isArray(draft.arguments)) {
        throw new Error('Tool definition arguments must be an array.');
    }
    const normalizedArguments = draft.arguments.map((argument, index) => normalizeToolArgument(argument, index));
    const argumentNames = new Set();
    for (const argument of normalizedArguments) {
        if (argumentNames.has(argument.name)) {
            throw new Error(`Argument name "${argument.name}" is duplicated.`);
        }
        argumentNames.add(argument.name);
    }
    return {
        name: normalizeName(draft.name, 'Tool name'),
        description: normalizeRequiredText(draft.description, 'Tool description'),
        timeout: normalizeTimeout(draft.timeout),
        arguments: normalizedArguments,
    };
};
/**
 * Builds the system prompt used for AI-assisted tool definition generation.
 *
 * @returns System prompt text.
 */
export const buildToolDefinitionSystemPrompt = (userPrompt) => {
    const urlPolicy = hasExplicitUrlRequest(userPrompt)
        ? 'Include URLs or links only when they are directly relevant to the requested changes.'
        : 'Do not include URLs, links, references, or citations unless the user explicitly asks for them.';
    return [
        'You help users define tools for an AI agent settings modal.',
        'Return the final desired tool configuration only as structured JSON.',
        'You may keep, remove, modify, or add arguments, but you must return the full final tool definition rather than incremental patches.',
        'Tool names and argument names are required, must be non-empty, and must not contain spaces.',
        `Only use these supported argument dataType values: ${TOOL_ARGUMENT_DATA_TYPES.join(', ')}.`,
        'Only use typeDefinitionMode for JsonObj or Array arguments.',
        `When typeDefinitionMode is present, only use: ${TOOL_ARGUMENT_TYPE_DEFINITION_MODES.join(', ')}.`,
        'Use typeDefinition only for JsonObj or Array arguments.',
        'Always include name, description, timeout, and arguments.',
        'Descriptions must be concise, explicit, and ready for production use.',
        'Preserve valid existing names unless the user requests a rename or a clearer name is necessary.',
        urlPolicy,
        'Do not include explanations, markdown fences, or extra wrapper text.',
    ].join('\n');
};
/**
 * Builds the user prompt with the current tool state and requested changes.
 *
 * @param request - Tool AI request context.
 * @returns User prompt text.
 */
export const buildToolDefinitionUserPrompt = (request) => {
    return [
        'Current tool definition:',
        JSON.stringify(request.currentTool, null, 2),
        '',
        'Requested changes:',
        request.userPrompt,
        '',
        'Return the full final tool definition.',
    ].join('\n');
};
/**
 * Generates an AI-authored tool definition draft using structured output.
 *
 * @param config - OpenAI client, request context, and optional abort signal.
 * @returns Parsed tool definition draft.
 */
export const generateToolDefinitionDraft = async (config) => {
    const { openai, request, signal } = config;
    const completionRequest = {
        model: TOOL_SETTINGS_AI_DEFINITION_MODEL,
        stream: false,
        reasoning_effort: 'medium',
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'tool_definition',
                schema: TOOL_DEFINITION_RESPONSE_SCHEMA,
            },
        },
        messages: [
            {
                role: 'system',
                content: buildToolDefinitionSystemPrompt(request.userPrompt),
            },
            {
                role: 'user',
                content: buildToolDefinitionUserPrompt(request),
            },
        ],
    };
    const response = await openai.chat.completions.create(completionRequest, { signal });
    const content = getCompletionText(response);
    if (!content || !content.trim()) {
        throw new Error('The AI tool definition request returned an empty response.');
    }
    const parsedResponse = tryParseJson(stripMarkdownFences(content));
    if (parsedResponse === null) {
        throw new Error('The AI tool definition response was not valid JSON.');
    }
    return normalizeToolDefinitionDraft(parsedResponse);
};
//# sourceMappingURL=toolDefinitionAi.js.map