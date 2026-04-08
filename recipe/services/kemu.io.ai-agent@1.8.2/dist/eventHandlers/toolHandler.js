import { DataType } from '@kemu-io/hs';
import { getDefaultToolServiceState } from '../constants.js';
import { safeJsonParse, getSchemaFromTypes, parseJsonSchema, cleanupOpenApiSchema } from '../utils/schemaConverter.js';
import toolRegistry from './toolRegistry.js';
const toolInstanceMap = {};
/**
 * @returns a tool instance. It creates the instance if it doesn't exist.
 */
export const registerToolEvent = (config) => {
    const { recipeUuid, eventId, timeout, agentWidgetId } = config;
    const existingInstance = toolInstanceMap[recipeUuid]?.events?.[eventId];
    if (existingInstance) {
        return existingInstance;
    }
    if (!toolInstanceMap[recipeUuid]) {
        toolInstanceMap[recipeUuid] = {};
    }
    let resolveFn;
    let rejectFn;
    const promise = new Promise((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = (reason) => reject(reason);
    });
    const eventInstance = {
        promise,
        resolve: resolveFn,
        reject: rejectFn,
        agentWidgetId
    };
    // Set up timeout if specified and greater than 0
    if (timeout && timeout > 0) {
        const timeoutHandle = setTimeout(() => {
            eventInstance.reject(new Error(`Tool execution timed out after ${timeout} seconds. Please check your tool configuration and try again.`));
            // Clean up the event from the registry
            delete toolInstanceMap[recipeUuid]?.events?.[eventId];
        }, timeout * 1000); // Convert seconds to milliseconds
        eventInstance.timeoutHandle = timeoutHandle;
    }
    toolInstanceMap[recipeUuid].events = {
        [eventId]: eventInstance,
    };
    return eventInstance;
};
/**
 * Sets the caller widget id as the processing widget id.
 * @param config
 */
const registerToolProcessing = (config) => {
    const { recipeUuid, eventId, toolWidgetId } = config;
    const existingInstance = toolInstanceMap[recipeUuid]?.events?.[eventId];
    if (!existingInstance) {
        throw new Error(`Event id [${eventId}] not found`);
    }
    if (existingInstance.widgetId) {
        throw new Error(`Event id [${eventId}] is already being processed by a widget [${existingInstance.widgetId}]`);
    }
    existingInstance.widgetId = toolWidgetId;
    return existingInstance;
};
/**
 * Resolves the tool execution and removes the tool instance from the registry.
 * @param config
 */
export const resolveToolExecution = (config) => {
    const { recipeUuid, eventId, result } = config;
    const existingInstance = toolInstanceMap[recipeUuid]?.events?.[eventId];
    if (!existingInstance) {
        console.warn(`Tool event id [${eventId}] not found, ignoring submission event`);
        return;
    }
    // Clear timeout if it exists
    if (existingInstance.timeoutHandle) {
        clearTimeout(existingInstance.timeoutHandle);
    }
    existingInstance.resolve(result);
    delete toolInstanceMap[recipeUuid]?.events?.[eventId];
};
/**
 * Converts a ToolArgumentType to JSON Schema property format
 */
const convertArgumentToJsonSchema = async (arg) => {
    const baseProperty = {
        description: arg.description,
    };
    // If there's a type definition, use it for JsonObj and Array types
    if (arg.typeDefinition && (arg.dataType === 'JsonObj' || arg.dataType === 'Array')) {
        try {
            let schema;
            if (arg.typeDefinitionMode === 'json-schema') {
                // Parse JSON schema directly
                schema = parseJsonSchema(arg.typeDefinition);
            }
            else {
                // Use TypeScript conversion (default behavior)
                const convertedSchema = await getSchemaFromTypes(arg.typeDefinition);
                if (!convertedSchema) {
                    throw new Error('Invalid TypeScript schema format');
                }
                schema = convertedSchema.components.schemas.Schema;
            }
            const cleanedSchema = cleanupOpenApiSchema(schema);
            return { ...baseProperty, ...cleanedSchema };
        }
        catch (error) {
            console.error('Failed to parse type definition for argument:', arg.name, error);
            // Fall back to basic type
        }
    }
    // Basic type mapping when no type definition or conversion fails
    switch (arg.dataType) {
        case 'String':
            baseProperty.type = 'string';
            break;
        case 'Number':
            baseProperty.type = 'number';
            break;
        case 'Boolean':
            baseProperty.type = 'boolean';
            break;
        case 'Array':
            baseProperty.type = 'array';
            if (arg.typeDefinition) {
                baseProperty.description += ` (Type: ${arg.typeDefinition})`;
            }
            break;
        case 'JsonObj':
            baseProperty.type = 'object';
            if (arg.typeDefinition) {
                baseProperty.description += ` (Type: ${arg.typeDefinition})`;
            }
            break;
        // case 'BinaryFile':
        //   // Represent as string with format indication
        //   baseProperty.type = 'string';
        //   baseProperty.description += ' (Binary file data)';
        //   break;
        // case 'ImageData':
        //   // Represent as string with format indication  
        //   baseProperty.type = 'string';
        //   baseProperty.description += ' (Image data)';
        //   break;
        // case 'Anything':
        // default:
        //   // Use no type constraint for maximum flexibility
        //   baseProperty.description += ' (Any type)';
        //   break;
    }
    return baseProperty;
};
/**
 * Converts a ToolServiceState to OpenRouter tool definition format
 */
