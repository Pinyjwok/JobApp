import { DataType } from '@kemu-io/hs';
import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { getWriteContentsDefaultState } from '../common/constants.js';
import { dirname, join, resolve } from 'node:path';
const LastWidgetContents = {};
/**
 * Writes contents to a file
 */
export const handleWriteContents = async (config) => {
    const { event, context, service } = config;
    const state = {
        ...getWriteContentsDefaultState(),
        ...context.currentState,
    };
    if (event.target.portName === 'path') {
        if (event.data.type !== DataType.String || typeof event.data.value !== 'string') {
            throw new Error('Path must be a string');
        }
        state.path = event.data.value.trim();
        return context.setState(state);
    }
    if (event.target.portName === 'contents') {
        if (event.data.type !== DataType.BinaryFile) {
            throw new Error('Contents must be a BinaryFile type');
        }
        const binaryFile = event.data.value;
        // IMPORTANT: we keep the contents in the local state instead of the recipe
        // to avoid passing the contents back and forth between the recipe and hub service
        LastWidgetContents[context.widgetId] = binaryFile;
        return;
    }
    // Handle trigger
    if (event.target.portName === 'write') {
        if (!state.path) {
            throw new Error('Missing file path');
        }
        if (!LastWidgetContents[context.widgetId]) {
            throw new Error('Missing file contents');
        }
        try {
            const binaryFile = LastWidgetContents[context.widgetId];
            if (!binaryFile) {
                throw new Error('Missing file contents');
            }
            const [parsedPath] = await service.helpers.parseExpressions({
                expressions: [
                    { text: state.path }
                ],
                widgetId: context.widgetId,
            });
            const data = binaryFile.data;
            if (binaryFile.data === undefined || binaryFile.data === null) {
                throw new Error('Missing `data` property in the provided binary file');
            }
            const buffer = Buffer.from(data);
            const fullPath = join(parsedPath.trim(), binaryFile.fileName || `file_${Date.now()}`);
            const resolvedPath = resolve(fullPath);
            const dirName = dirname(resolvedPath);
            await mkdir(dirName, { recursive: true });
            if (state.append) {
                await appendFile(resolvedPath, buffer);
            }
            else {
                await writeFile(resolvedPath, buffer);
            }
            return context.setOutputsWithContext({
                outputs: [
                    { name: 'success', type: DataType.Boolean, value: true },
                ]
            });
        }
        catch (error) {
            console.error(error);
            throw error;
        }
        finally {
            // clear the contents after writing
            LastWidgetContents[context.widgetId] = undefined;
        }
    }
};
//# sourceMappingURL=writeContents.js.map