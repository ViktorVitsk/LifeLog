export const ENTITY_COLORS = [
  "#10b981",
  "#14b8a6",
  "#0ea5e9",
  "#6366f1",
  "#8b5cf6",
  "#f43f5e",
  "#f59e0b",
  "#a1a1aa",
];

export function ChoiceGrid({
  items,
  value,
  onChange,
}: {
  items: { id: string; name: string; color?: string | null; hint?: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = String(value) === String(it.id);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={`min-h-[44px] px-3 rounded-xl border text-sm inline-flex items-center gap-2 max-w-full ${
              on
                ? "border-indigo-500 bg-indigo-950/70 text-indigo-50"
                : "border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: it.color || "#71717a" }}
            />
            <span className="truncate">{it.name}</span>
            {it.hint ? <span className="text-[10px] text-zinc-500 shrink-0">{it.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string; activeClass?: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`min-h-[44px] rounded-xl border text-sm ${
              on
                ? o.activeClass ?? "border-indigo-500 bg-indigo-600 text-white"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ColorDots({
  value,
  onChange,
  colors = ENTITY_COLORS,
}: {
  value: string;
  onChange: (c: string) => void;
  colors?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {colors.map((c) => {
        const on = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => onChange(c)}
            className={`w-8 h-8 rounded-full border-2 ${
              on ? "border-white scale-110" : "border-transparent opacity-80 hover:opacity-100"
            }`}
            style={{ background: c }}
          />
        );
      })}
    </div>
  );
}
