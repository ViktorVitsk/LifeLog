import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { htmlLang, readStoredLocale, writeStoredLocale, type AppLocale } from "../i18n/locale";
import { STRINGS, type TStrings } from "../i18n/strings";

interface LocaleState {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
  t: TStrings;
}

const Ctx = createContext<LocaleState | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => readStoredLocale());

  const setLocale = (next: AppLocale) => {
    writeStoredLocale(next);
    setLocaleState(next);
    document.documentElement.lang = htmlLang(next);
  };

  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
    const on = (e: Event) => {
      const d = (e as CustomEvent<AppLocale>).detail;
      if (d === "ru" || d === "en") setLocaleState(d);
    };
    window.addEventListener("lifelog-locale", on);
    return () => window.removeEventListener("lifelog-locale", on);
  }, [locale]);

  const value = useMemo<LocaleState>(
    () => ({ locale, setLocale, t: STRINGS[locale] }),
    [locale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLocale must be used inside LocaleProvider");
  return v;
}
