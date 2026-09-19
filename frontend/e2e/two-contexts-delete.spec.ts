import { expect, type Page, test } from "@playwright/test";
import {
  cleanupAccountEntities,
  createAccount,
  login,
  openLife,
  triggerOnlineSync,
  uniqueMark,
  unlockIfNeeded,
} from "./helpers";

type LifeRow = { id: string; status: string; kind: string };

async function lifeQueue(page: Page): Promise<LifeRow[]> {
  return page.evaluate(async () => {
    const { db } = await import("/src/db/offlineQueue.ts");
    const { listLife } = await import("/src/db/outbox.ts");
    const rows = await listLife(db);
    return rows.map((row) => ({ id: row.id, status: row.status, kind: row.kind }));
  });
}

function openRows(rows: LifeRow[]): LifeRow[] {
  return rows.filter((row) => row.status !== "synced");
}

async function waitForMemory(page: Page, mark: string): Promise<void> {
  await expect(page.getByText(mark)).toBeVisible({ timeout: 25_000 });
}

test("два независимых контекста: удаление памяти не возвращается из кэша B", async ({ browser, request }) => {
  const account = await createAccount(request, "pw_delete");
  const mark = uniqueMark("H2_DEL");
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA, account);
    await login(pageB, account);
    await openLife(pageA);
    await openLife(pageB);

    await pageA.getByPlaceholder("Утверждение").fill(mark);
    await pageA.getByRole("button", { name: "Предложить память" }).click();
    await waitForMemory(pageA, mark);

    const rowA = pageA.locator("div.border-t").filter({ hasText: mark });
    await rowA.getByRole("button", { name: "Принять" }).click();
    await expect(rowA.getByText("на сервере")).toBeVisible({ timeout: 20_000 });

    const created = (await lifeQueue(pageA)).filter((row) => row.kind === "memory");
    expect(created.length).toBeGreaterThan(0);
    const memoryId = created[created.length - 1].id;

    await triggerOnlineSync(pageB);
    await waitForMemory(pageB, mark);
    await expect.poll(async () => (await lifeQueue(pageB)).some((row) => row.id === memoryId && row.status === "synced")).toBe(true);

    const pendingOnB = openRows(await lifeQueue(pageB));
    expect(pendingOnB, "очередь B должна быть пуста до удаления").toEqual([]);

    await rowA.getByRole("button", { name: "Удалить" }).click();
    await expect(pageA.getByText(mark)).toHaveCount(0, { timeout: 20_000 });

    await triggerOnlineSync(pageB);
    await expect(pageB.getByText(mark)).toHaveCount(0, { timeout: 25_000 });
    await expect.poll(async () => (await lifeQueue(pageB)).some((row) => row.id === memoryId)).toBe(false);

    await pageB.getByRole("link", { name: "Сегодня" }).click();
    await openLife(pageB);
    await expect(pageB.getByText(mark)).toHaveCount(0);
    expect((await lifeQueue(pageB)).some((row) => row.id === memoryId)).toBe(false);

    await pageB.reload();
    await unlockIfNeeded(pageB, account);
    await openLife(pageB);
    await expect(pageB.getByText(mark)).toHaveCount(0);
    expect((await lifeQueue(pageB)).some((row) => row.id === memoryId)).toBe(false);
  } finally {
    await contextA.close();
    await contextB.close();
    await cleanupAccountEntities(request, account);
  }
});
