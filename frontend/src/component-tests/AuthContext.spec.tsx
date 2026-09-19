import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import AuthContextHarness from "./AuthContextHarness";
import {
  TOKEN_A_LATE,
  TOKEN_A_REFRESH,
  TOKEN_B,
  USER_A,
  USER_B,
} from "./authContextFixture";

async function installApi(page: Page): Promise<{ releaseLateA: () => void }> {
  let releaseLateA = () => {};
  const lateA = new Promise<void>((resolve) => {
    releaseLateA = resolve;
  });
  let delayed = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const auth = request.headers().authorization?.replace(/^Bearer /, "") ?? "";
    const userId = auth === TOKEN_B ? USER_B : USER_A;

    if (url.pathname === "/api/auth/me") {
      if (auth === TOKEN_A_LATE && !delayed) {
        delayed = true;
        await lateA;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: userId,
          username: userId === USER_A ? "alice" : "bob",
          timezone: "UTC",
          encrypted_kek_verifier_content: null,
          encrypted_kek_verifier_dek: null,
        }),
      });
      return;
    }

    if (url.pathname === "/api/auth/refresh") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: userId === USER_A ? TOKEN_A_REFRESH : TOKEN_B,
          token_type: "bearer",
        }),
      });
      return;
    }

    if (url.pathname === "/api/auth/kek-verifier") {
      await route.fulfill({ status: 204 });
      return;
    }

    if (url.pathname === "/api/entries") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }

    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  return { releaseLateA };
}

test("login, reload unlock, logout and account switch preserve key isolation", async ({
  mount,
  page,
}) => {
  await installApi(page);
  const component = await mount(<AuthContextHarness />);

  await component.getByRole("button", { name: "Login A", exact: true }).click();
  await expect(component.getByTestId("user")).toHaveText(USER_A);
  await expect(component.getByTestId("full")).toHaveText("true");
  const sessionA = Number(await component.getByTestId("session").textContent());

  await component.unmount();
  const reloaded = await mount(<AuthContextHarness />);
  await expect(reloaded.getByTestId("user")).toHaveText(USER_A);
  await expect(reloaded.getByTestId("needs-unlock")).toHaveText("true");
  await expect(reloaded.getByTestId("full")).toHaveText("false");

  await reloaded.getByRole("button", { name: "Unlock" }).click();
  await expect(reloaded.getByTestId("full")).toHaveText("true");
  await expect(reloaded.getByTestId("token")).toHaveText(TOKEN_A_REFRESH);

  await reloaded.getByRole("button", { name: "Logout" }).click();
  await expect(reloaded.getByTestId("user")).toHaveText("none");
  await expect(reloaded.getByTestId("token")).toHaveText("none");

  await reloaded.getByRole("button", { name: "Login B" }).click();
  await expect(reloaded.getByTestId("user")).toHaveText(USER_B);
  await expect(reloaded.getByTestId("full")).toHaveText("true");
  expect(Number(await reloaded.getByTestId("session").textContent())).toBe(sessionA + 2);
});

test("late authentication response cannot overwrite the newer account session", async ({
  mount,
  page,
}) => {
  const { releaseLateA } = await installApi(page);
  const component = await mount(<AuthContextHarness />);

  await component.getByRole("button", { name: "Login A", exact: true }).click();
  await expect(component.getByTestId("user")).toHaveText(USER_A);
  const sessionA = Number(await component.getByTestId("session").textContent());
  await component.getByRole("button", { name: "Logout" }).click();

  await component.getByRole("button", { name: "Login A delayed" }).click({ noWaitAfter: true });
  await component.getByRole("button", { name: "Login B" }).click();
  await expect(component.getByTestId("user")).toHaveText(USER_B);
  await expect(component.getByTestId("token")).toHaveText(TOKEN_B);
  expect(Number(await component.getByTestId("session").textContent())).toBe(sessionA + 2);

  releaseLateA();
  await page.waitForTimeout(100);
  await expect(component.getByTestId("user")).toHaveText(USER_B);
  await expect(component.getByTestId("token")).toHaveText(TOKEN_B);
  await expect(component.getByTestId("error")).toHaveText("");
});
