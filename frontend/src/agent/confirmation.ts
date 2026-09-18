export type ConfirmationSource = "entry_card" | "manual_form";

/** Metadata the application attaches. Model JSON must never supply these. */
export interface AppCommitMeta {
  user_confirmed: true;
  confirmed_at: string;
  confirmation_source: ConfirmationSource;
  source_turn_id: string | null;
  confirmation_event_id: string;
}

const MODEL_CONFIRMATION_KEYS = [
  "user_confirmed",
  "confirmed_at",
  "confirmation_source",
  "confirmation_event_id",
  "auto_commit",
] as const;

export function stripModelConfirmation<T extends Record<string, unknown>>(raw: T): T {
  const out = { ...raw };
  for (const k of MODEL_CONFIRMATION_KEYS) delete out[k];
  return out;
}

export function appConfirmation(args: {
  source: ConfirmationSource;
  source_turn_id?: string | null;
  now?: Date;
  event_id?: string;
}): AppCommitMeta {
  return {
    user_confirmed: true,
    confirmed_at: (args.now ?? new Date()).toISOString(),
    confirmation_source: args.source,
    source_turn_id: args.source_turn_id ?? null,
    confirmation_event_id: args.event_id ?? crypto.randomUUID(),
  };
}

export function requireAppConfirmation(meta: { user_confirmed?: boolean }): asserts meta is AppCommitMeta {
  if (meta.user_confirmed !== true) {
    throw new Error("persist_requires_user_confirmation");
  }
}
