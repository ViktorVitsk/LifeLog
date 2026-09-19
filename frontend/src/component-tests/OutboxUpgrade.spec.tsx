import { expect, test } from "@playwright/experimental-ct-react";
import OutboxUpgradeHarness from "./OutboxUpgradeHarness";

test("Chromium IndexedDB copies v7 into outbox and rolls back a failed upgrade", async ({ mount }) => {
  const component = await mount(<OutboxUpgradeHarness />);
  await expect(component.getByTestId("outbox-upgrade")).toHaveText("ok", { timeout: 30_000 });
});