const convertToolStateToOpenRouterTool = async (toolState) => {
    const properties = {};
    const required = [];
    // Convert each argument to JSON Schema property
    for (const arg of toolState.arguments) {
        properties[arg.name] = await convertArgumentToJsonSchema(arg);
        // Check if argument is required (default to true if not specified)
        if (arg.required !== false) {
            required.push(arg.name);
        }
    }
    return {
        type: 'function',
        function: {
            name: toolState.name,
            description: toolState.description,
            parameters: {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
            },
        },
    };
};
/**
 * Handle parent events for Tool variant
 * Processes tool input and generates arguments based on tool configuration
 */
export const handleToolParentEvent = async (event, context) => {
    // TODO: Implement tool event handling logic
    console.log('Tool event received:', event.data);
    const isToolDiscoveryEvent = event.eventContext?.type === 'tool-discovery';
    const discoveryEventId = event.eventContext?.id;
    const toolState = {
        ...getDefaultToolServiceState(),
        ...context.currentState,
    };
    if (isToolDiscoveryEvent && discoveryEventId) {
        const toolDefinition = await convertToolStateToOpenRouterTool(toolState);
        toolRegistry.addToolToRegistry({
            eventId: discoveryEventId,
            widgetId: context.widgetId,
            name: toolState.name,
            definition: toolDefinition,
            timeout: toolState.timeout,
        });
        return;
    }
    if (event.data.type !== DataType.JsonObj) {
        throw new Error('Invalid input type. Expected a JSON object');
    }
    const toolEvent = event.data.value;
    if (typeof toolEvent.function?.arguments !== 'string') {
        throw new Error('Invalid input. Expected a JSON object with a `name` property');
    }
    // Ignore events for other tools
    if (toolEvent.function?.name !== toolState.name) {
        return;
    }
    const parsedArgs = safeJsonParse(toolEvent.function?.arguments);
    if (!parsedArgs) {
        throw new Error('Invalid input arguments. Expected a valid JSON object');
    }
    const executionId = event.eventContext?.executionId;
    if (!executionId) {
        throw new Error('Invalid event without an execution ID');
    }
    // Assign event to this widget
    const tool = registerToolProcessing({
        recipeUuid: context.recipe.uuid,
        eventId: executionId,
        toolWidgetId: context.widgetId,
    });
    await context.setOutputs([
        {
            name: 'arguments',
            type: DataType.JsonObj,
            value: parsedArgs,
        },
    ]);
    // Wait for the tool to be processed
    await tool.promise.catch((e) => {
        console.log(`Tool execution [${tool.widgetId}] rejected:`, e);
    }).finally(() => {
        // Clear timeout if it exists
        if (tool.timeoutHandle) {
            clearTimeout(tool.timeoutHandle);
        }
        console.log('Tool execution resolved');
    });
};
/**
 * Cancel any pending promises and remove the tool instance from the registry.
 * @param config
 */
export const terminateToolInstance = (config) => {
    const { recipeUuid, agentWidgetId } = config;
    const recipeInstance = toolInstanceMap[recipeUuid];
    if (recipeInstance?.events) {
        const events = recipeInstance.events;
        // Loop through all events and terminate those matching the agent widget ID
        Object.keys(events).forEach(eventId => {
            const eventInstance = events[eventId];
            if (eventInstance.agentWidgetId === agentWidgetId) {
                // Clear timeout if it exists
                if (eventInstance.timeoutHandle) {
                    clearTimeout(eventInstance.timeoutHandle);
                }
                eventInstance.reject(new Error('Tool instance terminated'));
                delete events[eventId];
            }
        });
    }
};
//# sourceMappingURL=toolHandler.js.map