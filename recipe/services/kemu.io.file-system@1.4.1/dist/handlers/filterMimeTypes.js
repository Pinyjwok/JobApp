import { DataType } from '@kemu-io/hs';
import mime from 'mime-types';
import { getFilterMimeTypeDefaultState } from '../common/constants.js';
// Fixes invalid mime types
mime.types['ts'] = 'application/typescript';
mime.types['tsx'] = 'application/x-typescript';
/**
 * Filters a list of files based on mime types
 */
export const handleFilterMimeType = async (config) => {
    const { event, context, service } = config;
    const state = {
        ...getFilterMimeTypeDefaultState(),
        ...context.currentState,
    };
    if (event.target.portName === 'files') {
        if (event.data.type !== DataType.Array || !Array.isArray(event.data.value)) {
            console.error('Files must be an array');
            return;
        }
        const files = event.data.value;
        // Parse mime types if they contain expressions
        const [parsedMimeTypes] = await service.helpers.parseExpressions({
            expressions: [
                { text: state.mimeTypes.join(',') }
            ],
            widgetId: context.widgetId,
        });
        const mimeTypesArray = parsedMimeTypes
            ? parsedMimeTypes.split(',').map(parsed => parsed.trim()).filter(Boolean)
            : [];
        const matchingTypes = files.filter((filePath) => {
            const format = mime.lookup(filePath);
            return format && mimeTypesArray.includes(format);
        });
        return context.setOutputsWithContext({
            outputs: [
                {
                    name: 'files',
                    type: DataType.Array,
                    value: matchingTypes
                }
            ]
        });
    }
};
//# sourceMappingURL=filterMimeTypes.js.map