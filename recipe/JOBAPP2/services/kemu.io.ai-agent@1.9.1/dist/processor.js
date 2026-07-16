import createService, { DataType, createImageDataLike } from '@kemu-io/hs';
import { ImageData, createCanvas, loadImage } from '@napi-rs/canvas';
import { safeJsonParse, getSchemaFromTypes, parseJsonSchema, cleanupOpenApiSchema } from './utils/schemaConverter.js';
import { getDefaultAgentServiceState, getPlatformProxyUrl } from './constants.js';
import { createOpenRouterOpenAIClient } from './utils/openaiClient.js';
import { fetchOpenRouterModels, fetchOpenRouterProviders } from './utils/openrouterApi.js';
import { generateAgentFieldRewrite } from './utils/agentFieldRewrite.js';
import { generateToolDefinitionDraft } from './utils/toolDefinitionAi.js';
import { handleToolParentEvent, handleSubmitParentEvent, handleHistoryParentEvent } from './eventHandlers/index.js';
import { registerToolEvent, terminateToolInstance } from './eventHandlers/toolHandler.js';
import { terminateHistoryInstance, registerHistoryEvent } from './eventHandlers/historyHandler.js';
import { publishChatEvent, getChatEvents, clearChatEvents } from './eventHandlers/chatEventBus.js';
import { createId } from '@paralleldrive/cuid2';
import toolRegistry from './eventHandlers/toolRegistry.js';
import historyRegistry from './eventHandlers/historyRegistry.js';
const service = new createService();
await service.start();
const canvas = createCanvas(512, 512);
const ctx = canvas.getContext('2d');
const VIDEO_MIME_TYPES = ['video/mp4', 'video/mpeg', 'video/webm', 'video/mov'];
const VIDEO_FILE_EXTENSIONS = ['.mp4', '.mpeg', '.webm', '.mov'];
const OPENROUTER_API_KEY_SECRET_NAME = 'OPENROUTER_API_KEY';
const MODELS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const agentInstanceMap = {};
const widgetInstanceMap = new Map();
const settingsAiAbortControllerMap = new Map();
const NEW_QUERY_ABORT_REASON = 'NEW_QUERY';
const USER_ABORT_REASON = 'USER_ABORT';
const generateHistorySessionId = () => {
    return `history_${createId()}`;
};
/**
 * Extract routing metadata from an eventContext object.
 * @param eventContext - Event context from the engine.
 * @returns Routing info if present, otherwise null.
 */
const getChatRoutingFromEventContext = (eventContext) => {
    if (!eventContext || typeof eventContext !== 'object') {
        return null;
    }
    const ctx = eventContext;
    if (typeof ctx.chatWidgetId !== 'string' || typeof ctx.invocationId !== 'string') {
        return null;
    }
    return { chatWidgetId: ctx.chatWidgetId, invocationId: ctx.invocationId };
};
/**
 * Publish an Agent-related event to the ChatInterface event bus, if routing is active.
 * @param config - Publish config.
 * @returns void
 */
const publishAgentChatEvent = (config) => {
    const { recipeUuid, instance, type, payload } = config;
    if (!instance.activeChatWidgetId || !instance.activeInvocationId) {
        return;
    }
    publishChatEvent({
        recipeUuid,
        chatWidgetId: instance.activeChatWidgetId,
        invocationId: instance.activeInvocationId,
        type,
        payload,
    });
};
/**
 * Validates and processes the config object from the config port
 */
export const validateAndProcessConfig = async (options) => {
    const { configData, configType, defaultQuery, defaultSystemInstructions, widgetId } = options;
    /**
     * Extracts a plain string from values that may be a string primitive or String object.
     */
    const getStringValue = (value) => {
        if (typeof value === 'string') {
            return value;
        }
        return undefined;
    };
    const stringConfigInput = configType === DataType.String ? getStringValue(configData) : undefined;
    const isStringConfigEvent = stringConfigInput !== undefined;
    let config;
    // Allow invoking the widget with a boolean value, only valid when system instructions and query are configured via state.
    if (configData === true) {
        config = {};
    }
    else if (isStringConfigEvent) {
        config = {};
    }
    else {
        // Validate that config is an object
        if (!configData || Array.isArray(configData) || typeof configData !== 'object') {
            throw new Error('Config must be a valid object');
        }
        config = configData;
    }
    const finalSystemInstructions = config.systemInstructions || defaultSystemInstructions;
    const finalQuery = config.query || defaultQuery || stringConfigInput;
    // Track which values came from config vs defaults (only parse expressions for defaults)
    const systemInstructionsFromConfig = config.systemInstructions !== undefined;
    const queryFromConfig = !!config.query;
    // Validate that at least one required property is provided
    if ((!finalQuery) && !config.attachments && !finalSystemInstructions) {
        throw new Error('Config must contain at least one of: query, attachments, or systemInstructions');
    }
    const processedConfig = { query: '' };
    // Process query
    if (finalQuery !== undefined) {
        if (typeof finalQuery !== 'string') {
            throw new Error('Config.query must be a string');
        }
        processedConfig.query = finalQuery;
    }
    // Process attachments
    if (config.attachments !== undefined) {
        // Handle both single attachment and array of attachments
        const attachmentsArray = Array.isArray(config.attachments) ? config.attachments : [config.attachments];
        processedConfig.attachments = attachmentsArray;
    }
    // Process sessionId
    if (config.sessionId !== undefined) {
        if (config.sessionId !== null && typeof config.sessionId !== 'string') {
            throw new Error('Config.sessionId must be a string or null');
        }
        processedConfig.sessionId = config.sessionId || null;
    }
    // Process systemInstructions
    if (finalSystemInstructions !== undefined) {
        if (typeof finalSystemInstructions !== 'string') {
            throw new Error('Config.systemInstructions must be a string');
        }
        processedConfig.systemInstructions = finalSystemInstructions;
    }
    // Allow event config to be any type as long as final config contains both system instructions and query.
    if (!processedConfig.query && !processedConfig.systemInstructions && !processedConfig.attachments) {
        throw new Error('Config must contain at least one of: query, systemInstructions, or attachments');
    }
    // Only parse expressions for values that came from defaults, not from configData
    const expressionsToParse = [];
    let instructionsIndex = -1;
    let queryIndex = -1;
    const context = { input: configData };
    if (!systemInstructionsFromConfig && processedConfig.systemInstructions) {
        instructionsIndex = expressionsToParse.length;
        expressionsToParse.push({ text: processedConfig.systemInstructions, context });
    }
    if (!queryFromConfig && processedConfig.query) {
        queryIndex = expressionsToParse.length;
        expressionsToParse.push({ text: processedConfig.query, context });
    }
    // Only call parseExpressions if there are expressions from defaults to parse
    if (expressionsToParse.length > 0) {
        const parsedExpressions = await service.helpers.parseExpressions({
            widgetId,
            expressions: expressionsToParse
        });
        // Update only the values that came from defaults
        if (instructionsIndex >= 0) {
            processedConfig.systemInstructions = parsedExpressions[instructionsIndex];
        }
        if (queryIndex >= 0) {
            processedConfig.query = parsedExpressions[queryIndex];
        }
    }
    return processedConfig;
};
/**
 * Gets or creates an OpenRouter instance for a recipe
 * Uses platform proxy when no API key is configured
 * Detects API key changes and invalidates cache when secret mapping changes
 */
const getOpenRouterInstance = async (recipeUuid) => {
    const existingInstance = agentInstanceMap[recipeUuid];
    // Always read current secret to detect changes
    const secrets = await service.secrets.read({ names: [OPENROUTER_API_KEY_SECRET_NAME], recipeUuid });
    const currentApiKey = secrets[OPENROUTER_API_KEY_SECRET_NAME];
    const effectiveCurrentApiKey = currentApiKey || '';
    // If instance exists, check if API key has changed
    if (existingInstance) {
        const apiKeyChanged = existingInstance.apiKey !== effectiveCurrentApiKey;
        // Determine if we need to recreate the instance
        const needsRecreation = !existingInstance.apiKeyValid || apiKeyChanged;
        if (!needsRecreation) {
            // Reuse cached instance (performance optimization)
            return existingInstance.openrouter;
        }
        // API key changed or instance is invalid - log and recreate
        if (apiKeyChanged) {
            console.log(`[${recipeUuid}] API key changed, invalidating cache and recreating instance`);
        }
    }
    // Create or recreate instance with current API key
    // Use platform proxy when no API key is configured
    let baseURL;
    // Use empty string when using proxy (proxy ignores it and uses internal key)
    const effectiveApiKey = currentApiKey || '';
    // Get Kemu API key for platform proxy authentication
    let kemuApiKey;
    if (!currentApiKey) {
        console.log(`[${recipeUuid}] No OpenRouter API key found, getting hub config`);
        try {
            const hubConfig = await service.getHubConfig();
            kemuApiKey = hubConfig?.kemuApiKey;
            baseURL = getPlatformProxyUrl(hubConfig?.environment || 'production');
            if (!kemuApiKey) {
                console.warn(`[${recipeUuid}] No kemuApiKey found in hub config, proxy requests may fail authentication`);
            }
        }
        catch (error) {
            console.error(`[${recipeUuid}] Failed to get hub config:`, error);
        }
    }
    agentInstanceMap[recipeUuid] = {
        apiKey: effectiveApiKey,
        // We don't know at this point
        apiKeyValid: false,
        baseURL,
        kemuApiKey,
        openrouter: createOpenRouterOpenAIClient({
            apiKey: effectiveApiKey,
            baseURL,
            httpReferer: 'https://app.kemu.io',
            xTitle: 'Kemu AI Agent Service',
            kemuApiKey,
        }),
    };
    return agentInstanceMap[recipeUuid].openrouter;
};
/**
 * Creates or returns an existing widget instance
 */
