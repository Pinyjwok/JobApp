// Default modality options for filtering
export const INPUT_MODALITIES = ['text', 'image', 'file', 'audio'];
export const OUTPUT_MODALITIES = ['text', 'image'];
// Provider color mapping for UI
export const PROVIDER_COLORS = {
    openai: '#10a37f',
    anthropic: '#d97757',
    google: '#4285f4',
    'meta-llama': '#0668e1',
    mistralai: '#ff7000',
    deepseek: '#1890ff',
    qwen: '#722ed1',
    cohere: '#39594c',
    perplexity: '#20808d',
    together: '#ff6b35',
};
// Default model slug for fallback
export const DEFAULT_MODEL_SLUG = 'openai/gpt-4o-mini';
export const AGENT_SETTINGS_AI_REWRITE_MODEL = 'google/gemini-3-flash-preview';
export const TOOL_SETTINGS_AI_DEFINITION_MODEL = 'google/gemini-3-flash-preview';
export const AGENT_EDITABLE_FIELDS = [
    'systemInstructions',
    'query',
    'jsonFormat',
];
export const TOOL_ARGUMENT_DATA_TYPES = [
    'String',
    'Number',
    'Boolean',
    'JsonObj',
    'Array',
];
export const TOOL_ARGUMENT_TYPE_DEFINITION_MODES = [
    'typescript',
    'json-schema',
];
// Image aspect ratio options for image generation
export const IMAGE_ASPECT_RATIOS = [
    { value: '1:1', label: 'Square (1:1)', dimensions: '1024×1024' },
    { value: '2:3', label: 'Portrait (2:3)', dimensions: '832×1248' },
    { value: '3:2', label: 'Landscape (3:2)', dimensions: '1248×832' },
    { value: '3:4', label: 'Portrait (3:4)', dimensions: '864×1184' },
    { value: '4:3', label: 'Landscape (4:3)', dimensions: '1184×864' },
    { value: '4:5', label: 'Portrait (4:5)', dimensions: '896×1152' },
    { value: '5:4', label: 'Landscape (5:4)', dimensions: '1152×896' },
    { value: '9:16', label: 'Mobile Portrait (9:16)', dimensions: '768×1344' },
    { value: '16:9', label: 'Widescreen (16:9)', dimensions: '1344×768' },
    { value: '21:9', label: 'Ultra-wide (21:9)', dimensions: '1536×672' },
];
export const getDefaultAgentServiceState = () => ({
    selectedModel: undefined, // Will be set when user selects a model
    systemInstructions: 'You are a helpful assistant that can answer questions and help with tasks.',
    query: '',
    jsonResponse: false,
    jsonFormat: '',
    jsonSchemaMode: 'typescript',
    fileParser: 'native',
    imageAspectRatio: '1:1',
    maxIterations: 10,
    reasoningEffort: 'medium',
    allowFallbacks: true,
    temperature: 1.0,
});
export const getDefaultToolServiceState = () => ({
    name: '',
    description: '',
    arguments: [],
    timeout: 0, // 0 means no timeout
});
export const getDefaultSubmitServiceState = () => ({
// Empty state - Submit variant has no configuration
});
export const getDefaultHistoryServiceState = () => ({
    includeAttachments: false, // Default to metadata only for performance
    timeout: 30, // 30 seconds default timeout for history retrieval
});
export const getDefaultChatInterfaceServiceState = () => ({
    draftMessage: '',
    pollingIntervalMs: 150,
    lastPolledAt: Date.now(),
});
export const PLATFORM_PROXY_URLS = {
    production: 'https://platform.app.kemu.io/v1/openrouter',
    stage: 'https://platform.stage.kemu.io/v1/openrouter',
    development: 'https://platform.dev.kemu.io/v1/openrouter',
    // development: 'http://localhost:6100/v1/openrouter',
    local: 'http://localhost:6001/v1/openrouter',
    test: 'http://localhost:6001/v1/openrouter',
};
export const getPlatformProxyUrl = (environment) => {
    // Determine environment from env vars or default to development
    const envKey = environment.toLowerCase();
    return PLATFORM_PROXY_URLS[envKey];
};
//# sourceMappingURL=constants.js.map