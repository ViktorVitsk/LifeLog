import { useLocale } from "../context/LocaleContext";
import type { AppLocale } from "../i18n/locale";

export default function LanguageSelect({
  compact = false,
  hideLabel = false,
}: {
  compact?: boolean;
  hideLabel?: boolean;
}) {
  const { locale, setLocale, t } = useLocale();

  return (
    <label className={compact ? "inline-flex items-center gap-1 text-xs text-zinc-400" : "block text-sm"}>
      {compact || hideLabel ? null : t.language}
      <select
        aria-label={t.language}
        className={
          compact
            ? "min-h-[36px] rounded bg-zinc-950 border border-zinc-700 px-2 text-xs text-zinc-200"
            : "mt-1 w-full min-h-[44px] rounded bg-zinc-950 border border-zinc-700 px-3"
        }
        value={locale}
        onChange={(e) => setLocale(e.target.value as AppLocale)}
      >
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
