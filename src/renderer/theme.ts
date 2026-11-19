import { useCallback, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const key = 'notbot-theme';

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(key);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** System follows the OS through CSS; an explicit choice is pinned with data-theme. */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(key);
    else localStorage.setItem(key, choice);
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
}

/** Current choice plus a setter that applies and persists it. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const update = useCallback((next: ThemeChoice) => {
    applyTheme(next);
    setChoice(next);
  }, []);
  return [choice, update];
}