const getInstance = (recipeUuid, widgetId) => {
    const key = `${recipeUuid}_${widgetId}`;
    let instance = widgetInstanceMap.get(key);
    if (!instance) {
        instance = {
            attachments: [],
            lastUsed: Date.now(),
            model: 'GPT-4o Mini',
            abortController: new AbortController(),
            recipeUuid,
            widgetId,
            conversationHistory: [],
            sessionId: generateHistorySessionId(),
        };
        widgetInstanceMap.set(key, instance);
    }
    instance.lastUsed = Date.now();
    return instance;
};
/**
 * Flushes all instances that belong to a given recipe UUID
 */
const flushInstancesByRecipeUuid = (recipeUuid) => {
    const instances = widgetInstanceMap.keys();
    for (const key of instances) {
        const instance = widgetInstanceMap.get(key);
        if (!instance) {
            continue;
        }
        if (instance.recipeUuid === recipeUuid) {
            instance.abortController.abort();
            widgetInstanceMap.delete(key);
        }
    }
};
const isImageData = (value) => {
    return !!value
        && typeof value === 'object'
        && 'width' in value
        && 'height' in value
        && 'data' in value
        && ((value.data instanceof ArrayBuffer) || (value.data instanceof Uint8ClampedArray));
};
/**
 * Converts an ImageData to a buffer
 */
const imageToBuffer = (image) => {
    if (image.width !== canvas.width) {
        canvas.width = image.width;
    }
    if (image.height !== canvas.height) {
        canvas.height = image.height;
    }
    const imgData = new ImageData(image.data, image.width, image.height);
    ctx.putImageData(imgData, 0, 0);
    // Get the jpg image data
    const imgBuffer = canvas.toBuffer('image/jpeg');
    return imgBuffer.buffer;
};
/**
 * Converts a base64 data URL to ImageData using napi-rs/canvas
 */
