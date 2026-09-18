export type AppLocale = "ru" | "en";

const KEY = "lifelog_locale";

export function readStoredLocale(): AppLocale {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "ru" || v === "en") return v;
  } catch {
    /* private mode */
  }
  return "ru";
}

export function writeStoredLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("lifelog-locale", { detail: locale }));
}

export function speechLang(locale: AppLocale): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

export function dateLocale(locale: AppLocale): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

export function htmlLang(locale: AppLocale): string {
  return locale === "ru" ? "ru" : "en";
}
