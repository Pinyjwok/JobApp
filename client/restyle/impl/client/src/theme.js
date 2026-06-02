import { useState, useEffect } from 'react';

// Reads/writes the active theme and reflects it on <html data-theme>.
// index.css resolves all semantic tokens from that attribute.
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('jobapp-theme') || 'light');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    localStorage.setItem('jobapp-theme', theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, toggle };
}
