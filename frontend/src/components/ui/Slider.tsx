interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  hint?: string;
  unit?: string;
  showMax?: boolean;
}

export default function Slider({
  label,
  value,
  min = 1,
  max = 10,
  onChange,
  hint,
  unit,
  showMax = true,
}: SliderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <label className="text-sm text-zinc-300">{label}</label>
        <span className="text-sm font-mono tabular-nums text-zinc-200">
          {value}
          {unit ? <span className="text-zinc-500"> {unit}</span> : null}
          {showMax && !unit ? <span className="text-zinc-500">/{max}</span> : null}
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
