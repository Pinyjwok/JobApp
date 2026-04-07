/**
 * Registry for managing history variant discovery and registration
 * Similar to toolRegistry but for history variants
 */
class HistoryRegistry {
    discoveredHistories = {};
    /**
     * Adds a history variant to the registry for a specific discovery event
     */
    addHistoryToRegistry = (config) => {
        const { eventId, widgetId, timeout } = config;
        if (!this.discoveredHistories[eventId]) {
            this.discoveredHistories[eventId] = [];
        }
        // Check if this widget is already registered for this event
        const existingEntry = this.discoveredHistories[eventId].find(entry => entry.widgetId === widgetId);
        if (!existingEntry) {
            this.discoveredHistories[eventId].push({
                eventId,
                widgetId,
                timeout,
            });
        }
    };
    /**
     * Gets all discovered history variants for a specific discovery event
     */
    getDiscoveredHistories = (eventId) => {
        return this.discoveredHistories[eventId] || [];
    };
    /**
     * Clears all discovered histories for a specific discovery event
     */
    clearDiscoveredHistories = (eventId) => {
        delete this.discoveredHistories[eventId];
    };
}
const historyRegistry = new HistoryRegistry();
export default historyRegistry;
//# sourceMappingURL=historyRegistry.js.map