const base64ToImageData = async (dataUrl) => {
    try {
        // Extract base64 data from data URL
        let base64Data;
        if (dataUrl.startsWith('data:')) {
            // Extract base64 part from data URL (e.g., "data:image/png;base64,iVBORw0KGgo...")
            const base64Index = dataUrl.indexOf(',');
            if (base64Index === -1) {
                throw new Error('Invalid data URL format');
            }
            base64Data = dataUrl.substring(base64Index + 1);
        }
        else {
            // Assume it's already base64 encoded
            base64Data = dataUrl;
        }
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(base64Data, 'base64');
        // Load image using napi-rs/canvas loadImage function
        const img = await loadImage(imageBuffer);
        // Create canvas with image dimensions
        const tempCanvas = createCanvas(img.width, img.height);
        const tempCtx = tempCanvas.getContext('2d');
        // Draw image to canvas
        tempCtx.drawImage(img, 0, 0);
        // Get ImageData from canvas
        const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
        return imageData;
    }
    catch (error) {
        console.error('Failed to convert base64 to ImageData:', error);
        throw new Error(`Failed to convert image data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};
/**
 * Checks if a string is a valid base64 string
 */
const isBase64 = (value) => {
    const base64RegExp = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
    return base64RegExp.test(value);
};
/**
 * Checks if a string is a valid URL
 */
const isValidUrl = (url) => {
    try {
        return typeof url === 'string' && new URL(url);
    }
    catch (e) {
        return false;
    }
};
/**
 * Checks if a value has MIME type properties
 */
const isMimeTypedValue = (value) => {
    return typeof value === 'object'
        && value !== null
        && 'format' in value
        && 'data' in value
        && typeof value.format === 'string'
        && value.data instanceof ArrayBuffer;
};
/**
 * Fixes invalid MIME types not allowed by OpenAI/OpenRouter
 */
const fixInvalidMimeType = (value) => {
    const bypassed = ['application/javascript', 'application/json', 'application/typescript', 'application/x-typescript'];
    if (bypassed.includes(value.toLowerCase())) {
        return 'text/plain';
    }
    return value;
};
/**
 * Checks if the given file or string is a PDF attachment
 * @returns true if the attachment is a PDF, false otherwise
 */
const isPdfAttachment = (attachment) => {
    const isUrl = isValidUrl(attachment);
    const fileAttachment = attachment;
    const stringAttachment = attachment;
    if (isUrl) {
        const isPdf = stringAttachment?.endsWith('.pdf');
        return isPdf;
    }
    else if (fileAttachment?.format) {
        const mimeType = fixInvalidMimeType(fileAttachment.format);
        if (mimeType === 'application/pdf') {
            return true;
        }
    }
    return false;
};
/**
 * Converts attachments to OpenRouter message content format
 */
const attachmentToMessageContent = (attachments) => {
    if (!attachments?.length) {
        return [];
    }
    return attachments.map((attachment, index) => {
        const isUrl = isValidUrl(attachment);
        if (isUrl) {
            const stringAttachment = String(attachment);
            const isPdf = stringAttachment?.endsWith('.pdf');
            if (isPdf) {
                return {
                    type: 'file',
                    file: {
                        filename: getFileNameFromUrl(stringAttachment),
                        file_data: stringAttachment,
                    },
                };
            }
            const isVideo = VIDEO_FILE_EXTENSIONS.some(extension => stringAttachment.toLowerCase().endsWith(extension.toLowerCase()))
                || /^https:\/\/(www\.)?youtube\./.test(stringAttachment);
            if (isVideo) {
                return {
                    type: 'video_url',
                    video_url: {
                        url: stringAttachment.trim()
                    },
                };
            }
            return {
                type: 'image_url',
                image_url: {
                    url: stringAttachment.trim(),
                },
            };
        }
        if (typeof attachment === 'string') {
            return {
                type: 'text',
                text: attachment,
            };
        }
        const file = attachment;
        const mimeType = fixInvalidMimeType(file.format);
        // Handle images (including converted ImageData)
        if (mimeType.startsWith('image/')) {
            return {
                type: 'image_url',
                image_url: {
                    url: fileToBase64DataUrl(file),
                },
            };
        }
        // Handle PDF files using OpenRouter's file format
        if (mimeType === 'application/pdf') {
            return {
                type: 'file',
                file: {
                    filename: generateFileName(file, mimeType, index),
                    file_data: fileToBase64DataUrl(file),
                },
            };
        }
        // Handle audio files using OpenRouter's file format (WAV and MP3)
        if (mimeType === 'audio/wav' || mimeType === 'audio/wave' || mimeType === 'audio/mp3' || mimeType === 'audio/mpeg') {
            const format = mimeType.includes('mp3') || mimeType.includes('mpeg') ? 'mp3' : 'wav';
            return {
                type: 'input_audio',
                input_audio: {
                    format: format,
                    data: fileToBase64String(file),
                },
            };
        }
        // Handle text files and plain text as text content
        if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/javascript') {
            return {
                type: 'text',
                text: `[File: ${mimeType}]\n${Buffer.from(file.data).toString('utf-8')}`,
            };
        }
        // Handle video files using OpenRouter's file format
        if (VIDEO_MIME_TYPES.includes(mimeType)) {
            return {
                type: 'video_url',
                video_url: {
                    url: fileToBase64DataUrl(file),
                },
            };
        }
        // Supported MIME types for OpenRouter
        const supportedMimeTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'video/mp4',
            'audio/wav', 'audio/wave', 'audio/mp3', 'audio/mpeg',
            'text/plain', 'text/html', 'text/css', 'text/javascript',
            'application/json', 'application/javascript',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (!supportedMimeTypes.includes(mimeType.toLowerCase())) {
            throw new Error(`Unsupported media type: ${mimeType}. Supported types: ${supportedMimeTypes.join(', ')}`);
        }
        // Handle other binary files as text description
        return {
            type: 'text',
            text: `[Binary File: ${mimeType}, Size: ${file.data.byteLength} bytes]`,
        };
    }).filter(Boolean);
};
/**
 * Converts a base64-encoded string to a BinaryFile object
 * Note: Assumes JPEG format - the format is hardcoded to 'image/jpeg' regardless of the actual image type
 * @param value - Base64-encoded string to convert
 * @returns BinaryFile object with decoded binary data
 */
const base64StringToBinaryFile = (value) => {
    return {
        format: 'image/jpeg',
        data: Buffer.from(value, 'base64').buffer
    };
};
/**
 * Converts an ImageData object to a BinaryFile object
 * @param value - ImageData object to convert
 * @returns BinaryFile object with decoded binary data
 */
const imageDataToBinaryFile = (value) => {
    return {
        format: 'image/jpeg',
        data: imageToBuffer(value)
    };
};
/**
 * Converts file data to base64 string
 * @param file
 * @returns
 */
const fileToBase64String = (file) => {
    return Buffer.from(file.data).toString('base64');
};
/**
 * Converts file data to base64 data URL
 */
const fileToBase64DataUrl = (file) => {
    const base64Data = fileToBase64String(file);
    return `data:${file.format};base64,${base64Data}`;
};
/**
 * Extracts the filename from a URL, preserving the extension
 * @param url - The URL to extract the filename from
 * @returns The filename with extension, or a fallback filename if none found
 */
const getFileNameFromUrl = (url) => {
    try {
        const urlObj = new URL(url);
        // Get the last segment of the pathname (the filename)
        const pathSegments = urlObj.pathname.split('/').filter(segment => segment.length > 0);
        let fileName = pathSegments[pathSegments.length - 1] || '';
        // If no filename found in pathname, use hostname as fallback
        if (!fileName) {
            fileName = urlObj.hostname.replace(/^www\./, '') || 'file';
        }
        // Decode URL-encoded characters (e.g., %20 -> space)
        fileName = decodeURIComponent(fileName);
        // Sanitize filename: keep alphanumeric, dots, hyphens, underscores, and spaces
        // Replace invalid filename characters with underscore
        // eslint-disable-next-line no-control-regex
        fileName = fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
        // If after sanitization we have nothing, use fallback
        if (!fileName || fileName === '_') {
            fileName = 'file';
        }
        return fileName;
    }
    catch (error) {
        // If URL parsing fails, return a safe fallback
        console.error('Failed to get filename from URL, using fallback:', error);
        return 'file';
    }
};
/**
 * Generates filename for attachment using BinaryFile.fileName or fallback with index
 */
const generateFileName = (file, mimeType, index) => {
    // Use fileName from BinaryFile if available
    if (file.fileName && file.fileName.trim().length > 0) {
        return file.fileName;
    }
    // Generate filename based on MIME type with index fallback
    if (mimeType === 'application/pdf') {
        return `document_${index}.pdf`;
    }
    if (mimeType === 'audio/wav' || mimeType === 'audio/wave') {
        return `audio_${index}.wav`;
    }
    if (mimeType === 'audio/mp3' || mimeType === 'audio/mpeg') {
        return `audio_${index}.mp3`;
    }
    if (mimeType === 'video/mp4') {
        return `video_${index}.mp4`;
    }
    if (mimeType.startsWith('image/')) {
        const extension = mimeType.split('/')[1] || 'jpg';
        return `image_${index}.${extension}`;
    }
    // Default fallback
    return `file_${index}`;
};
/**
 * Generates plugins configuration for OpenRouter file processing and web search
 */
const generatePluginsConfig = (attachments, fileParser = 'pdf-text', webSearch = false) => {
    const plugins = [];
    // Add file parser plugin if we have PDF files
    if (attachments?.length) {
        const hasPdfFiles = attachments.some(isPdfAttachment);
        if (hasPdfFiles) {
            plugins.push({
                id: 'file-parser',
                pdf: {
                    engine: fileParser,
                },
            });
        }
    }
    // Add web search plugin if enabled
    if (webSearch) {
        plugins.push({
            id: 'web',
        });
    }
    return plugins.length > 0 ? plugins : undefined;
};
/**
 * Builds conversation history by retrieving it from history variants
 */
const getConversationHistory = async (context, instance) => {
    try {
        // Discover history variants linked to this agent
        const historyDiscovery = await discoverHistoryVariants(context);
        if (!historyDiscovery) {
            return [];
        }
        // Retrieve conversation history for the current session
        const conversationHistory = await retrieveConversationHistory(context, historyDiscovery.historyVariant, instance.sessionId);
        if (!conversationHistory?.messages) {
            return [];
        }
        // Convert ConversationMessage format to OpenAI format
        return conversationHistory.messages.map(msg => {
            if (msg.role === 'assistant') {
                const assistantMessage = {
                    role: 'assistant',
                    content: msg.content,
                };
                if (msg.tool_calls) {
                    assistantMessage.tool_calls =
                        msg.tool_calls;
                }
                return assistantMessage;
            }
            else if (msg.role === 'tool') {
                const toolMessage = {
                    role: 'tool',
                    content: msg.content,
                    tool_call_id: msg.tool_call_id || '',
                };
                return toolMessage;
            }
            else {
                const userMessage = {
                    role: 'user',
                    content: msg.content,
                };
                return userMessage;
            }
        });
    }
    catch (error) {
        console.warn('Failed to retrieve conversation history:', error);
        return [];
    }
};
/**
 * Parses input modalities from OpenRouter model data
 */
const parseInputModalities = (model) => {
    const modalities = [];
    if (model.architecture?.inputModalities) {
        model.architecture.inputModalities.forEach(modality => {
            switch (modality.toLowerCase()) {
                case 'text':
                    modalities.push('text');
                    break;
                case 'image':
                    modalities.push('image');
                    break;
                case 'file':
                    modalities.push('file');
                    break;
                case 'video':
                    modalities.push('video');
                    break;
                case 'audio':
                    modalities.push('audio');
                    break;
            }
        });
    }
    else if (model.architecture?.modality) {
        // Fallback to parsing the modality string
        const modalityStr = model.architecture.modality.toLowerCase();
        if (modalityStr.includes('text')) {
            modalities.push('text');
        }
        if (modalityStr.includes('image')) {
            modalities.push('image');
        }
        if (modalityStr.includes('file')) {
            modalities.push('file');
        }
        if (modalityStr.includes('audio')) {
            modalities.push('audio');
        }
    }
    // Default to text if no modalities found
    if (modalities.length === 0) {
        modalities.push('text');
    }
    return modalities;
};
/**
 * Parses output modalities from OpenRouter model data
 */
const parseOutputModalities = (model) => {
    const modalities = [];
    if (model.architecture?.outputModalities) {
        model.architecture.outputModalities.forEach((modality) => {
            switch (modality.toLowerCase()) {
                case 'text':
                    modalities.push('text');
                    break;
                case 'image':
                    modalities.push('image');
                    break;
            }
        });
    }
    else if (model.architecture?.modality) {
        // Fallback to parsing the modality string
        const modalityStr = model.architecture.modality.toLowerCase();
        if (modalityStr.includes('->text') || modalityStr.includes('text')) {
            modalities.push('text');
        }
        if (modalityStr.includes('->image') || modalityStr.includes('+image')) {
            modalities.push('image');
        }
    }
    // Default to text if no modalities found
    if (modalities.length === 0) {
        modalities.push('text');
    }
    return modalities;
};
/**
 * Detects if a model supports tool calling
 */
const detectToolSupport = (model) => {
    if (!model.supportedParameters) {
        return false;
    }
    return model.supportedParameters.some(param => param === 'tools' ||
        param === 'tool_choice' ||
        param === 'function_call' ||
        param === 'functions');
};
/**
 * Extracts provider name from model ID
 */
const extractProvider = (modelId) => {
    const parts = modelId.split('/');
    return parts[0] || 'unknown';
};
/**
 * Converts pricing string to number (USD per token)
 */
const parsePricing = (priceStr) => {
    if (!priceStr || priceStr === '0') {
        return undefined;
    }
    return parseFloat(priceStr);
};
let discoveryEventCounter = Date.now();
const discoverToolsVariants = async (context) => {
    const eventId = `discovery-${discoveryEventCounter++}`;
    // Invoke all linked tools
    await context.setOutputsWithContext({
        eventContext: {
            type: 'tool-discovery',
            id: eventId,
        },
        outputs: [
            {
                name: 'tools',
                type: DataType.JsonObj,
                value: {
                    id: eventId,
                },
            },
        ],
    });
    // Get the tools from the registry
    const tools = toolRegistry.getDiscoveredTools(eventId);
    return { tools, eventId };
};
/**
 * Discovers available history variants and returns the first one found
 */
const discoverHistoryVariants = async (context) => {
    const eventId = `history-discovery-${discoveryEventCounter++}`;
    // Invoke all linked history variants
    await context.setOutputsWithContext({
        eventContext: {
            type: 'history-discovery',
            id: eventId,
        },
        outputs: [
            {
                name: 'history', // Use tools output for compatibility
                type: DataType.JsonObj,
                value: {
                    id: eventId,
                },
            },
        ],
    });
    // Get the history variants from the registry
    const historyVariants = historyRegistry.getDiscoveredHistories(eventId);
    if (historyVariants.length === 0) {
        return null;
    }
    // Use the first history variant found
    const historyVariant = historyVariants[0];
    return { historyVariant, eventId };
};
let historyInvocationCounter = Date.now();
/**
 * Retrieves conversation history from a history variant
 */
const retrieveConversationHistory = async (context, historyVariant, sessionId) => {
    const executionId = `history-retrieval-${historyInvocationCounter++}`;
    // Register the history event and create a promise
    const historyEvent = registerHistoryEvent({
        recipeUuid: context.recipe.uuid,
        eventId: executionId,
        sessionId,
        timeout: historyVariant.timeout,
    });
    // Send history retrieval request
    await context.setOutputsWithContext({
        eventContext: {
            type: 'history-retrieval',
            executionId,
            sessionId: sessionId || '',
        },
        outputs: [
            {
                name: 'history',
                type: DataType.JsonObj,
                value: {
                    type: 'history-request',
                    sessionId,
                    executionId,
                },
            },
        ],
    });
    try {
        // Wait for the history to be retrieved
        const conversationHistory = await historyEvent.promise;
        return conversationHistory;
    }
    catch (error) {
        console.error('Failed to retrieve conversation history:', error);
        return null;
    }
};
/**
 * Stores conversation update in history variant
 */
const storeConversationUpdate = async (config) => {
    const { context, sessionId, userMessage, assistantMessage, toolCalls, attachments } = config;
    await context.setOutputsWithContext({
        eventContext: {
            type: 'conversation-update',
        },
        outputs: [
            {
                name: 'history',
                type: DataType.JsonObj,
                value: {
                    sessionId,
                    userMessage,
                    assistantMessage,
                    toolCalls,
                    attachments: attachments,
                },
            },
        ],
    });
};
/**
 * Fetches available models from OpenRouter with caching per agent instance
 * Uses platform proxy when no API key is configured
 */
const fetchAvailableModels = async (recipeUuid) => {
    const agentInstance = agentInstanceMap[recipeUuid];
    const now = Date.now();
    // Check if we have cached models that are still valid
    if (agentInstance?.cachedModels && agentInstance?.modelsCacheTimestamp) {
        const cacheAge = now - agentInstance.modelsCacheTimestamp;
        if (cacheAge < MODELS_CACHE_DURATION) {
            return agentInstance.cachedModels;
        }
    }
    try {
        console.log('Fetching fresh models from OpenRouter for recipe:', recipeUuid);
        const models = await fetchOpenRouterModels({
            apiKey: agentInstance.apiKey,
            baseURL: agentInstance.baseURL,
            httpReferer: 'https://kemu.io',
            xTitle: 'Kemu AI Agent Service',
            kemuApiKey: agentInstance.kemuApiKey,
        });
        // Cache the models in the agent instance
        if (agentInstance) {
            agentInstance.cachedModels = models;
            agentInstance.modelsCacheTimestamp = now;
        }
        return models;
    }
    catch (error) {
        console.error('Failed to fetch OpenRouter models:', error);
        // Return empty array on error - client will handle gracefully
        return [];
    }
};
/**
 * Fetches available providers from OpenRouter with caching per agent instance
 * Uses platform proxy when no API key is configured
 */
const fetchAvailableProviders = async (recipeUuid) => {
    const agentInstance = agentInstanceMap[recipeUuid];
    const now = Date.now();
    // Check if we have cached providers that are still valid
    if (agentInstance?.cachedProviders && agentInstance?.providersCacheTimestamp) {
        const cacheAge = now - agentInstance.providersCacheTimestamp;
        if (cacheAge < MODELS_CACHE_DURATION) {
            return agentInstance.cachedProviders;
        }
    }
    try {
        console.log('Fetching fresh providers from OpenRouter for recipe:', recipeUuid);
        const providers = await fetchOpenRouterProviders({
            apiKey: agentInstance.apiKey,
            baseURL: agentInstance.baseURL,
            httpReferer: 'https://kemu.io',
            xTitle: 'Kemu AI Agent Service',
            kemuApiKey: agentInstance.kemuApiKey,
        });
        // Cache the providers in the agent instance
        if (agentInstance) {
            agentInstance.cachedProviders = providers;
            agentInstance.providersCacheTimestamp = now;
        }
        return providers;
    }
    catch (error) {
        console.error('Failed to fetch OpenRouter providers:', error);
        // Return empty array on error - client will handle gracefully
        return [];
    }
};
/**
 * Checks whether the given value is a binary file type
 */
const isBinaryFile = (file) => {
    return typeof file === 'object'
        && file !== null
        && 'format' in file
        && 'data' in file
        && typeof file.format === 'string'
        && file.data !== null
        && file.data instanceof ArrayBuffer;
};
/**
 * Converts a binary file to a base64 tool response
 * @param file
 * @returns
 */
const binaryFileToBase64ToolResponse = (file) => {
    const isTextBased = file.format.startsWith('text/') ||
        file.format === 'application/json' ||
        file.format === 'application/javascript' ||
        file.format === 'application/yaml' ||
        file.format === 'application/toml' ||
        file.format === 'application/html' ||
        file.format === 'text/markdown' ||
        file.format === 'application/css' ||
        file.format === 'application/xml' ||
        file.format === 'application/csv' ||
        file.format === 'application/tsv';
    if (isTextBased) {
        return JSON.stringify({
            fileFormat: file.format,
            text: new TextDecoder().decode(file.data)
        });
    }
    const result = {
        contentType: file.format,
        filename: file.fileName,
        encoding: 'base64',
        data: fileToBase64String(file)
    };
    return JSON.stringify(result);
};
let toolInvocationCounter = Date.now();
/**
 * Formats tool call results according to OpenRouter specification
 */
const formatToolResult = (toolCall, result) => {
    // Convert result to string if it's not already
    let content;
    if (typeof result === 'string') {
        content = result;
    }
    else if (result === null || result === undefined) {
        content = 'null';
    }
    else if (isBinaryFile(result)) {
        content = binaryFileToBase64ToolResponse(result);
    }
    else {
        try {
            content = JSON.stringify(result, null, 2);
        }
        catch (error) {
            content = String(result);
        }
    }
    return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: content,
    };
};
/**
 * Processes completed tool calls and returns formatted tool messages for conversation continuation
 */
const processToolCalls = async (toolCalls, context, discoveryEventId) => {
    console.log('Processing tool calls:', toolCalls);
    const toolMessages = [];
    if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
            if (toolCall.type === 'function') {
                try {
                    const executionId = `tool-exec-${toolInvocationCounter++}`;
                    if (!toolCall.function.name) {
                        throw new Error('Tool call function name is required');
                    }
                    // Get timeout for this specific tool
                    const toolTimeout = discoveryEventId ?
                        toolRegistry.getToolTimeout(discoveryEventId, toolCall.function.name) :
                        undefined;
                    // Register tool event
                    const tool = registerToolEvent({
                        recipeUuid: context.recipe.uuid,
                        eventId: executionId,
                        timeout: toolTimeout,
                        agentWidgetId: context.widgetId,
                    });
                    const invokeOutputPromise = context.setOutputsWithContext({
                        // Clear out the event context otherwise the previous event context will be used again.
                        // This is a BUG in the Kemu Engine.
                        eventContext: {
                            executionId,
                        },
                        outputs: [
                            {
                                name: 'tools',
                                type: DataType.JsonObj,
                                value: toolCall
                            }
                        ]
                    });
                    const [result] = await Promise.all([tool.promise, invokeOutputPromise]);
                    console.log('Tool result for', toolCall.function.name, ':', result);
                    // Format the tool result according to OpenRouter specification
                    const toolMessage = formatToolResult(toolCall, result);
                    toolMessages.push(toolMessage);
                }
                catch (error) {
                    console.error('Error executing tool call:', toolCall.function.name, error);
                    // Add error message as tool result
                    const errorMessage = formatToolResult(toolCall, {
                        error: error instanceof Error
                            ? error.message
                            : (typeof error?.error === 'string'
                                ? error.error
                                : 'Unknown error occurred')
                    });
                    toolMessages.push(errorMessage);
                }
            }
        }
    }
    return toolMessages;
};
/**
 * Executes tool calls and returns the tool result messages
 * This function only handles tool execution and returns results to the main loop
 */
const executeToolCalls = async (toolCalls, context, discoveryEventId) => {
    // console.log('Executing tool calls:', toolCalls.map(tc => tc.function.name));
    return await processToolCalls(toolCalls, context, discoveryEventId);
};
/**
 * Checks whether a value is one of the supported agent-editable fields.
 *
 * @param value - Value to validate.
 * @returns True when the value is a supported field id.
 */
const isAgentEditableField = (value) => {
    return value === 'systemInstructions' || value === 'query' || value === 'jsonFormat';
};
/**
 * Validates rewrite request parameters coming from the settings UI.
 *
 * @param params - Raw UI event params.
 * @returns Validated rewrite request payload.
 */
const parseAgentFieldRewriteRequest = (params) => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('Invalid AI edit request payload.');
    }
    const payload = params;
    const requestId = typeof payload.requestId === 'string' && payload.requestId.trim()
        ? payload.requestId
        : createId();
    if (!isAgentEditableField(payload.field)) {
        throw new Error('Invalid AI edit field.');
    }
    if (typeof payload.currentContent !== 'string') {
        throw new Error('AI edit current content must be a string.');
    }
    if (typeof payload.userPrompt !== 'string' || !payload.userPrompt.trim()) {
        throw new Error('AI edit prompt is required.');
    }
    const jsonSchemaMode = payload.jsonSchemaMode === 'json-schema' || payload.jsonSchemaMode === 'typescript'
        ? payload.jsonSchemaMode
        : undefined;
    return {
        requestId,
        field: payload.field,
        currentContent: payload.currentContent,
        userPrompt: payload.userPrompt,
        jsonSchemaMode,
        systemInstructions: typeof payload.systemInstructions === 'string' ? payload.systemInstructions : undefined,
        query: typeof payload.query === 'string' ? payload.query : undefined,
        jsonFormat: typeof payload.jsonFormat === 'string' ? payload.jsonFormat : undefined,
    };
};
/**
 * Handles agent settings AI generation requests.
 *
 * @param context - UI event context.
 * @param params - Rewrite request parameters.
 * @returns Rewrite response payload.
 */
const handleAgentSettingsAiGenerate = async (context, params) => {
    const request = parseAgentFieldRewriteRequest(params);
    const openai = await getOpenRouterInstance(context.recipe.uuid);
    const abortController = new AbortController();
    settingsAiAbortControllerMap.set(request.requestId, abortController);
    try {
        const content = await generateAgentFieldRewrite({
            openai,
            signal: abortController.signal,
            context: {
                field: request.field,
                currentContent: request.currentContent,
                userPrompt: request.userPrompt,
                jsonSchemaMode: request.jsonSchemaMode,
                systemInstructions: request.systemInstructions,
                query: request.query,
                jsonFormat: request.jsonFormat,
            },
        });
        return {
            success: true,
            data: {
                field: request.field,
                content,
            },
        };
    }
    catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || abortController.signal.aborted)) {
            return {
                success: false,
                error: 'Request cancelled.',
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to generate AI edit.',
        };
    }
    finally {
        settingsAiAbortControllerMap.delete(request.requestId);
    }
};
/**
 * Aborts an in-flight agent settings AI generation request.
 *
 * @param params - Abort request payload.
 * @returns Success response.
 */
const handleAgentSettingsAiAbort = async (params) => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return { success: true };
    }
    const requestId = typeof params.requestId === 'string'
        ? params.requestId
        : '';
    if (requestId) {
        settingsAiAbortControllerMap.get(requestId)?.abort(USER_ABORT_REASON);
    }
    return { success: true };
};
/**
 * Validates Tool AI definition request parameters coming from the settings UI.
 *
 * @param params - Raw UI event params.
 * @returns Validated Tool AI request payload.
 */
const parseToolAiDefinitionRequest = (params) => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('Invalid tool AI request payload.');
    }
    const payload = params;
    const requestId = typeof payload.requestId === 'string' && payload.requestId.trim()
        ? payload.requestId
        : createId();
    if (typeof payload.userPrompt !== 'string' || !payload.userPrompt.trim()) {
        throw new Error('Tool AI prompt is required.');
    }
    if (!payload.currentTool ||
        typeof payload.currentTool !== 'object' ||
        Array.isArray(payload.currentTool)) {
        throw new Error('Tool AI current tool payload is required.');
    }
    return {
        requestId,
        userPrompt: payload.userPrompt,
        currentTool: payload.currentTool,
    };
};
/**
 * Handles Tool settings AI generation requests.
 *
 * @param context - UI event context.
 * @param params - Tool definition request parameters.
 * @returns Tool definition response payload.
 */
const handleToolSettingsAiGenerate = async (context, params) => {
    const request = parseToolAiDefinitionRequest(params);
    const openai = await getOpenRouterInstance(context.recipe.uuid);
    const abortController = new AbortController();
    settingsAiAbortControllerMap.set(request.requestId, abortController);
    try {
        const tool = await generateToolDefinitionDraft({
            openai,
            signal: abortController.signal,
            request,
        });
        return {
            success: true,
            data: {
                tool,
            },
        };
    }
    catch (error) {
        if (error instanceof Error &&
            (error.name === 'AbortError' || abortController.signal.aborted)) {
            return {
                success: false,
                error: 'Request cancelled.',
            };
        }
        return {
            success: false,
            error: error instanceof Error
                ? error.message
                : 'Failed to generate tool definition.',
        };
    }
    finally {
        settingsAiAbortControllerMap.delete(request.requestId);
    }
};
/**
 * Aborts an in-flight Tool settings AI generation request.
 *
 * @param params - Abort request payload.
 * @returns Success response.
 */
const handleToolSettingsAiAbort = async (params) => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return { success: true };
    }
    const requestId = typeof params.requestId === 'string'
        ? params.requestId
        : '';
    if (requestId) {
        settingsAiAbortControllerMap.get(requestId)?.abort(USER_ABORT_REASON);
    }
    return { success: true };
};
// Handle parent events based on variant
service.onParentEvent(async (event, context) => {
    const instance = getInstance(context.recipe.uuid, context.widgetId);
    const isAgentVariant = context.variantId === undefined;
    const isToolVariant = context.variantId === 'tool';
    const isSubmitVariant = context.variantId === 'submit';
    const isHistoryVariant = context.variantId === 'history';
    if (isAgentVariant) {
        const currentState = {
            ...getDefaultAgentServiceState(),
            ...context.currentState
        };
        try {
            const openai = await getOpenRouterInstance(context.recipe.uuid);
            // Handle different input ports
            if (event.target.portName === 'config') {
                // Capture ChatInterface routing (if provided) from eventContext for this invocation
                const chatRouting = getChatRoutingFromEventContext(event.eventContext);
                if (chatRouting) {
                    instance.activeChatWidgetId = chatRouting.chatWidgetId;
                    instance.activeInvocationId = chatRouting.invocationId;
                }
                // Validate and process the config object
                const config = await validateAndProcessConfig({
                    widgetId: context.widgetId,
                    configData: event.data.value,
                    configType: event.data.type,
                    defaultQuery: currentState.query,
                    defaultSystemInstructions: currentState.systemInstructions
                });
                // Handle sessionId logic
                if (config.sessionId !== undefined) {
                    if (config.sessionId !== instance.sessionId || !config.sessionId) {
                        // Reset instance if sessionId is different, null, or undefined
                        instance.abortController.abort();
                        instance.attachments = [];
                        instance.conversationHistory = [];
                        instance.sessionId = config.sessionId || generateHistorySessionId();
                    }
                    // If sessionId matches current instance, preserve existing state
                }
                // Process query
                instance.query = config.query;
                publishAgentChatEvent({
                    recipeUuid: context.recipe.uuid,
                    instance,
                    type: 'userMessage',
                    payload: {
                        query: instance.query,
                        sessionId: config.sessionId ?? instance.sessionId,
                    },
                });
                // Process attachments
                if (config.attachments !== undefined) {
                    const attachmentsArray = Array.isArray(config.attachments) ? config.attachments : [config.attachments];
                    instance.attachments = attachmentsArray.map((attachment) => {
                        if (typeof attachment === 'string') {
                            // URLs are added as strings
                            if (isValidUrl(attachment)) {
                                return attachment;
                            }
                            const containsBase64 = isBase64(attachment);
                            if (containsBase64) {
                                return base64StringToBinaryFile(attachment);
                            }
                            // Attach plain text as a document
                            // return { format: 'text/plain', data: Buffer.from(attachment).buffer };
                            // return { format: 'text/plain', data: attachment };
                            return attachment;
                        }
                        if (isImageData(attachment)) {
                            return imageDataToBinaryFile(attachment);
                        }
                        if (attachment instanceof ArrayBuffer || attachment instanceof Uint8ClampedArray) {
                            return { format: 'application/octet-stream', data: attachment };
                        }
                        if (isMimeTypedValue(attachment)) {
                            return {
                                format: fixInvalidMimeType(attachment.format),
                                data: attachment.data,
                            };
                        }
                        // Convert directly into a JSON file
                        if (typeof attachment === 'object') {
                            try {
                                return JSON.stringify(attachment);
                            }
                            catch (error) {
                                throw new Error('Failed to convert attachment to JSON');
                            }
                        }
                        return null;
                    }).filter((attachment) => attachment !== null);
                }
                try {
                    // Use the user selected model
                    const selectedModel = currentState.selectedModel;
                    if (!selectedModel) {
                        throw new Error('Please select a model');
                    }
                    const currentModel = selectedModel.slug;
                    const chunks = [];
                    const query = instance.query;
                    instance.query = null;
                    instance.abortController.abort(NEW_QUERY_ABORT_REASON);
                    instance.abortController = new AbortController();
                    const abortSignal = instance.abortController.signal;
                    // Build messages array
                    const messages = [];
                    // Add system instructions if provided
                    if (config.systemInstructions && config.systemInstructions.trim().length > 0) {
                        messages.push({
                            role: 'system',
                            content: config.systemInstructions,
                        });
                    }
                    // Add conversation history from history variant
                    const historyMessages = await getConversationHistory(context, instance);
                    publishAgentChatEvent({
                        recipeUuid: context.recipe.uuid,
                        instance,
                        type: 'agentHistory',
                        payload: {
                            sessionId: instance.sessionId,
                            messageCount: historyMessages.length,
                        },
                    });
                    messages.push(...historyMessages);
                    // Build user message with query and attachments
                    const userContent = [];
                    if (query && query.trim().length > 0) {
                        userContent.push({
                            type: 'text',
                            text: query,
                        });
                    }
                    // Add attachments
                    if (instance.attachments && instance.attachments.length > 0) {
                        userContent.push(...attachmentToMessageContent(instance.attachments));
                    }
                    if (userContent.length > 0) {
                        messages.push({
                            role: 'user',
                            content: userContent,
                        });
                    }
                    // Prepare request options
                    const requestOptions = {
                        model: currentModel,
                        messages,
                        stream: true,
                    };
                    // Add plugins configuration for file processing and web search if needed
                    const pluginsConfig = generatePluginsConfig(instance.attachments || [], currentState.fileParser, currentState.webSearch);
                    if (pluginsConfig) {
                        requestOptions.plugins = pluginsConfig;
                    }
                    // Add available tools from the current recipe
                    // const availableTools = await getActiveRecipeToolState(context.recipe.uuid);
                    const { tools: availableTools, eventId: discoveryEventId } = await discoverToolsVariants(context);
                    if (availableTools.length > 0) {
                        requestOptions.tools = availableTools;
                        requestOptions.tool_choice = 'auto'; // Let the model decide when to use tools
                    }
                    // Check if we need to enable image generation modalities (from stored ModelInfo)
                    const supportsImageGeneration = selectedModel.outputModalities.includes('image');
                    // Add modalities for image generation if supported
                    if (supportsImageGeneration) {
                        requestOptions.modalities = ['image', 'text'];
                        // Add image_config with aspect ratio if specified
                        if (currentState.imageAspectRatio) {
                            requestOptions.imageConfig = {
                                aspectRatio: currentState.imageAspectRatio,
                            };
                        }
                    }
                    // Handle JSON response format if enabled
                    const useJsonResponse = currentState.jsonResponse && currentState.jsonFormat;
                    if (useJsonResponse) {
                        try {
                            let schema;
                            if (currentState.jsonSchemaMode === 'json-schema') {
                                // Parse JSON schema directly
                                schema = parseJsonSchema(currentState.jsonFormat);
                            }
                            else {
                                // Use TypeScript conversion (default behavior)
                                const convertedSchema = await getSchemaFromTypes(currentState.jsonFormat);
                                if (!convertedSchema) {
                                    throw new Error('Invalid TypeScript schema format');
                                }
                                schema = convertedSchema.components.schemas.Schema;
                            }
                            const fixedSchema = cleanupOpenApiSchema(schema);
                            requestOptions.response_format = {
                                type: 'json_schema',
                                json_schema: {
                                    name: 'response',
                                    schema: fixedSchema,
                                    // strict: true,
                                },
                            };
                        }
                        catch (error) {
                            console.error('Failed to parse JSON schema:', error);
                            throw new Error(`Invalid JSON schema format: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                    }
                    // Add reasoning parameters if model supports reasoning
                    if (selectedModel?.supportsReasoning) {
                        requestOptions.reasoning_effort = currentState.reasoningEffort || 'medium';
                    }
                    // Add temperature if specified
                    if (currentState.temperature !== undefined) {
                        requestOptions.temperature = currentState.temperature;
                    }
                    // Add provider configuration if specified
                    const hasProviderOrder = currentState.providerOrder && currentState.providerOrder.length > 0;
                    const hasAllowFallbacks = currentState.allowFallbacks !== undefined;
                    if (hasProviderOrder) {
                        requestOptions.provider = {};
                        requestOptions.provider.order = currentState.providerOrder;
                        if (hasAllowFallbacks) {
                            requestOptions.provider.allow_fallbacks = currentState.allowFallbacks;
                        }
                    }
                    // Main conversation loop - handles multiple rounds of tool calls
                    const conversationMessages = [...messages];
                    const maxIterations = currentState.maxIterations || 10; // Use configurable value or default to 10
                    let iteration = 0;
                    const generatedImages = [];
                    const publishedImageUrls = new Set();
                    let reasoningText = '';
                    let debugInfo = null;
                    // Since this process didn't fail, we can mark the API key as valid
                    agentInstanceMap[instance.recipeUuid].apiKeyValid = true;
                    while (iteration < maxIterations) {
                        iteration++;
                        console.log(`Conversation iteration ${iteration}`);
                        try {
                            // Make request with current message history
                            const currentRequestOptions = {
                                ...requestOptions,
                                messages: conversationMessages,
                                ...(availableTools.length > 0 ? {
                                    tools: availableTools,
                                    tool_choice: 'auto'
                                } : {}),
                            };
                            const currentResponse = await openai.chat.completions.create(currentRequestOptions, {
                                signal: abortSignal,
                            });
                            instance.lastStream = currentResponse;
                            const toolCalls = [];
                            let hasToolCalls = false;
                            let responseText = '';
                            let lastChunk = null;
                            // Process streaming response
                            for await (const chunk of currentResponse) {
                                lastChunk = chunk;
                                if (abortSignal.aborted) {
                                    break;
                                }
                                console.log('Chunk:', chunk);
                                const choice = chunk.choices[0];
                                if (!choice) {
                                    continue;
                                }
                                // Handle text content
                                const text = choice.delta?.content ?? '';
                                if (text) {
                                    responseText += text;
                                    chunks.push(text);
                                }
                                // Handle reasoning content
                                const deltaExt = choice.delta;
                                if (deltaExt.reasoning) {
                                    reasoningText += deltaExt.reasoning;
                                }
                                // Handle generated images (cast to any to avoid type issues with missing images property)
                                if (deltaExt.images) {
                                    for (const image of deltaExt.images) {
                                        if (image.image_url?.url) {
                                            try {
                                                const imageUrl = image.image_url.url;
                                                if (publishedImageUrls.has(imageUrl)) {
                                                    continue;
                                                }
                                                publishAgentChatEvent({
                                                    recipeUuid: context.recipe.uuid,
                                                    instance,
                                                    type: 'agentImages',
                                                    payload: {
                                                        image: imageUrl,
                                                    },
                                                });
                                                publishedImageUrls.add(imageUrl);
                                                // Preserve existing behavior for outputs (but only once per unique image url)
                                                const imageData = await base64ToImageData(imageUrl);
                                                generatedImages.push(imageData);
                                            }
                                            catch (error) {
                                                console.error('Failed to convert generated image to ImageData:', error);
                                            }
                                        }
                                    }
                                }
                                // Handle tool calls
                                if (choice.delta?.tool_calls) {
                                    hasToolCalls = true;
                                    for (const toolCall of choice.delta.tool_calls) {
                                        if (toolCall.index !== undefined) {
                                            // Initialize tool call if it doesn't exist
                                            if (!toolCalls[toolCall.index]) {
                                                toolCalls[toolCall.index] = {
                                                    id: toolCall.id || '',
                                                    type: 'function',
                                                    function: {
                                                        name: '',
                                                        arguments: ''
                                                    }
                                                };
                                            }
                                            // Update tool call data
                                            if (toolCall.id) {
                                                toolCalls[toolCall.index].id = toolCall.id;
                                            }
                                            if (toolCall.function?.name) {
                                                toolCalls[toolCall.index].function.name = toolCall.function.name;
                                            }
                                            if (toolCall.function?.arguments) {
                                                toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                                            }
                                        }
                                    }
                                }
                                // Stream text content (but not when we have tool calls)
                                if (!hasToolCalls && (chunks.length > 0 || reasoningText.length > 0)) {
                                    const outputs = [];
                                    if (chunks.length > 0) {
                                        outputs.push({
                                            name: 'stream',
                                            type: DataType.String,
                                            value: chunks.join('')
                                        });
                                        publishAgentChatEvent({
                                            recipeUuid: context.recipe.uuid,
                                            instance,
                                            type: 'agentStream',
                                            payload: chunks.join(''),
                                        });
                                    }
                                    // Add reasoning output if available
                                    if (reasoningText) {
                                        outputs.push({
                                            name: 'reasoning',
                                            type: DataType.String,
                                            value: reasoningText
                                        });
                                        publishAgentChatEvent({
                                            recipeUuid: context.recipe.uuid,
                                            instance,
                                            type: 'agentReasoning',
                                            payload: reasoningText,
                                        });
                                    }
                                    await context.setOutputs(outputs, currentState).catch((e) => {
                                        console.error('Failed to set stream output', e);
                                    });
                                }
                                // Analyze the response and determine if we should stop reasoning
                                if (choice.finish_reason) {
                                    debugInfo = {
                                        ...(debugInfo || {}),
                                        finish_reason: choice.finish_reason ?? null,
                                        native_finish_reason: choice?.native_finish_reason ?? null,
                                    };
                                }
                                if (chunk.usage) {
                                    debugInfo = {
                                        ...debugInfo,
                                        usage: chunk.usage,
                                    };
                                }
                            }
                            // If we have tool calls, execute them and continue the loop
                            if (toolCalls.length > 0) {
                                console.log(`Executing ${toolCalls.length} tool calls in iteration ${iteration}`);
                                publishAgentChatEvent({
                                    recipeUuid: context.recipe.uuid,
                                    instance,
                                    type: 'agentTools',
                                    payload: toolCalls,
                                });
                                // Add assistant message with tool calls to conversation
                                const assistantMessage = {
                                    role: 'assistant',
                                    content: responseText || null,
                                    tool_calls: toolCalls.map(tc => ({
                                        id: tc.id,
                                        type: tc.type,
                                        function: {
                                            name: tc.function.name,
                                            arguments: tc.function.arguments
                                        }
                                    }))
                                };
                                conversationMessages.push(assistantMessage);
                                // Execute tool calls and get results
                                const toolMessages = await executeToolCalls(toolCalls, context, discoveryEventId);
                                conversationMessages.push(...toolMessages);
                                publishAgentChatEvent({
                                    recipeUuid: context.recipe.uuid,
                                    instance,
                                    type: 'agentTools',
                                    payload: {
                                        phase: 'result',
                                        toolMessages,
                                    },
                                });
                                // Continue to next iteration to get AI's response to tool results
                                continue;
                            }
                            else {
                                // No tool calls - this is the final response
                                console.log(`Final response received in iteration ${iteration}`);
                                // Check for images in the final message (non-streaming case)
                                // Note: Images in streaming responses come through delta, but we'll also check the final message
                                const finalImages = lastChunk?.choices?.[0]?.message?.images;
                                if (finalImages) {
                                    for (const image of finalImages) {
                                        if (image.image_url?.url) {
                                            try {
                                                const imageUrl = image.image_url.url;
                                                if (publishedImageUrls.has(imageUrl)) {
                                                    continue;
                                                }
                                                publishAgentChatEvent({
                                                    recipeUuid: context.recipe.uuid,
                                                    instance,
                                                    type: 'agentImages',
                                                    payload: {
                                                        image: imageUrl,
                                                    },
                                                });
                                                publishedImageUrls.add(imageUrl);
                                                const imageData = await base64ToImageData(imageUrl);
                                                generatedImages.push(imageData);
                                            }
                                            catch (error) {
                                                console.error('Failed to convert final message image to ImageData:', error);
                                            }
                                        }
                                    }
                                }
                                break;
                            }
                        }
                        catch (error) {
                            // Check if this is an abort error - if so, break the loop gracefully
                            if (error instanceof Error && (error.name === 'AbortError' || abortSignal.aborted)) {
                                console.log('Request aborted by user or new query');
                                break;
                            }
                            console.error(`Error in conversation iteration ${iteration}:`, error);
                            throw error;
                        }
                    }
                    if (iteration >= maxIterations) {
                        console.warn('Maximum conversation iterations reached');
                    }
                    // Clear the tool registry for this discovery event
                    toolRegistry.clearEventRegistry(discoveryEventId);
                    // If the request was aborted, don't set final outputs
                    if (abortSignal.aborted) {
                        console.log('Request was aborted, skipping final outputs');
                        return;
                    }
                    // Set final outputs
                    const fullText = chunks.join('');
                    const jsonResponse = safeJsonParse(fullText);
                    // Store conversation update in history
                    try {
                        await storeConversationUpdate({
                            context: context,
                            sessionId: instance.sessionId,
                            userMessage: query,
                            assistantMessage: fullText,
                            attachments: instance.attachments,
                        });
                    }
                    catch (error) {
                        console.warn('Failed to store conversation update:', error);
                    }
                    const outputs = [
                        {
                            name: 'text',
                            type: DataType.String,
                            value: useJsonResponse ? JSON.stringify(jsonResponse, null, 2) : fullText
                        },
                        ...(useJsonResponse ? [{
                                name: 'json',
                                type: DataType.JsonObj,
                                value: jsonResponse
                            }] : []),
                        ...(reasoningText ? [{
                                name: 'reasoning',
                                type: DataType.String,
                                value: reasoningText
                            }] : []),
                        ...(generatedImages.length > 0 ? [{
                                name: 'images',
                                type: DataType.Array,
                                value: generatedImages.map((image) => createImageDataLike(image.data, image.width, image.height))
                            }] : []),
                        ...(debugInfo ? [{
                                name: 'debug',
                                type: DataType.JsonObj,
                                value: debugInfo
                            }] : [])
                    ];
                    if (useJsonResponse) {
                        publishAgentChatEvent({
                            recipeUuid: context.recipe.uuid,
                            instance,
                            type: 'agentJson',
                            payload: jsonResponse,
                        });
                    }
                    if (reasoningText) {
                        publishAgentChatEvent({
                            recipeUuid: context.recipe.uuid,
                            instance,
                            type: 'agentReasoning',
                            payload: reasoningText,
                        });
                    }
                    if (debugInfo) {
                        publishAgentChatEvent({
                            recipeUuid: context.recipe.uuid,
                            instance,
                            type: 'agentDebug',
                            payload: debugInfo,
                        });
                    }
                    // Publish final text last so the UI can safely treat it as the terminal event for polling.
                    publishAgentChatEvent({
                        recipeUuid: context.recipe.uuid,
                        instance,
                        type: 'agentText',
                        payload: useJsonResponse ? JSON.stringify(jsonResponse, null, 2) : fullText,
                    });
                    await context.setOutputs(outputs, currentState).catch((e) => {
                        console.error('Failed to set final outputs', e);
                    });
                }
                finally {
                    instance.attachments = [];
                }
                return;
            }
            if (event.target.portName === 'abort') {
                // Capture ChatInterface routing (if provided) from eventContext for this invocation
                const chatRouting = getChatRoutingFromEventContext(event.eventContext);
                if (chatRouting) {
                    instance.activeChatWidgetId = chatRouting.chatWidgetId;
                    instance.activeInvocationId = chatRouting.invocationId;
                }
                instance.abortController.abort(USER_ABORT_REASON);
                instance.lastStream = null;
                publishAgentChatEvent({
                    recipeUuid: context.recipe.uuid,
                    instance,
                    type: 'agentAbort',
                    payload: { reason: USER_ABORT_REASON },
                });
                // Abort pending tool calls
                terminateToolInstance({
                    recipeUuid: context.recipe.uuid,
                    agentWidgetId: instance.widgetId
                });
                return;
            }
            // Unknown port
            throw new Error(`Unknown input port: ${event.target.portName}`);
        }
        catch (e) {
            console.error('Failed to process agent event', e);
            let httpError = null;
            const err = e;
            if ((err.status === 400 || err.code === 400) && err.error?.message) {
                const platformError = decodeProviderError(err);
                httpError = platformError || err.error.message;
            }
            else if (err.status === 429) {
                httpError = 'Rate limit exceeded. Please try again later.';
            }
            else if (err.status === 401) {
                httpError = 'Invalid API key. Please check your OpenRouter API key.';
            }
            else if (err.message) {
                httpError = err.message;
            }
            // Publish error event to notify UI and stop polling
            publishAgentChatEvent({
                recipeUuid: context.recipe.uuid,
                instance,
                type: 'agentError',
                payload: { message: httpError || 'An unexpected error occurred' },
            });
            throw httpError ? new Error(httpError) : e;
        }
    }
    if (isToolVariant) {
        return handleToolParentEvent(event, context);
    }
    if (isSubmitVariant) {
        return handleSubmitParentEvent(event, context);
    }
    if (isHistoryVariant) {
        return handleHistoryParentEvent(event, context);
    }
    throw new Error('Unknown variant, cannot process event');
});
// Handle UI events from the browser
service.onUIEvent(async (context, event, params) => {
    switch (event) {
        case 'get-models':
            return await handleGetModels(context);
        case 'get-providers':
            return await handleGetProviders(context);
        case 'chat-send': {
            const invocationId = `chat-inv-${createId()}`;
            const config = (params && typeof params === 'object' ? params : {});
            const query = typeof config.query === 'string' ? config.query : '';
            const payload = {};
            if (query) {
                payload.query = query;
            }
            if (config.attachments !== undefined) {
                payload.attachments = config.attachments;
            }
            if (config.sessionId !== undefined) {
                payload.sessionId = config.sessionId;
            }
            if (config.systemInstructions !== undefined) {
                payload.systemInstructions = config.systemInstructions;
            }
            await service.broadcastEvent({
                variantId: context.variantId,
                targetWidgetId: context.widgetId,
                eventContext: {
                    chatWidgetId: context.widgetId,
                    invocationId,
                },
                outputs: [
                    {
                        name: 'config',
                        type: DataType.JsonObj,
                        value: payload,
                    },
                ],
            });
            return {
                success: true,
                data: {
                    invocationId,
                },
            };
        }
        case 'chat-abort': {
            const invocationId = (params && typeof params === 'object' && typeof params.invocationId === 'string')
                ? params.invocationId
                : `chat-inv-${createId()}`;
            await service.broadcastEvent({
                variantId: context.variantId,
                targetWidgetId: context.widgetId,
                eventContext: {
                    chatWidgetId: context.widgetId,
                    invocationId,
                },
                outputs: [
                    {
                        name: 'abort',
                        type: DataType.Anything,
                        value: true,
                    },
                ],
            });
            return { success: true };
        }
        case 'chat-get-events': {
            const since = (params && typeof params === 'object' && typeof params.since === 'number')
                ? params.since
                : 0;
            const { events, nextSince } = getChatEvents({
                recipeUuid: context.recipe.uuid,
                chatWidgetId: context.widgetId,
                since,
            });
            return {
                success: true,
                data: {
                    events,
                    nextSince,
                },
            };
        }
        case 'chat-clear': {
            clearChatEvents({
                recipeUuid: context.recipe.uuid,
                chatWidgetId: context.widgetId,
            });
            return { success: true };
        }
        case 'chat-generate-session-id': {
            return {
                success: true,
                data: {
                    sessionId: generateHistorySessionId(),
                },
            };
        }
        case 'agent-settings-ai-generate':
            return await handleAgentSettingsAiGenerate(context, params);
        case 'agent-settings-ai-abort':
            return await handleAgentSettingsAiAbort(params);
        case 'tool-settings-ai-generate':
            return await handleToolSettingsAiGenerate(context, params);
        case 'tool-settings-ai-abort':
            return await handleToolSettingsAiAbort(params);
        default:
            return { error: `Unknown event "${event}"` };
    }
});
const decodeProviderError = (e) => {
    const err = e;
    if ((err.status === 400 || err.code === 400) && err.error?.message) {
        const providerName = err.error?.metadata?.provider_name;
        const raw = err.error?.metadata?.raw;
        if (typeof providerName === 'string' && typeof raw === 'string') {
            const errorMessage = safeJsonParse(raw);
            if (errorMessage) {
                return errorMessage.error?.message || errorMessage.message;
            }
        }
    }
    return null;
};
/**
 * Handle get-models UI event
 */
