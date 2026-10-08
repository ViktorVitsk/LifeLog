import { expect, test } from "@playwright/experimental-ct-react";
import DecryptedEntriesHarness from "./DecryptedEntriesHarness";

test("same-ID equal-length edits refresh plaintext; failed edits and removals discard it", async ({ mount }) => {
  const component = await mount(<DecryptedEntriesHarness />);
  await component.getByRole("button", { name: "Initial" }).click();
  await expect(component.getByTestId("content")).toHaveText("old");
  const length = await component.getByTestId("length").textContent();
  await component.getByRole("button", { name: "Update" }).click();
  await expect(component.getByTestId("content")).toHaveText("new");
  await expect(component.getByTestId("length")).toHaveText(length!);
  await component.getByRole("button", { name: "Corrupt" }).click();
  await expect(component.getByTestId("content")).toHaveText("empty");
  await expect(component.getByTestId("error")).toHaveText("1");
  await component.getByRole("button", { name: "Initial" }).click();
  await expect(component.getByTestId("content")).toHaveText("old");
  await component.getByRole("button", { name: "Remove" }).click();
  await expect(component.getByTestId("content")).toHaveText("empty");
});
