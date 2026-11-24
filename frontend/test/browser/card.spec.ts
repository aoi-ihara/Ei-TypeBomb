import { test, expect, type Page } from "@playwright/test";

const reveal = (page: Page) =>
  page.getByRole("button", { name: "表示", exact: true });
const answer = (page: Page) => page.getByRole("status", { name: "答え" });
const guestStats = (page: Page, id: string) =>
  page.evaluate((itemId) => {
    const memory = JSON.parse(
      localStorage.getItem("playground-memory:guest:shortcut-test") ?? "{}",
    );
    return memory[itemId]?.answerModeStats?.recognition;
  }, id);

async function startCard(page: Page) {
  await page.goto("/card");
  await page
    .getByRole("button", { name: "ゲームを開始", exact: true })
    .click();
  await expect(reveal(page)).toBeEnabled();
  await expect(page.getByRole("progressbar")).toHaveCount(1);
  return (await page.getByText(/^question:/).innerText()).split(": ")[1];
}

test("offline card reveals the answer, records a self-grade and advances", async ({
  page,
}) => {
  const id = await startCard(page);
  await expect(
    page.getByRole("button", { name: "分からなかった" }),
  ).toHaveCount(0);

  await reveal(page).click();
  await expect(answer(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "分からなかった" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "分からなかった" }).click();
  await expect
    .poll(() => guestStats(page, id))
    .toMatchObject({ attempts: 1, correct: 0, unknownCount: 1 });
  await expect(reveal(page)).toBeEnabled();
});

test("double Space reveals and number keys record a card miss", async ({
  page,
}) => {
  const id = await startCard(page);
  await page.getByText(/^question:/).click();
  await page.keyboard.press("Space");
  await expect(reveal(page)).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(answer(page)).toBeVisible();
  await page.keyboard.press("2");
  await expect
    .poll(() => guestStats(page, id))
    .toMatchObject({ attempts: 1, correct: 0 });
  const stats = await guestStats(page, id);
  expect(stats.unknownCount).toBeUndefined();
});

test("dual-role Space/Shift taps reveal a card without a Space keyup", async ({
  page,
}) => {
  await startCard(page);
  await page.getByText(/^question:/).click();
  const remappedTap = () =>
    page.evaluate(() => {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        }),
      );
      // Some dual-role mappers end a short Space tap with Shift keyup.
      target.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Shift",
          code: "ShiftLeft",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await remappedTap();
  await expect(reveal(page)).toBeEnabled();
  await remappedTap();
  await expect(answer(page)).toBeVisible();
});
