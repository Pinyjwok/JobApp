const URL_INTENT_PATTERN = /\b(url|urls|link|links|source|sources|reference|references|citation|citations|http|https|www|web\s*search|browse|browsing|internet|the\s+internet|look\s+for|find|search\s+(?:the\s+)?web|search\s+(?:the\s+)?internet|look\s+up|lookup)\b/i;
/**
 * Detects whether the user's request explicitly asks for URLs or links.
 *
 * @param prompt - User-provided prompt text.
 * @returns True when URL intent is explicitly requested.
 */
export const hasExplicitUrlRequest = (prompt) => {
    return URL_INTENT_PATTERN.test(prompt);
};
//# sourceMappingURL=urlIntent.js.map