import createService from '@kemu-io/hs';
import { handleScan } from './handlers/scan.js';
import { handleFilterGlob } from './handlers/filterGlob.js';
import { handleFilterMimeType } from './handlers/filterMimeTypes.js';
import { handleReadContents } from './handlers/readContents.js';
import { handleWriteContents } from './handlers/writeContents.js';
import { handleFileToText } from './handlers/file-to-text.js';
import { handleDeleteFile } from './handlers/deleteFile.js';
const service = new createService();
await service.start();
service.onParentEvent(async (event, context) => {
    // console.log('Parent event:', event, context);
    // Scan is the default widget and thus has no variantId
    if (context.variantId === undefined) {
        return handleScan({ event, context, service });
    }
    if (context.variantId === "filter-glob" /* Variants.FilterGlob */) {
        return handleFilterGlob({ event, context, service });
    }
    if (context.variantId === "filter-mime-type" /* Variants.FilterMimeType */) {
        return handleFilterMimeType({ event, context, service });
    }
    if (context.variantId === "read-contents" /* Variants.ReadContents */) {
        return handleReadContents(event, context);
    }
    if (context.variantId === "write-contents" /* Variants.WriteContents */) {
        return handleWriteContents({ event, context, service });
    }
    if (context.variantId === "file-to-text" /* Variants.FileToText */) {
        return handleFileToText(event, context);
    }
    if (context.variantId === "delete-file" /* Variants.DeleteFile */) {
        return handleDeleteFile({ event, context, service });
    }
});
//# sourceMappingURL=processor.js.map