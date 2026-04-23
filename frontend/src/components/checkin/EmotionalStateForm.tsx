import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { encryptAndEnqueue } from "../../lib/entrySubmit";
import Slider from "../ui/Slider";

/**
 * Gap-model emotional state entry.
 *
 * Structure follows ARCHITECTURE §5 EMOTIONAL_STATE:
 *   - resentment: expectation / reality / trigger
 *   - guilt:      my_action / perceived_expectation
 *   - shame:      action / ideal_self
 *   - fear:       threat / missing_solution
 *   - reflection, cognitive_distortion
 *
 * Privacy split:
 *   - OPEN (server-readable): resentment_score, guilt_score, shame_score, fear_score
 *     These power the gap chart and pattern insights.
 *   - ENCRYPTED: every text field above, including cognitive_distortion.
 *     The server only ever sees ciphertext.
 *
 * UX: each emotion has a toggle. Inactive emotions skip both score and text
 * fields — we don't want a null-score entry polluting the chart.
 */

type EmotionKey = "resentment" | "guilt" | "shame" | "fear";

const COGNITIVE_DISTORTIONS = [
  "",
  "all-or-nothing",
  "catastrophizing",
  "mind-reading",
  "overgeneralization",
  "personalization",
  "should-statements",
  "emotional-reasoning",
  "labeling",
  "fortune-telling",
  "mental-filter",
  "disqualifying-positive",
  "other",
] as const;

interface ResentmentFields {
  expectation: string;
  reality: string;
  trigger: string;
}
interface GuiltFields {
  my_action: string;
  perceived_expectation: string;
}
interface ShameFields {
  action: string;
  ideal_self: string;
}
interface FearFields {
  threat: string;
  missing_solution: string;
}

