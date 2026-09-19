import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

const USER = process.env.PLAYWRIGHT_H_USER ?? "qa_h_pw_0919";
const PASS = process.env.PLAYWRIGHT_H_PASS ?? "testdata1HwaveP!";
const API = process.env.PLAYWRIGHT_API ?? "http://127.0.0.1:8001";

type LifeRow = { id: string; status: string; kind: string };

async function ensureAccount(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API}/api/auth/register`, {
    data: { username: USER, password: PASS, timezone: "Europe/Kyiv" },
  });
  if (![200, 201, 409, 422].includes(res.status())) {
    throw new Error(`register failed: ${res.status()} ${await res.text()}`);
  }
}

async function unlockIfNeeded(page: Page): Promise<void> {
  const dlg = page.getByRole("heading", { name: "Снова введите мастер-пароль" });
  if (!(await dlg.isVisible().catch(() => false))) return;
  await page.getByPlaceholder(/мастер-пароль/).fill(PASS);
  await page.getByRole("button", { name: "Разблокировать" }).click();
  await expect(dlg).toHaveCount(0, { timeout: 15_000 });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("имя пользователя").fill(USER);
  await page.getByPlaceholder(/мастер-пароль/).fill(PASS);
  await page.getByRole("button", { name: "Войти и получить ключ" }).click();
  await expect(page.getByRole("link", { name: "Сегодня" })).toBeVisible({ timeout: 20_000 });
}

async function openLife(page: Page): Promise<void> {
  if (!page.url().includes("/insights")) {
    await page.getByRole("link", { name: "Обзор" }).click();
  }
  if (!page.url().includes("/insights/life")) {
    await page.getByRole("link", { name: "Цели" }).click();
  }
  await expect(page.getByRole("heading", { name: "Цели, память, действия" })).toBeVisible();
}

async function triggerNormalSync(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
}

async function lifeQueue(page: Page): Promise<LifeRow[]> {
  return page.evaluate(async () => {
    const { db } = await import("/src/db/offlineQueue.ts");
    const rows = await db.life_queue.toArray();
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
  await ensureAccount(request);

  const mark = `H2_DEL_${Date.now().toString(36)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA);
    await login(pageB);
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

    await triggerNormalSync(pageB);
    await waitForMemory(pageB, mark);
    await expect.poll(async () => (await lifeQueue(pageB)).some((row) => row.id === memoryId && row.status === "synced")).toBe(true);

    const pendingOnB = openRows(await lifeQueue(pageB));
    expect(pendingOnB, "очередь B должна быть пуста до удаления").toEqual([]);

    await rowA.getByRole("button", { name: "Удалить" }).click();
    await expect(pageA.getByText(mark)).toHaveCount(0, { timeout: 20_000 });

    await triggerNormalSync(pageB);
    await expect(pageB.getByText(mark)).toHaveCount(0, { timeout: 25_000 });
    await expect.poll(async () => (await lifeQueue(pageB)).some((row) => row.id === memoryId)).toBe(false);

    await pageB.getByRole("link", { name: "Сегодня" }).click();
    await openLife(pageB);
    await expect(pageB.getByText(mark)).toHaveCount(0);
    expect((await lifeQueue(pageB)).some((row) => row.id === memoryId)).toBe(false);

    await pageB.reload();
    await unlockIfNeeded(pageB);
    await openLife(pageB);
    await expect(pageB.getByText(mark)).toHaveCount(0);
    expect((await lifeQueue(pageB)).some((row) => row.id === memoryId)).toBe(false);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
