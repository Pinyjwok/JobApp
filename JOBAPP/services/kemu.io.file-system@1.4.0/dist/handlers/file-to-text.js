import { DataType } from '@kemu-io/hs';
export const handleFileToText = async (event, context) => {
    if (event.target.portName === 'file') {
        if (event.data.type !== DataType.BinaryFile) {
            throw new Error('Expected input type to be a BinaryFile');
        }
        const binaryData = event.data.value;
        const buffer = Buffer.from(binaryData.data);
        const text = buffer.toString(context.currentState.encoding || 'utf8');
        await context.setOutputs([
            {
                name: 'text',
                type: DataType.String,
                value: text
            }
        ]);
    }
};
//# sourceMappingURL=file-to-text.js.map