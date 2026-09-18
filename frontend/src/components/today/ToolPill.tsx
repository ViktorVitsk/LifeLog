import { useLocale } from "../../context/LocaleContext";

export default function ToolPill({
  name,
  status,
  detail,
}: {
  name: string;
  status: "running" | "done" | "error";
  detail?: string;
}) {
  const { t } = useLocale();
  const label =
    name === "propose_entries"
      ? t.toolPropose
      : name === "show_chart"
        ? t.toolChart
        : name === "get_today_snapshot"
          ? t.toolSnapshot
          : name === "search_entries"
            ? t.toolSearch
            : name.replaceAll("_", " ");
  const tone =
    status === "error"
      ? "border-rose-800 text-rose-200"
      : status === "running"
        ? "border-indigo-800 text-indigo-200"
        : "border-zinc-700 text-zinc-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}
      title={detail}
    >
      {status === "running" ? "…" : status === "error" ? "!" : "✓"} {label}
    </span>
  );
}
