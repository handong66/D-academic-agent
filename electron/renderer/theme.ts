export type ThemeName = "light" | "dark";

const STORAGE_KEY = "rr-theme";

function isThemeName(value: string | null): value is ThemeName {
  return value === "light" || value === "dark";
}

function systemTheme(): ThemeName {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeName): ThemeName {
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function initTheme(): ThemeName {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return applyTheme(isThemeName(stored) ? stored : systemTheme());
}

export function toggleTheme(): ThemeName {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next: ThemeName = current === "dark" ? "light" : "dark";
  window.localStorage.setItem(STORAGE_KEY, next);
  return applyTheme(next);
}
