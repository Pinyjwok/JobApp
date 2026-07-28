import { DataType } from '@kemu-io/hs';
import { resolveToolExecution } from './toolHandler.js';
import { resolveHistoryExecution } from './historyHandler.js';
/**
 * Handle parent events for Submit variant
 * Simply passes data through without any processing
 */
export const handleSubmitParentEvent = async (event, context) => {
    console.log('Submit event received:', event.data);
    const executionId = event.eventContext?.executionId;
    const eventType = event.eventContext?.type;
    if (!executionId) {
        throw new Error('A "Tool" or "History" widget must exist as an ancestor of this widget');
    }
    const validTypes = [
        DataType.JsonObj, DataType.Anything,
        DataType.String, DataType.Number,
        DataType.Boolean, DataType.Array,
        DataType.BinaryFile,
    ];
    if (!validTypes.includes(event.data.type)) {
        throw new Error('Invalid input type. Expected a JSON object, anything, string, number, or boolean');
    }
    // Check if this is a history-related event
    if (eventType === 'history-request' || executionId.startsWith('history-retrieval-')) {
        // Handle history resolution
        let historyResult = null;
        if (event.data.type === DataType.JsonObj) {
            historyResult = event.data.value;
        }
        resolveHistoryExecution({
            recipeUuid: context.recipe.uuid,
            eventId: executionId,
            result: historyResult,
        });
    }
    else {
        // Handle tool resolution
        resolveToolExecution({
            recipeUuid: context.recipe.uuid,
            eventId: executionId,
            result: event.data.value,
        });
    }
};
//# sourceMappingURL=submitHandler.js.map