export default function EmotionalStateForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { kek } = useAuth();

  const [active, setActive] = useState<Record<EmotionKey, boolean>>({
    resentment: false,
    guilt: false,
    shame: false,
    fear: false,
  });
  const [scores, setScores] = useState<Record<EmotionKey, number>>({
    resentment: 5,
    guilt: 5,
    shame: 5,
    fear: 5,
  });

  const [resentment, setResentment] = useState<ResentmentFields>({
    expectation: "",
    reality: "",
    trigger: "",
  });
  const [guilt, setGuilt] = useState<GuiltFields>({
    my_action: "",
    perceived_expectation: "",
  });
  const [shame, setShame] = useState<ShameFields>({ action: "", ideal_self: "" });
  const [fear, setFear] = useState<FearFields>({ threat: "", missing_solution: "" });

  const [reflection, setReflection] = useState("");
  const [distortion, setDistortion] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const anyActive = Object.values(active).some(Boolean);

  function toggle(k: EmotionKey) {
    setActive((a) => ({ ...a, [k]: !a[k] }));
  }
  function setScore(k: EmotionKey, v: number) {
    setScores((s) => ({ ...s, [k]: v }));
  }

  async function submit() {
    if (!kek || !anyActive) return;
    setBusy(true);
    setErr(null);
    try {
      const plaintext: Record<string, unknown> = {
        reflection: reflection.trim() || undefined,
        cognitive_distortion: distortion || undefined,
      };
      if (active.resentment) plaintext.resentment = trimObj(resentment);
      if (active.guilt) plaintext.guilt = trimObj(guilt);
      if (active.shame) plaintext.shame = trimObj(shame);
      if (active.fear) plaintext.fear = trimObj(fear);

      await encryptAndEnqueue({
        kek,
        entry_type: "EMOTIONAL_STATE",
        plaintext,
        openFields: {
          resentment_score: active.resentment ? scores.resentment : null,
          guilt_score: active.guilt ? scores.guilt : null,
          shame_score: active.shame ? scores.shame : null,
          fear_score: active.fear ? scores.fear : null,
          tags: (Object.keys(active) as EmotionKey[]).filter((k) => active[k]),
        },
      });

      setActive({ resentment: false, guilt: false, shame: false, fear: false });
      setResentment({ expectation: "", reality: "", trigger: "" });
      setGuilt({ my_action: "", perceived_expectation: "" });
      setShame({ action: "", ideal_self: "" });
      setFear({ threat: "", missing_solution: "" });
      setReflection("");
      setDistortion("");
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        Gap model: name what you feel, find the gap. Enable only the emotions
        that apply today. Only the 0–10 scores leave your device; all text is
        encrypted.
      </p>

      <EmotionCard
        label="Resentment"
        tint="rose"
        hint="Expectation vs reality gap toward others"
        enabled={active.resentment}
        onToggle={() => toggle("resentment")}
        score={scores.resentment}
        onScore={(v) => setScore("resentment", v)}
      >
        <Field
          label="What I expected"
          value={resentment.expectation}
          onChange={(v) => setResentment((x) => ({ ...x, expectation: v }))}
          placeholder="What I expected from the other person"
        />
        <Field
          label="What actually happened"
          value={resentment.reality}
          onChange={(v) => setResentment((x) => ({ ...x, reality: v }))}
          placeholder="What they actually did or said"
        />
        <Field
          label="Specific trigger"
          value={resentment.trigger}
          onChange={(v) => setResentment((x) => ({ ...x, trigger: v }))}
          placeholder="The exact moment it landed"
        />
      </EmotionCard>

      <EmotionCard
        label="Guilt"
        tint="amber"
        hint="Gap between my action and what I think others expected"
        enabled={active.guilt}
        onToggle={() => toggle("guilt")}
        score={scores.guilt}
        onScore={(v) => setScore("guilt", v)}
      >
        <Field
          label="What I did"
          value={guilt.my_action}
          onChange={(v) => setGuilt((x) => ({ ...x, my_action: v }))}
        />
        <Field
          label="What I think others expected"
          value={guilt.perceived_expectation}
          onChange={(v) => setGuilt((x) => ({ ...x, perceived_expectation: v }))}
        />
      </EmotionCard>

      <EmotionCard
        label="Shame"
        tint="fuchsia"
        hint="Gap between my action and my ideal self"
        enabled={active.shame}
        onToggle={() => toggle("shame")}
        score={scores.shame}
        onScore={(v) => setScore("shame", v)}
      >
        <Field
          label="What I did"
          value={shame.action}
          onChange={(v) => setShame((x) => ({ ...x, action: v }))}
        />
        <Field
          label="How my ideal self would act"
          value={shame.ideal_self}
          onChange={(v) => setShame((x) => ({ ...x, ideal_self: v }))}
        />
      </EmotionCard>

      <EmotionCard
        label="Fear"
        tint="sky"
        hint="Gap between perceived threat and the resources I have"
        enabled={active.fear}
        onToggle={() => toggle("fear")}
        score={scores.fear}
        onScore={(v) => setScore("fear", v)}
      >
        <Field
          label="What threat I perceive"
          value={fear.threat}
          onChange={(v) => setFear((x) => ({ ...x, threat: v }))}
        />
        <Field
          label="What resource or solution I lack"
          value={fear.missing_solution}
          onChange={(v) => setFear((x) => ({ ...x, missing_solution: v }))}
        />
      </EmotionCard>

      <div className="grid gap-3 md:grid-cols-[1fr_220px] pt-2">
        <div>
          <label className="text-sm text-zinc-300">Reflection (encrypted)</label>
          <textarea
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-24"
            placeholder="What insight did I get? What would I do differently?"
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-zinc-300">Cognitive distortion</label>
          <select
            className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-[42px]"
            value={distortion}
            onChange={(e) => setDistortion(e.target.value)}
          >
            {COGNITIVE_DISTORTIONS.map((c) => (
              <option key={c} value={c}>
                {c || "— none —"}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-zinc-500 mt-1">Encrypted with the text.</p>
        </div>
      </div>

      {err && (
        <div className="rounded border border-rose-700 bg-rose-900/30 text-rose-200 text-xs p-2">
          {err}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !anyActive}
        className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
      >
        {busy ? "…" : anyActive ? "Save emotional state" : "Enable at least one emotion"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const TINT_CLASSES: Record<string, { border: string; bg: string; dot: string }> = {
  rose: { border: "border-rose-800", bg: "bg-rose-950/30", dot: "bg-rose-500" },
  amber: { border: "border-amber-800", bg: "bg-amber-950/30", dot: "bg-amber-500" },
  fuchsia: {
    border: "border-fuchsia-800",
    bg: "bg-fuchsia-950/30",
    dot: "bg-fuchsia-500",
  },
  sky: { border: "border-sky-800", bg: "bg-sky-950/30", dot: "bg-sky-500" },
};

function EmotionCard({
  label,
  tint,
  hint,
  enabled,
  onToggle,
  score,
  onScore,
  children,
}: {
  label: string;
  tint: keyof typeof TINT_CLASSES;
  hint: string;
  enabled: boolean;
  onToggle: () => void;
  score: number;
  onScore: (v: number) => void;
  children: React.ReactNode;
}) {
  const t = TINT_CLASSES[tint];
  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        enabled ? `${t.border} ${t.bg}` : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-3 w-full text-left"
      >
        <span
          className={`inline-block w-2 h-2 rounded-full ${enabled ? t.dot : "bg-zinc-700"}`}
        />
        <span className="font-medium text-zinc-100">{label}</span>
        <span className="text-[11px] text-zinc-500 hidden sm:block">{hint}</span>
        <span className="ml-auto text-xs text-zinc-400">
          {enabled ? "enabled — click to disable" : "click to enable"}
        </span>
      </button>

      {enabled && (
        <div className="mt-3 space-y-3">
          <Slider label={`${label} intensity`} value={score} onChange={onScore} />
          <div className="grid gap-2">{children}</div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <textarea
        className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 h-16 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function trimObj(obj: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t) out[k] = t;
  }
  return out;
}
