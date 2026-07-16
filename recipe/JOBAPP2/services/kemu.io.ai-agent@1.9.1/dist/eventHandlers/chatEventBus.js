const MAX_EVENTS_PER_CHANNEL = 500;
const CHANNEL_TTL_MS = 15 * 60 * 1000;
const store = {};
let eventCounter = Date.now();
/**
 * Create a unique event id for chat events.
 * @returns Unique string id.
 */
const createChatEventId = () => `chat-${eventCounter++}`;
/**
 * Ensure channel list exists.
 * @param key Channel key.
 * @returns Channel event list.
 */
const getOrCreateChannel = (key) => {
    const { recipeUuid, chatWidgetId } = key;
    if (!store[recipeUuid]) {
        store[recipeUuid] = {};
    }
    if (!store[recipeUuid][chatWidgetId]) {
        store[recipeUuid][chatWidgetId] = [];
    }
    return store[recipeUuid][chatWidgetId];
};
/**
 * Removes old events beyond TTL and caps list size.
 * @param events Channel event list.
 * @param nowMs Current time.
 * @returns Pruned array.
 */
const pruneChannel = (events, nowMs) => {
    const pruned = events.filter((e) => (nowMs - e.ts) <= CHANNEL_TTL_MS);
    if (pruned.length <= MAX_EVENTS_PER_CHANNEL) {
        return pruned;
    }
    return pruned.slice(pruned.length - MAX_EVENTS_PER_CHANNEL);
};
/**
 * Publish a chat event to the in-processor store.
 * @param config Publish config.
 * @returns The stored ChatEvent.
 */
export const publishChatEvent = (config) => {
    const { recipeUuid, chatWidgetId, invocationId, type, payload } = config;
    const nowMs = Date.now();
    const channel = getOrCreateChannel({ recipeUuid, chatWidgetId });
    const event = {
        id: createChatEventId(),
        ts: nowMs,
        invocationId,
        type,
        payload,
    };
    channel.push(event);
    // prune in place
    store[recipeUuid][chatWidgetId] = pruneChannel(channel, nowMs);
    return event;
};
/**
 * Get chat events for a channel newer than the given cursor.
 * @param config Get config.
 * @returns Events and next cursor.
 */
export const getChatEvents = (config) => {
    const { recipeUuid, chatWidgetId, since } = config;
    const channel = getOrCreateChannel({ recipeUuid, chatWidgetId });
    const nowMs = Date.now();
    const pruned = pruneChannel(channel, nowMs);
    store[recipeUuid][chatWidgetId] = pruned;
    const events = pruned.filter((e) => e.ts > since);
    const nextSince = events.length > 0 ? events[events.length - 1].ts : since;
    return { events, nextSince };
};
/**
 * Clear a chat channel.
 * @param key Channel key.
 * @returns void.
 */
export const clearChatEvents = (key) => {
    const { recipeUuid, chatWidgetId } = key;
    if (!store[recipeUuid]) {
        return;
    }
    store[recipeUuid][chatWidgetId] = [];
};
//# sourceMappingURL=chatEventBus.js.map