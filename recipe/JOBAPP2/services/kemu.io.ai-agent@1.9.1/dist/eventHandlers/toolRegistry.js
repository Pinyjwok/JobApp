/*
 * Written by Alexander Agudelo < alex@kemu.io >, 2025
 * Date: 14/Oct/2025
 * Last Modified: 14/10/2025, 7:28:40 pm
 * Modified By: Alexander Agudelo
 * Description: This file manages a registry that tracks all tool instances associated with a given agent (using its unique ID).
 * When an event is sent with a specific context ID, it is relayed to every tool instance connected via the 'tools' port.
 * Each tool instance that receives this event adds itself to the registry for that agent.
 * After all child tool executions are finished, the parent agent checks the registry to determine which tool instances are available and registered.
 *
 * ------
 * Copyright (C) 2025 Kemu - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential.
 */
const activeTools = {};
const addToolToRegistry = (config) => {
    const { eventId, widgetId, name, definition, timeout } = config;
    activeTools[eventId] = {
        createdAt: Date.now(),
        widgets: {
            ...activeTools[eventId]?.widgets,
            [widgetId]: {
                name,
                definition,
                timeout,
            },
        },
    };
};
/**
 * Get the tools discovered in the given event
 * @param eventId - The event ID
 * @returns A list of tools discovered in the given event
 */
const getDiscoveredTools = (eventId) => {
    const definitions = [];
    for (const widgetId in activeTools[eventId]?.widgets) {
        definitions.push(activeTools[eventId].widgets[widgetId].definition);
    }
    return definitions;
};
/**
 * Get the timeout for a specific tool by name
 * @param eventId - The event ID
 * @param toolName - The name of the tool
 * @returns The timeout in seconds, or undefined if not found
 */
const getToolTimeout = (eventId, toolName) => {
    for (const widgetId in activeTools[eventId]?.widgets) {
        const widget = activeTools[eventId].widgets[widgetId];
        if (widget.name === toolName) {
            return widget.timeout;
        }
    }
    return undefined;
};
const removeToolFromRegistry = (widgetId) => {
    for (const eventId in activeTools) {
        delete activeTools[eventId].widgets[widgetId];
    }
};
const clearEventRegistry = (eventId) => {
    delete activeTools[eventId];
};
const toolRegistry = {
    addToolToRegistry,
    getDiscoveredTools,
    getToolTimeout,
    removeToolFromRegistry,
    clearEventRegistry,
};
export default toolRegistry;
//# sourceMappingURL=toolRegistry.js.map