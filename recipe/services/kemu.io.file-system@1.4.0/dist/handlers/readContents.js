import { DataType } from '@kemu-io/hs';
import mime from 'mime-types';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
// Fixes invalid mime types
mime.types['ts'] = 'application/typescript';
mime.types['tsx'] = 'application/x-typescript';
/**
 * Filters a list of files based on mime types
 */
export const handleReadContents = async (event, context) => {
    if (event.target.portName === 'files') {
        const wasArrayInput = event.data.type === DataType.Array && Array.isArray(event.data.value);
        const pathsToRead = wasArrayInput ? event.data.value : [event.data.value];
        const contentsPromises = pathsToRead.map(file => readFile(file));
        const contents = await Promise.all(contentsPromises);
        const binaryOutputs = contents.map((content, index) => {
            const path = pathsToRead[index];
            const format = mime.lookup(path);
            const file = {
                format: format || 'application/octet-stream',
                data: content.buffer,
                fileName: basename(path),
            };
            return file;
        });
        return context.setOutputs([
            {
                name: 'contents',
                type: wasArrayInput ? DataType.Array : DataType.BinaryFile,
                value: wasArrayInput ? binaryOutputs : binaryOutputs[0]
            }
        ]);
    }
};
//# sourceMappingURL=readContents.js.map