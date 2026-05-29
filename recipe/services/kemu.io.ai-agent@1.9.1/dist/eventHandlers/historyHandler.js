import { DataType } from '@kemu-io/hs';
import { getDefaultHistoryServiceState } from '../constants.js';
import historyRegistry from './historyRegistry.js';
const historyInstanceMap = {};
/**
 * Processes attachments based on configuration settings
 */
const processAttachments = (attachments, includeAttachments) => {
    if (!Array.isArray(attachments)) {
        return [];
    }
    return attachments.map((attachment) => {
        // Handle different attachment types
        if (typeof attachment === 'string') {
            // URL or base64 string
            const isUrl = attachment.startsWith('http://') || attachment.startsWith('https://');
            const metadata = {
                type: isUrl ? 'url' : 'file',
                mimeType: isUrl ? 'text/uri-list' : 'application/octet-stream',
            };
            if (includeAttachments) {
                return {
                    ...metadata,
                    data: attachment,
                };
            }
            return metadata;
        }
        // Handle ImageData type
        if (attachment && typeof attachment === 'object' && 'data' in attachment) {
            const imageData = attachment;
            const metadata = {
                type: 'image',
                mimeType: 'image/png',
            };
            if (includeAttachments) {
                // Convert ImageData to base64
                const base64 = Buffer.from(imageData.data).toString('base64');
                return {
                    ...metadata,
                    data: `data:image/png;base64,${base64}`,
                    width: imageData.width,
                    height: imageData.height,
                };
            }
            return metadata;
        }
        // Handle BinaryFile type
        if (attachment && typeof attachment === 'object' && 'fileName' in attachment) {
            const binaryFile = attachment;
            const metadata = {
                type: 'file',
                fileName: binaryFile.fileName,
                mimeType: binaryFile.format,
                fileSize: binaryFile.data.byteLength,
            };
            if (includeAttachments) {
                const base64 = Buffer.from(binaryFile.data).toString('base64');
                return {
                    ...metadata,
                    data: `data:${binaryFile.format};base64,${base64}`,
                };
            }
            return metadata;
        }
        // Fallback for unknown attachment types
        const metadata = {
            type: 'file',
            mimeType: 'application/octet-stream',
        };
        if (includeAttachments) {
            return {
                ...metadata,
                data: JSON.stringify(attachment),
            };
        }
        return metadata;
    });
};
/**
 * Creates or retrieves a history event instance and returns the promise
 */
export const registerHistoryEvent = (config) => {
    const { recipeUuid, eventId, timeout } = config;
    const existingInstance = historyInstanceMap[recipeUuid]?.events?.[eventId];
    if (existingInstance) {
        return existingInstance;
    }
    if (!historyInstanceMap[recipeUuid]) {
        historyInstanceMap[recipeUuid] = {};
    }
    let resolveFn;
    let rejectFn;
    const promise = new Promise((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });
    const eventInstance = {
        promise,
        resolve: resolveFn,
        reject: rejectFn,
    };
    // Set up timeout if specified and greater than 0
    if (timeout && timeout > 0) {
        const timeoutHandle = setTimeout(() => {
            eventInstance.reject(new Error(`History retrieval timed out after ${timeout} seconds. Please check your history storage configuration and try again.`));
            // Clean up the event from the registry
            delete historyInstanceMap[recipeUuid]?.events?.[eventId];
        }, timeout * 1000); // Convert seconds to milliseconds
        eventInstance.timeoutHandle = timeoutHandle;
    }
    if (!historyInstanceMap[recipeUuid].events) {
        historyInstanceMap[recipeUuid].events = {};
    }
    historyInstanceMap[recipeUuid].events[eventId] = eventInstance;
    return eventInstance;
};
/**
 * Sets the caller widget id as the processing widget id
 */
const registerHistoryProcessing = (config) => {
    const { recipeUuid, eventId, widgetId } = config;
    const existingInstance = historyInstanceMap[recipeUuid]?.events?.[eventId];
    if (!existingInstance) {
        throw new Error(`History event id [${eventId}] not found`);
    }
    if (existingInstance.widgetId) {
        throw new Error(`History event id [${eventId}] is already being processed by widget [${existingInstance.widgetId}]`);
    }
    existingInstance.widgetId = widgetId;
    return existingInstance;
};
/**
 * Resolves the history execution and removes the history instance from the registry
 */
export const resolveHistoryExecution = (config) => {
    const { recipeUuid, eventId, result } = config;
    const existingInstance = historyInstanceMap[recipeUuid]?.events?.[eventId];
    if (!existingInstance) {
        console.warn(`History event id [${eventId}] not found, ignoring submission event`);
        return;
    }
    // Clear timeout if it exists
    if (existingInstance.timeoutHandle) {
        clearTimeout(existingInstance.timeoutHandle);
    }
    existingInstance.resolve(result);
    delete historyInstanceMap[recipeUuid]?.events?.[eventId];
};
/**
 * Handle parent events for History variant
 * Processes history requests and manages conversation sessions
 */
