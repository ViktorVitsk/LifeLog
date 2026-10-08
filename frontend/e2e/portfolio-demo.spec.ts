import { expect, test } from "@playwright/test";
import { apiGet, cleanupAccountEntities, login, logout, openSettings, triggerOnlineSync, unlockIfNeeded, type TestAccount } from "./helpers";
import { DEMO_PASSWORD } from "../src/demo/fixtures";

test("fictional demo: registration, manual offline entry, relogin, update, delete and decrypted export", async ({ browser, request }) => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let account: TestAccount | undefined;
  let externalCalls = 0;
  await context.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) {
      externalCalls += 1;
      await route.abort();
    } else await route.continue();
  });
  try {
    await page.goto("/demo.html");
    await page.getByRole("button", { name: "Create fictional demo" }).click();
    await expect(page.getByRole("status")).toContainText("Fictional demo ready", { timeout: 30_000 });
    const username = (await page.getByRole("status").textContent())!.match(/Username: (\w+)/)![1];
    const tokenResponse = await request.post(`${process.env.PLAYWRIGHT_API ?? "http://127.0.0.1:8001"}/api/auth/login`, { data: { username, password: DEMO_PASSWORD } });
    expect(tokenResponse.ok()).toBe(true);
    account = { username, password: DEMO_PASSWORD, token: (await tokenResponse.json()).access_token };
    const seeded = await apiGet<any[]>(request, account, "/api/entries?limit=1000");
    expect(seeded).toHaveLength(16);
    expect(seeded.find((row) => row.entry_type === "GOAL_UPDATE")?.goal_id).toBeTruthy();
    for (const row of seeded) {
      expect(row.tags).toContain("fictional-demo");
      expect(row.encrypted_content).not.toContain("FICTIONAL DEMO");
    }
    await login(page, account);
    await page.goto("/checkin");
    await unlockIfNeeded(page, account);
    await page.getByRole("button", { name: "Мысль", exact: true }).click();
    await context.setOffline(true);
    await page.locator("textarea").fill("[FICTIONAL DEMO] Manual entry created offline.");
    await page.getByRole("button", { name: "Сохранить мысль" }).click();
    const localId = await page.evaluate(async () => {
      const { db } = await import("/src/db/offlineQueue.ts");
      const { listEntries } = await import("/src/db/outbox.ts");
      const row = (await listEntries(db)).find((item) => item.status === "pending" && !item.tags?.includes("fictional-demo"));
      if (!row) throw new Error("Manual entry did not enter the offline queue");
      return row.id;
    });
    await context.setOffline(false);
    await triggerOnlineSync(page);
    await expect.poll(async () => {
      await triggerOnlineSync(page);
      return (await apiGet<any[]>(request, account!, "/api/entries?limit=1000")).length;
    }, { timeout: 40_000 }).toBe(17);
    await logout(page);
    await login(page, account);

    // Journal entries have no general edit UI yet. Exercise the actual
    // encryption/outbox/CAS path rather than claiming that UI exists.
    const updateResult = await page.evaluate(async ({ id, password }) => {
      const { api } = await import("/src/lib/api.ts");
      const { deriveKEK, encryptEntry, decryptEntry } = await import("/src/lib/crypto.ts");
      const { enqueueEntry } = await import("/src/db/offlineQueue.ts");
      const { flushOutbox } = await import("/src/lib/flushOutbox.ts");
      const session = JSON.parse(sessionStorage.getItem("lifelog.session")!);
      const kek = await deriveKEK(password, session.salt, session.kdfVersion);
      const row = (await api.listEntries(session.token, { limit: 1000 })).find((item) => item.id === id)!;
      const original = JSON.parse(await decryptEntry(row.encrypted_content, row.encrypted_dek, kek));
      if (!original.content.includes("created offline")) throw new Error("Relogin could not decrypt original entry");
      const encrypted = await encryptEntry(JSON.stringify({ ...original, content: "[FICTIONAL DEMO] Edited after relogin.", fictional_demo: true }), kek);
      await enqueueEntry({ ...row, encrypted_content: encrypted.encryptedContent, encrypted_dek: encrypted.encryptedDek });
      await flushOutbox(session.token, session.userId);
      const stored = (await api.listEntries(session.token, { limit: 1000 })).find((item) => item.id === id)!;
      return { version: stored.version, content: JSON.parse(await decryptEntry(stored.encrypted_content, stored.encrypted_dek, kek)).content };
    }, { id: localId, password: DEMO_PASSWORD });
    expect(updateResult.version).toBe(2);
    expect(updateResult.content).toContain("Edited after relogin");

    await openSettings(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать полный расшифрованный JSON" }).click();
    await download;
    const exported = await page.evaluate(() => (window as any).__lastExport);
    expect(exported.entries).toHaveLength(17);
    expect(exported.report.sections.entries.failed).toBe(0);
    expect(JSON.stringify(exported.entries)).toContain("Edited after relogin");
    await page.evaluate(async (id) => {
      const { markPendingDelete } = await import("/src/db/offlineQueue.ts");
      const { flushOutbox } = await import("/src/lib/flushOutbox.ts");
      const session = JSON.parse(sessionStorage.getItem("lifelog.session")!);
      await markPendingDelete([id]);
      await flushOutbox(session.token, session.userId);
    }, localId);
    const remaining = await apiGet<any[]>(request, account, "/api/entries?limit=1000");
    expect(remaining).toHaveLength(16);
    expect(remaining.some((row) => row.id === localId)).toBe(false);
    expect(externalCalls).toBe(0);
  } finally {
    await context.close().catch(() => undefined);
    if (account) await cleanupAccountEntities(request, account);
  }
});
