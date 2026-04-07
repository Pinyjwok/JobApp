import { DataType } from '@kemu-io/hs';
import { minimatch } from 'minimatch';
import { getFilterGlobDefaultState } from '../common/constants.js';
/**
 * Filters a list of files based on blob patterns
 */
export const handleFilterGlob = async (config) => {
    const { event, context, service } = config;
    const state = {
        ...getFilterGlobDefaultState(),
        ...context.currentState,
    };
    if (event.target.portName === 'files') {
        if (event.data.type !== DataType.Array || !Array.isArray(event.data.value)) {
            console.error('Files must be an array');
            return;
        }
        const files = event.data.value;
        // Parse glob patterns if they contain expressions
        const [parsedFilters] = await service.helpers.parseExpressions({
            expressions: [
                { text: state.filters.join(',') }
            ],
            widgetId: context.widgetId,
        });
        const filtersArray = parsedFilters
            ? parsedFilters.split(',').map(parsed => parsed.trim()).filter(Boolean)
            : [];
        const hasNegativeGlob = filtersArray.some(pattern => pattern.startsWith('!'));
        const filteredFiles = files.filter(file => {
            if (hasNegativeGlob) {
                return filtersArray.every(pattern => minimatch(file, pattern, { matchBase: true }));
            }
            return filtersArray.some(pattern => minimatch(file, pattern, { matchBase: true }));
        });
        return context.setOutputsWithContext({
            outputs: [
                {
                    name: 'files',
                    type: DataType.Array,
                    value: filteredFiles
                }
            ]
        });
    }
};
//# sourceMappingURL=filterGlob.js.map