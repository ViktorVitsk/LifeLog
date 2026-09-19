import { expect, type Page, type Route, test } from "@playwright/test";
import {
  apiGet,
  cleanupAccountEntities,
  createAccount,
  login,
  logout,
  openLife,
  openSettings,
  openToday,
  triggerOnlineSync,
  uniqueMark,
  type TestAccount,
} from "./helpers";

type LifeQueueRow = {
  id: string;
  kind: string;
  status: string;
  queued_at: number;
};

async function latestLocalLife(page: Page, kind: string): Promise<LifeQueueRow> {
  return page.evaluate(async (wantedKind) => {
    const { db } = await import("/src/db/offlineQueue.ts");
    const rows = (await db.life_queue.toArray())
      .filter((row) => row.kind === wantedKind)
      .sort((a, b) => b.queued_at - a.queued_at);
    if (!rows[0]) throw new Error(`No local ${wantedKind} row`);
    return {
      id: rows[0].id,
      kind: rows[0].kind,
      status: rows[0].status,
      queued_at: rows[0].queued_at,
    };
  }, kind);
}

async function configureSynthetic(page: Page): Promise<void> {
  await openSettings(page);
  await page.getByLabel("Провайдер").selectOption("synthetic");
  await page.getByRole("button", { name: "Сохранить агента" }).click();
  await expect(page.getByText("Настройки агента сохранены", { exact: false })).toBeVisible();
}

async function accountHasMemory(
  request: Parameters<typeof apiGet>[0],
  account: TestAccount,
  id: string,
): Promise<boolean> {
  const life = await apiGet<{ memory: { id: string }[] }>(request, account, "/api/life");
  return life.memory.some((row) => row.id === id);
}

test("logout во время synthetic stream отсекает поздний текст и карточку", async ({
  browser,
  request,
}) => {
  const accountA = await createAccount(request, "pw_stream_a");
  const accountB = await createAccount(request, "pw_stream_b");
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, accountA);
    await configureSynthetic(page);
    await openToday(page);
    await page.getByRole("button", { name: "Разобрать" }).click();

    await page.evaluate(() => {
      const w = window as unknown as {
        __setSyntheticChatHandler: (handler: unknown) => void;
        __releaseLateSynthetic?: () => void;
        __lateSyntheticAttempted?: boolean;
      };
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      w.__releaseLateSynthetic = release;
      w.__lateSyntheticAttempted = false;
      w.__setSyntheticChatHandler(
        async ({ onDelta }: { onDelta?: (text: string) => void }) => {
          onDelta?.("PART_A_");
          await gate;
          w.__lateSyntheticAttempted = true;
          onDelta?.("PART_B_SECRET");
          return {
            content: "PART_A_PART_B_SECRET",
            tool_calls: [
              {
                id: "late-memory",
                type: "function",
                function: {
                  name: "propose_memory",
                  arguments: JSON.stringify({
                    kind: "preference",
                    statement: "LATE_CARD",
                    grounds: "late synthetic callback",
                    entry_ids: [],
                  }),
                },
              },
            ],
          };
        },
      );
    });

    await page.getByPlaceholder("Расскажите, что произошло…").fill("Проверь задержанный ответ");
    await page.getByRole("button", { name: "↑" }).click();
    await expect(page.getByText("PART_A_", { exact: true })).toBeVisible();

    await logout(page);
    await login(page, accountB);
    await page.evaluate(() => {
      (
        window as unknown as { __releaseLateSynthetic?: () => void }
      ).__releaseLateSynthetic?.();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __lateSyntheticAttempted?: boolean })
              .__lateSyntheticAttempted,
        ),
      )
      .toBe(true);
    await expect(page.getByText("PART_B_SECRET", { exact: false })).toHaveCount(0);
    await expect(page.getByText("LATE_CARD", { exact: false })).toHaveCount(0);

    await logout(page);
    await login(page, accountA);
    await expect(page.getByText("PART_B_SECRET", { exact: false })).toHaveCount(0);
    await expect(page.getByText("LATE_CARD", { exact: false })).toHaveCount(0);
  } finally {
    await context.close();
    await cleanupAccountEntities(request, accountA);
    await cleanupAccountEntities(request, accountB);
  }
});