export const handleHistoryParentEvent = async (event, context) => {
    console.log('History event received:', event.data);
    const historyState = {
        ...getDefaultHistoryServiceState(),
        ...context.currentState,
    };
    // Handle clear history signal (no action needed - session management is handled by agent)
    if (event.data.type === DataType.Anything && event.eventContext?.type === 'clear-history') {
        console.log('History clear signal received');
        return;
    }
    // Handle history discovery event
    const isHistoryDiscoveryEvent = event.eventContext?.type === 'history-discovery';
    const discoveryEventId = event.eventContext?.id;
    if (isHistoryDiscoveryEvent && discoveryEventId) {
        // Register this history variant for discovery
        historyRegistry.addHistoryToRegistry({
            eventId: discoveryEventId,
            widgetId: context.widgetId,
            timeout: historyState.timeout,
        });
        console.log(`History variant registered for discovery: ${context.widgetId}`);
        return;
    }
    // Handle history retrieval request
    const isHistoryRetrievalEvent = event.eventContext?.type === 'history-retrieval';
    const retrievalEventId = event.eventContext?.executionId;
    const sessionId = event.eventContext?.sessionId;
    if (isHistoryRetrievalEvent && retrievalEventId) {
        // Register and wait for history processing
        const historyInstance = registerHistoryProcessing({
            recipeUuid: context.recipe.uuid,
            eventId: retrievalEventId,
            widgetId: context.widgetId,
        });
        // Request existing session history
        // await context.setOutputsWithContext({
        //   outputs: [
        //     {
        //       name: 'history',
        //       type: DataType.JsonObj,
        //       value: { sessionId } as SupportedTypes,
        //     },
        //   ],
        //   eventContext: {
        //     type: 'history-request',
        //     sessionId: sessionId || '',
        //     executionId: retrievalEventId,
        //   },
        // });
        // Invoke child widgets to initiate retrieval of history (user custom logic)
        await context.setOutputs([
            {
                name: 'getHistory',
                type: DataType.JsonObj,
                value: { sessionId },
            },
        ]);
        await historyInstance.promise.catch((e) => {
            console.log(`History retrieval [${historyInstance.widgetId}] rejected:`, e);
        }).finally(() => {
            // Clear timeout if it exists
            if (historyInstance.timeoutHandle) {
                clearTimeout(historyInstance.timeoutHandle);
            }
            console.log('History retrieval resolved');
        });
        return;
    }
    // Handle conversation update (storing new messages)
    const isConversationUpdate = event.eventContext?.type === 'conversation-update';
    if (isConversationUpdate && event.data.type === DataType.JsonObj) {
        const conversationData = event.data.value;
        const currentSessionId = conversationData.sessionId;
        if (!currentSessionId) {
            console.warn('No session ID available for conversation update');
            return;
        }
        // Create conversation messages
        const messages = [];
        const timestamp = Date.now();
        // Add user message if present
        if (conversationData.userMessage) {
            const userMessage = {
                role: 'user',
                content: conversationData.userMessage,
                timestamp,
            };
            // Process attachments if present
            if (conversationData.attachments && Array.isArray(conversationData.attachments)) {
                userMessage.attachments = processAttachments(conversationData.attachments, historyState.includeAttachments);
            }
            messages.push(userMessage);
        }
        // Add assistant message if present
        if (conversationData.assistantMessage) {
            const assistantMessage = {
                role: 'assistant',
                content: conversationData.assistantMessage,
                timestamp: timestamp + 1, // Ensure ordering
            };
            // Add tool calls if present
            if (conversationData.toolCalls && Array.isArray(conversationData.toolCalls)) {
                assistantMessage.tool_calls = conversationData.toolCalls;
            }
            messages.push(assistantMessage);
        }
        // Create session update data
        const sessionUpdate = {
            sessionId: currentSessionId,
            createdAt: timestamp,
            lastUpdated: timestamp,
            messages,
        };
        // Output the session update for storage
        await context.setOutputsWithContext({
            outputs: [
                {
                    name: 'updateHistory',
                    type: DataType.JsonObj,
                    value: sessionUpdate,
                },
            ],
        });
        return;
    }
    console.warn('Unknown history event type:', event.eventContext?.type);
};
/**
 * Cancel any pending promises and remove the history instance from the registry
 */
export const terminateHistoryInstance = (recipeUuid, widgetId) => {
    const instance = historyInstanceMap[recipeUuid];
    if (!instance?.events) {
        return;
    }
    // Find and terminate events for this widget
    Object.entries(instance.events).forEach(([eventId, eventInfo]) => {
        if (eventInfo.widgetId === widgetId) {
            // Clear timeout if it exists
            if (eventInfo.timeoutHandle) {
                clearTimeout(eventInfo.timeoutHandle);
            }
            eventInfo.reject(new Error('History instance terminated'));
            delete instance.events[eventId];
        }
    });
};
//# sourceMappingURL=historyHandler.js.map