import * as React from "react";

type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolved: Resolved;
  setTheme: (t: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "lumi-theme";

function getSystem(): Resolved {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Storage can throw when site data is blocked; the theme then just follows the system. */
function readSaved(): Theme {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("system");
  const [resolved, setResolved] = React.useState<Resolved>("light");
  const [loaded, setLoaded] = React.useState(false);

  // Load saved preference on mount.
  React.useEffect(() => {
    setThemeState(readSaved());
    setLoaded(true);
  }, []);

  // Apply theme to <html> and react to system changes. Waits for the saved
  // preference, so the class set before hydration is not briefly undone.
  React.useEffect(() => {
    if (!loaded) return;
    const apply = () => {
      const next: Resolved = theme === "system" ? getSystem() : theme;
      setResolved(next);
      const root = document.documentElement;
      root.classList.toggle("dark", next === "dark");
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme, loaded]);

  const setTheme = React.useCallback((t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Not remembered, but still applied for this visit.
    }
    setThemeState(t);
  }, []);

  const value = React.useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
