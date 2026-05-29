export const getScannerDefaultState = () => {
    const state = {
        path: '',
        ignorePaths: [],
        includeDirectories: false,
        directoriesOnly: false,
    };
    return state;
};
export const getFilterGlobDefaultState = () => {
    const state = {
        filters: [],
    };
    return state;
};
export const getFilterMimeTypeDefaultState = () => {
    const state = {
        mimeTypes: [],
    };
    return state;
};
export const getReadContentsDefaultState = () => {
    const state = {};
    return state;
};
export const getWriteContentsDefaultState = () => {
    const state = {
        path: '',
        append: false,
    };
    return state;
};
export const getDeleteFileDefaultState = () => {
    const state = {
        path: '',
        allowDeleteDirectories: false,
    };
    return state;
};
//# sourceMappingURL=constants.js.map