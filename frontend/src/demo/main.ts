import { api } from "../lib/api";
import { deriveKEK, encryptEntry, wrapKekVerifier } from "../lib/crypto";
import { getCurrentUserId, setCurrentUserId, setEncryptAllowed } from "../lib/accountScope";
import { encryptAndEnqueue } from "../lib/entrySubmit";
import { enqueueLife } from "../lib/lifeQueue";
import { flushOutbox } from "../lib/flushOutbox";
import { saveLlmSettings } from "../agent/settingsStore";
import { DEFAULT_LLM_SETTINGS } from "../agent/types";
import { demoCheckins, DEMO_PASSWORD, DEMO_TAG } from "./fixtures";

const button = document.querySelector<HTMLButtonElement>("#seed")!;
const status = document.querySelector<HTMLElement>("#status")!;
const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
button.disabled = !import.meta.env.DEV || !local;
if (button.disabled) status.textContent = "Demo seeding is available only on a local development server.";

button.addEventListener("click", async () => {
  if (!import.meta.env.DEV || !local) return;
  if (sessionStorage.getItem("lifelog.session") || getCurrentUserId()) {
    status.textContent = "An account is already active. Open a private window to create the demo.";
    return;
  }
  button.disabled = true;
  const username = `fictional_demo_${crypto.randomUUID().replaceAll("-", "")}`;
  status.textContent = "Creating a fresh fictional account…";
  try {
    await api.register(username, DEMO_PASSWORD, "UTC");
    const auth = await api.login(username, DEMO_PASSWORD);
    const me = await api.me(auth.access_token);
    const kek = await deriveKEK(DEMO_PASSWORD, auth.salt, auth.kdf_version);
    await api.putKekVerifier(auth.access_token, await wrapKekVerifier(kek));
    setCurrentUserId(me.id);
    setEncryptAllowed(true);
    const habit = await api.createHabit(auth.access_token, { name: "[FICTIONAL DEMO] Short walk", frequency: "daily" });
    const skill = await api.createSkill(auth.access_token, { name: "[FICTIONAL DEMO] Sketching" });
    const goalId = crypto.randomUUID();
    const goal = await encryptEntry(JSON.stringify({ title: "[FICTIONAL DEMO] Make time for sketching", description: "Invented portfolio fixture", fictional_demo: true }), kek);
    await enqueueLife("goal", { id: goalId, state: "active", habit_ids: [habit.id], skill_ids: [skill.id], entry_ids: [], encrypted_content: goal.encryptedContent, encrypted_dek: goal.encryptedDek });
    for (const fixture of demoCheckins()) await encryptAndEnqueue({ ...fixture, kek });
    await encryptAndEnqueue({ kek, entry_type: "THOUGHT", plaintext: { content: "[FICTIONAL DEMO] I enjoyed drawing an imaginary garden.", fictional_demo: true }, openFields: { tags: [DEMO_TAG] } });
    await encryptAndEnqueue({ kek, entry_type: "GOAL_UPDATE", plaintext: { notes: "[FICTIONAL DEMO] First invented sketch completed.", fictional_demo: true }, openFields: { goal_id: goalId, tags: [DEMO_TAG] } });
    await saveLlmSettings({ ...DEFAULT_LLM_SETTINGS, provider: "synthetic", model: "fictional-local-script", base_url: "synthetic://local", api_key: "" }, kek);
    const result = await flushOutbox(auth.access_token, me.id);
    if (result.error || result.failed || result.saved !== 17) throw new Error(`Demo sync incomplete: ${result.error ?? "some operations were not saved"}`);
    status.textContent = `Fictional demo ready (16 entries and 1 goal).\nUsername: ${username}\nPassword: ${DEMO_PASSWORD}\n\nSign in using the link below. Manual forms work without AI.\nThe development Synthetic provider produces scripted proposals, not model analysis.`;
  } catch (error) {
    status.textContent = `Demo setup failed: ${(error as Error).message}\nAccount attempted: ${username}\nPublic demo password: ${DEMO_PASSWORD}\nPartial fictional data may remain. Use a fresh window to retry; no data was reset.`;
  } finally {
    setEncryptAllowed(false);
    setCurrentUserId(null);
  }
});