const handleGetModels = async (context) => {
    try {
        await getOpenRouterInstance(context.recipe.uuid);
        const models = await fetchAvailableModels(context.recipe.uuid);
        // Convert all models to ModelInfo format with complete data
        const modelMapping = models.reduce((acc, model) => {
            // Handle null to undefined conversion for OpenRouter SDK types
            const maxCompletionTokens = model.topProvider?.maxCompletionTokens;
            const maxTokens = (maxCompletionTokens !== null && maxCompletionTokens !== undefined)
                ? maxCompletionTokens
                : undefined;
            const contextLength = model.contextLength !== null ? model.contextLength : undefined;
            const modelInfo = {
                id: model.id,
                slug: model.canonicalSlug,
                name: model.name || model.id,
                description: model.description ?? undefined,
                inputModalities: parseInputModalities(model),
                outputModalities: parseOutputModalities(model),
                supportsTools: detectToolSupport(model),
                supportsReasoning: !!model.supportedParameters?.includes('reasoning'),
                promptPrice: parsePricing(model.pricing?.prompt),
                completionPrice: parsePricing(model.pricing?.completion),
                maxTokens: maxTokens,
                contextLength: contextLength,
                provider: extractProvider(model.id),
            };
            acc[model.canonicalSlug] = modelInfo;
            return acc;
        }, {});
        return {
            success: true,
            data: {
                models: modelMapping,
            }
        };
    }
    catch (error) {
        console.error('Error getting models:', error);
        // Return empty models on error - client will handle gracefully
        return {
            success: false,
            data: {
                models: {},
            }
        };
    }
};
/**
 * Handle get-providers UI event
 */
