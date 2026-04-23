interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  hint?: string;
}

export default function Slider({ label, value, min = 1, max = 10, onChange, hint }: SliderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <label className="text-sm text-zinc-300">{label}</label>
        <span className="text-sm font-mono tabular-nums text-zinc-200">
          {value}
          <span className="text-zinc-500">/{max}</span>
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-indigo-500"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}