test("offline life save повторно отправляется после online", async ({ browser, request }) => {
  const account = await createAccount(request, "pw_offline");
  const context = await browser.newContext();
  const page = await context.newPage();
  const mark = uniqueMark("OFFLINE_MEMORY");

  try {
    await login(page, account);
    await openLife(page);
    await context.setOffline(true);

    await page.getByPlaceholder("Утверждение").fill(mark);
    await page.getByRole("button", { name: "Предложить память" }).click();
    const row = page.locator("div.border-t").filter({ hasText: mark });
    await expect(row.getByText("на устройстве")).toBeVisible();

    await context.setOffline(false);
    await triggerOnlineSync(page);
    await expect(row.getByText("на сервере")).toBeVisible({ timeout: 25_000 });
    const local = await latestLocalLife(page, "memory");
    await expect.poll(() => accountHasMemory(request, account, local.id)).toBe(true);
  } finally {
    await context.close();
    await cleanupAccountEntities(request, account);
  }
});

test("полный экспорт отменяется при смене аккаунта во время GET entries", async ({
  browser,
  request,
}) => {
  const accountA = await createAccount(request, "pw_export_a");
  const accountB = await createAccount(request, "pw_export_b");
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let heldRoute: Route | undefined;
  let signalHeld!: () => void;
  const routeHeld = new Promise<void>((resolve) => {
    signalHeld = resolve;
  });
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });

  try {
    await login(page, accountA);
    await openSettings(page);
    await page.evaluate(() => {
      delete (window as unknown as { __lastExport?: unknown }).__lastExport;
      delete (window as unknown as { __lastExportError?: unknown }).__lastExportError;
    });

    await page.route("**/api/entries?*", async (route) => {
      if (!heldRoute) {
        heldRoute = route;
        signalHeld();
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Скачать полный расшифрованный JSON" }).click();
    await routeHeld;
    await logout(page);
    await login(page, accountB);
    await heldRoute?.continue();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __lastExportError?: string })
              .__lastExportError ?? "",
        ),
      )
      .toContain("Экспорт отменён");
    expect(downloads).toBe(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __lastExport?: unknown }).__lastExport,
      ),
    ).toBeUndefined();
  } finally {
    if (heldRoute) {
      await heldRoute.abort().catch(() => undefined);
    }
    await context.close();
    await cleanupAccountEntities(request, accountA);
    await cleanupAccountEntities(request, accountB);
  }
});

test("revision conflict показывает оба plaintext и оставляет серверную версию", async ({
  browser,
  request,
}) => {
  const account = await createAccount(request, "pw_conflict");
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const initial = uniqueMark("CONFLICT_BASE");
  const localMark = uniqueMark("LOCAL_VARIANT");
  const serverMark = uniqueMark("SERVER_VARIANT");

  try {
    await login(pageA, account);
    await openLife(pageA);
    await pageA.getByPlaceholder("Утверждение").fill(initial);
    await pageA.getByRole("button", { name: "Предложить память" }).click();
    const initialRowA = pageA.locator("div.border-t").filter({ hasText: initial });
    await expect(initialRowA.getByText("на сервере")).toBeVisible({ timeout: 20_000 });

    await login(pageB, account);
    await openLife(pageB);
    await expect(pageB.getByText(initial, { exact: false })).toBeVisible();

    await contextA.setOffline(true);
    await initialRowA.getByPlaceholder("Изменить").fill(localMark);
    await initialRowA.getByRole("button", { name: "Сохранить" }).click();
    const localRowA = pageA.locator("div.border-t").filter({ hasText: localMark });
    await expect(localRowA.getByText("на устройстве")).toBeVisible();

    const initialRowB = pageB.locator("div.border-t").filter({ hasText: initial });
    await initialRowB.getByPlaceholder("Изменить").fill(serverMark);
    await initialRowB.getByRole("button", { name: "Сохранить" }).click();
    const serverRowB = pageB.locator("div.border-t").filter({ hasText: serverMark });
    await expect(serverRowB.getByText("на сервере")).toBeVisible({ timeout: 20_000 });

    await contextA.setOffline(false);
    await triggerOnlineSync(pageA);
    const localVersion = pageA.getByText("Локальная версия", { exact: true }).locator("..");
    const serverVersion = pageA.getByText("Серверная версия", { exact: true }).locator("..");
    await expect(localVersion).toBeVisible({
      timeout: 25_000,
    });
    await expect(serverVersion).toBeVisible();
    await expect(localVersion).toContainText(localMark);
    await expect(serverVersion).toContainText(serverMark);

    await pageA.getByRole("button", { name: "Оставить серверную" }).click();
    await expect(pageA.getByText("Локальная версия", { exact: true })).toHaveCount(0);
    await expect(pageA.getByText(serverMark, { exact: false })).toBeVisible();
    await expect(pageA.getByText(localMark, { exact: false })).toHaveCount(0);
    await expect(pageA.locator("div.border-t").filter({ hasText: serverMark }).getByText("на сервере")).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
    await cleanupAccountEntities(request, account);
  }
});
