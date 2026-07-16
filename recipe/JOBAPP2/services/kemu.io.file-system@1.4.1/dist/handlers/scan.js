import { DataType } from '@kemu-io/hs';
import { glob } from 'glob';
import { getScannerDefaultState } from '../common/constants.js';
import { resolve } from 'node:path';
/**
 * Checks if a path contains glob patterns
 * @param path - The path to check
 * @returns true if the path contains glob patterns, false otherwise
 */
const hasGlobPatterns = (path) => {
    return /[*?[\]{}]/.test(path);
};
/**
 * Scans a directory and returns a list of files
 * Supports both regular directory paths and glob patterns in the path itself
 */
export const handleScan = async (config) => {
    const { event, context, service } = config;
    const state = {
        ...getScannerDefaultState(),
        ...context.currentState,
    };
    if (event.target.portName === 'path') {
        if (event.data.type !== DataType.String || typeof event.data.value !== 'string') {
            console.error('Folder Path must be a string');
            return;
        }
        state.path = event.data.value.trim();
        return context.setState(state);
    }
    if (event.target.portName === 'ignorePaths') {
        if (event.data.type !== DataType.String || typeof event.data.value !== 'string') {
            console.error('Ignore Paths must be a string');
            return;
        }
        state.ignorePaths = event.data.value.split(',').map((path) => path.trim());
        return context.setState(state);
    }
    // Trigger
    if (event.target.portName === 'scan') {
        if (!state.path) {
            console.error('Missing Folder Path');
            return;
        }
        const [parsedPath, parsedIgnorePaths] = await service.helpers.parseExpressions({
            expressions: [
                { text: state.path },
                { text: state.ignorePaths.join(',') }
            ],
            widgetId: context.widgetId,
        });
        let filePaths;
        const finalIgnorePaths = parsedIgnorePaths.split(',');
        const scapedPath = resolve(parsedPath.trim());
        if (hasGlobPatterns(scapedPath)) {
            // Path contains glob patterns - use the path as the glob pattern
            filePaths = await glob(scapedPath, {
                ignore: finalIgnorePaths,
                withFileTypes: true,
            });
        }
        else {
            // Regular directory path - scan all files within it
            filePaths = await glob('**/*', {
                cwd: scapedPath,
                ignore: finalIgnorePaths,
                withFileTypes: true,
            });
        }
        const files = filePaths.filter(file => state.directoriesOnly
            ? file.isDirectory()
            : (state.includeDirectories ? true : file.isFile())).map(file => file.fullpath());
        return context.setOutputsWithContext({
            outputs: [
                {
                    name: 'files',
                    type: DataType.Array,
                    value: files
                }
            ]
        });
    }
};
//# sourceMappingURL=scan.js.map