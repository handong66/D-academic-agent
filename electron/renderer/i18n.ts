// Bilingual (English default, Chinese) i18n store. Mirrors theme.ts: a tiny external store
// persisted to localStorage, exposed to React via useSyncExternalStore so every component
// re-renders when the language switches. Settings has the picker; default is English.
import { useSyncExternalStore } from "react";
import { dict } from "./i18n.dict";

export type Lang = "en" | "zh";

const STORAGE_KEY = "rr-lang";
let current: Lang = "en";
const listeners = new Set<() => void>();

function isLang(value: string | null): value is Lang {
  return value === "en" || value === "zh";
}

export function initLang(): Lang {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  current = isLang(stored) ? stored : "en"; // default English
  return current;
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  window.localStorage.setItem(STORAGE_KEY, lang);
  for (const cb of listeners) cb();
}

// Resolve a key for the active language; fall back to English, then the key itself.
export function translate(key: string): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[current] || entry.en;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Hook: subscribes the component to language changes and returns the bound translator.
export function useT(): (key: string) => string {
  useSyncExternalStore(subscribe, getLang, () => "en");
  return translate;
}

// Hook: the active language (e.g. for the Settings picker's selected value).
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => "en");
}
