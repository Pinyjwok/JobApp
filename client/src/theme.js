import { useState, useEffect } from 'react';

const STORAGE_KEY = 'jobapp-theme';

// localStorage can throw in restricted contexts (Safari private mode, disabled storage).
// Fail soft to a sane default rather than crashing the app on a theme read/write.
function readStoredTheme() {
  try { return localStorage.getItem(STORAGE_KEY) || 'light'; } catch { return 'light'; }
}
function writeStoredTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage unavailable — ignore */ }
}

// Reads/writes the active theme and reflects it on <html data-theme>.
// index.css resolves all semantic tokens from that attribute.
export function useTheme() {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    writeStoredTheme(theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, toggle };
}
