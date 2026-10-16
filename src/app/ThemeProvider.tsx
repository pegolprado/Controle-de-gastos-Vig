import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'system' | 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; resolved: 'light' | 'dark'; setTheme: (t: Theme) => void }>({
  theme: 'system',
  resolved: 'dark',
  setTheme: () => undefined,
});

function resolve(t: Theme): 'light' | 'dark' {
  if (t !== 'system') return t;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('fos.theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });
  const [resolved, setResolved] = useState(() => resolve(theme));

  useEffect(() => {
    const apply = () => {
      const r = resolve(theme);
      setResolved(r);
      document.documentElement.dataset.theme = r;
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem('fos.theme', t);
    } catch {
      /* ignore */
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
