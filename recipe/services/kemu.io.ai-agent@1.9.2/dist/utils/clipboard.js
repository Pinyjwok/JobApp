/**
 * Copy text to the clipboard using the best available strategy.
 * @param text - The text to copy.
 * @returns Promise that resolves to true if copy succeeded, otherwise false.
 */
export const copyTextToClipboard = async (text) => {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    }
    catch {
        // fall through to legacy copy path
    }
    try {
        if (typeof document === 'undefined') {
            return false;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '0';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    }
    catch {
        return false;
    }
};
//# sourceMappingURL=clipboard.js.map