const handleGetProviders = async (context) => {
    try {
        await getOpenRouterInstance(context.recipe.uuid);
        const providers = await fetchAvailableProviders(context.recipe.uuid);
        // Convert all providers to ProviderInfo format
        const providerMapping = providers.reduce((acc, provider) => {
            const slug = provider.slug || provider.id || 'unknown';
            const providerInfo = {
                slug,
                name: provider.name || provider.slug || provider.id || slug,
            };
            acc[providerInfo.slug] = providerInfo;
            return acc;
        }, {});
        return {
            success: true,
            data: {
                providers: providerMapping,
            }
        };
    }
    catch (error) {
        console.error('Error getting providers:', error);
        // Return empty providers on error - client will handle gracefully
        return {
            success: false,
            data: {
                providers: {},
            }
        };
    }
};
// Initialize the service by requesting the API key secret
service.onInitialize(async (context) => {
    const isToolVariant = context.variantId === 'tool';
    const isHistoryVariant = context.variantId === 'history';
    if (isToolVariant || isHistoryVariant) {
        return;
    }
    context.secrets.requestAccess([
        {
            name: OPENROUTER_API_KEY_SECRET_NAME,
            // The same API key can be used by other instances of this service
            sharedAcrossInstances: true,
        },
    ]);
});
// Handle service termination
service.onTerminate(async (context) => {
    flushInstancesByRecipeUuid(context.recipe.uuid);
    // Terminate tool instances if this is a tool variant
    if (context.variantId === 'tool') {
        terminateToolInstance({
            recipeUuid: context.recipe.uuid,
            agentWidgetId: context.widgetId
        });
    }
    // Terminate history instances if this is a history variant
    if (context.variantId === 'history') {
        terminateHistoryInstance(context.recipe.uuid, context.widgetId);
    }
});
// Handle composer disconnection
service.onKemuComposerDisconnected(async (context) => {
    flushInstancesByRecipeUuid(context.recipe.uuid);
});
//# sourceMappingURL=processor.js.map