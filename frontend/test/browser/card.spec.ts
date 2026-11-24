import { test, expect, type Page } from "@playwright/test";

const mask = (page: Page) => page.getByRole("button", { name: "解答を表示" });
const unknown = (page: Page) => page.getByRole("button", { name: "分からない" });
const correct = (page: Page) => page.getByRole("button", { name: "正解", exact: true });
const wrong = (page: Page) => page.getByRole("button", { name: "不正解", exact: true });

async function start(page: Page) {
    await page.goto("/?card");
    await page.getByRole("button", { name: "ゲームを開始", exact: true }).click();
    await expect(mask(page)).toBeEnabled();
    return (await page.getByText(/^question:/).innerText()).split(": ")[1];
}

const recognition = (page: Page, id: string) => page.evaluate(itemId =>
    JSON.parse(localStorage.getItem("playground-memory:guest:shortcut-test") ?? "{}")
        [itemId]?.answerModeStats?.recognition, id);

test("card reveals the answer without moving the prompt and records a clean recognition", async ({ page }) => {
    const answer = await start(page);
    const prompt = page.getByText("question: " + answer, { exact: true });
    const before = await prompt.boundingBox();
    await expect(mask(page)).toHaveAttribute("data-cursor", "button");
    await expect(page.getByText(answer, { exact: true })).toHaveCount(0);
    await mask(page).click();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await expect(mask(page)).toHaveCount(0);
    expect(await prompt.boundingBox()).toEqual(before);
    await correct(page).click();
    await expect.poll(() => recognition(page, answer)).toMatchObject({ attempts: 1, correct: 1 });
    await expect(mask(page)).toBeEnabled();
});

for (const rating of ["wrong", "unknown"] as const) {
    test("card " + rating + " records one ordinary missed recognition", async ({ page }) => {
        const answer = await start(page);
        if (rating === "unknown") {
            await unknown(page).click();
            await expect(page.getByText(answer, { exact: true })).toBeVisible();
            await expect(correct(page)).toHaveCount(0);
            await page.getByRole("button", { name: "次へ", exact: true }).click();
        } else {
            await mask(page).click();
            await wrong(page).click();
        }
        await expect.poll(() => recognition(page, answer)).toMatchObject({ attempts: 1, correct: 0 });
        expect((await recognition(page, answer)).unknownCount ?? 0).toBe(0);
        await expect(mask(page)).toBeEnabled();
    });
}

test("card supports keyboard recall and preserves pause behavior", async ({ page }) => {
    const answer = await start(page);
    await page.getByText("question: " + answer, { exact: true }).click();
    await page.keyboard.press("Space");
    await expect(correct(page)).toBeEnabled();
    await page.getByRole("button", { name: "一時停止", exact: true }).click();
    await page.keyboard.press("ArrowRight");
    expect((await recognition(page, answer))?.attempts ?? 0).toBe(0);
    await page.getByRole("button", { name: "再開", exact: true }).click();
    await page.getByText(answer, { exact: true }).click();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => recognition(page, answer)).toMatchObject({ attempts: 1, correct: 1 });
});
