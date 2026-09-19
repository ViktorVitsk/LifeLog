import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API = process.env.PLAYWRIGHT_API ?? "http://127.0.0.1:8001";
export const TEST_PASSWORD = "E2eSynthetic_2026!";

export type TestAccount = {
  username: string;
  password: string;
  token: string;
};

type JsonRow = Record<string, unknown>;

export function uniqueMark(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function createAccount(
  request: APIRequestContext,
  prefix = "pw",
): Promise<TestAccount> {
  const username = uniqueMark(prefix).toLowerCase();
  const registered = await request.post(`${API}/api/auth/register`, {
    data: { username, password: TEST_PASSWORD, timezone: "Europe/Kyiv" },
  });
  expect(registered.status(), await registered.text()).toBe(201);

  const loggedIn = await request.post(`${API}/api/auth/login`, {
    data: { username, password: TEST_PASSWORD },
  });
  expect(loggedIn.status(), await loggedIn.text()).toBe(200);
  const body = (await loggedIn.json()) as { access_token: string };
  return { username, password: TEST_PASSWORD, token: body.access_token };
}

export async function login(page: Page, account: TestAccount): Promise<void> {
  const loginButton = page.getByRole("button", { name: "Войти и получить ключ" });
  if (!(await loginButton.isVisible().catch(() => false))) {
    await page.goto("/login");
  }
  await page.getByPlaceholder("имя пользователя").fill(account.username);
  await page.getByPlaceholder(/мастер-пароль/).fill(account.password);
  await loginButton.click();
  await expect(page.getByRole("link", { name: "Сегодня" })).toBeVisible({ timeout: 20_000 });
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("button", { name: "Войти и получить ключ" })).toBeVisible({
    timeout: 15_000,
  });
}

export async function unlockIfNeeded(page: Page, account: TestAccount): Promise<void> {
  const heading = page.getByRole("heading", { name: "Снова введите мастер-пароль" });
  if (!(await heading.isVisible().catch(() => false))) return;
  await page.getByPlaceholder(/мастер-пароль/).fill(account.password);
  await page.getByRole("button", { name: "Разблокировать" }).click();
  await expect(heading).toHaveCount(0, { timeout: 15_000 });
}

export async function openToday(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Сегодня" }).click();
  await expect(page.getByPlaceholder("Расскажите, что произошло…")).toBeVisible();
}

export async function openSettings(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Настройки" }).click();
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
}

export async function openLife(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Обзор" }).click();
  await page.getByRole("link", { name: "Цели" }).click();
  await expect(page.getByRole("heading", { name: "Цели, память, действия" })).toBeVisible();
}

export async function triggerOnlineSync(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
}

export async function apiGet<T>(
  request: APIRequestContext,
  account: TestAccount,
  path: string,
): Promise<T> {
  const response = await request.get(`${API}${path}`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<T>;
}

async function tombstone(
  request: APIRequestContext,
  account: TestAccount,
  path: string,
  key: "entries" | "items",
  rows: JsonRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const response = await request.post(`${API}${path}`, {
    headers: { Authorization: `Bearer ${account.token}` },
    data: {
      [key]: rows.map((row) => ({
        ...row,
        deleted: true,
      })),
    },
  });
  if (!response.ok()) {
    throw new Error(`${path} cleanup failed: ${response.status()} ${await response.text()}`);
  }
}

export async function cleanupAccountEntities(
  request: APIRequestContext,
  account: TestAccount,
): Promise<void> {
  const [entries, life] = await Promise.all([
    apiGet<JsonRow[]>(request, account, "/api/entries?limit=1000"),
    apiGet<{
      goals: JsonRow[];
      memory: JsonRow[];
      actions: JsonRow[];
      feedback: JsonRow[];
    }>(request, account, "/api/life"),
  ]);

  await tombstone(request, account, "/api/entries/sync", "entries", entries);
  await tombstone(request, account, "/api/life/feedback/sync", "items", life.feedback);
  await tombstone(request, account, "/api/life/actions/sync", "items", life.actions);
  await tombstone(request, account, "/api/life/memory/sync", "items", life.memory);
  await tombstone(request, account, "/api/life/goals/sync", "items", life.goals);
}
