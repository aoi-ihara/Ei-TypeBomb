import { test, expect, type Page } from "@playwright/test";

const mask = (page: Page) => page.getByRole("button", { name: "解答を表示" });
const unknown = (page: Page) => page.getByRole("button", { name: "分からない" });
const correct = (page: Page) => page.getByRole("button", { name: "正解", exact: true });
const wrong = (page: Page) => page.getByRole("button", { name: "不正解", exact: true });

async function start(page: Page, single = false) {
    await page.goto(single ? "/?card&single" : "/?card");
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
    await expect(prompt).toBeVisible();
    const before = await prompt.boundingBox();
    await expect(mask(page)).toHaveAttribute("data-cursor", "button");
    await expect(page.getByText(answer, { exact: true })).toHaveCount(0);
    await mask(page).click();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await expect(mask(page)).toHaveCount(0);
    await expect.poll(async () => (await prompt.boundingBox())?.y).toBe(before?.y);
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
    await page.keyboard.press("Enter");
    await expect(correct(page)).toBeEnabled();
    await page.getByRole("button", { name: "一時停止", exact: true }).click();
    await page.keyboard.press("ArrowRight");
    expect((await recognition(page, answer))?.attempts ?? 0).toBe(0);
    await page.getByRole("button", { name: "再開", exact: true }).click();
    await page.getByText(answer, { exact: true }).click();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => recognition(page, answer)).toMatchObject({ attempts: 1, correct: 1 });
});

for (const remembered of [true, false]) {
    test("single-answer card records " + (remembered ? "correct" : "missed") + " rating", async ({ page }) => {
        const answer = await start(page, true);
        await mask(page).click();
        await (remembered ? correct(page) : wrong(page)).click();
        await expect.poll(() => recognition(page, answer)).toMatchObject({
            attempts: 1, correct: Number(remembered),
        });
    });
}

test("card double Space uses the same physical key sequence as selection", async ({ page }) => {
    const answer = await start(page);
    await mask(page).focus();
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    await expect(mask(page)).toBeEnabled();
    await page.keyboard.up("Space");
    await expect(mask(page)).toBeEnabled();
    await page.keyboard.press("Space");
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await expect(correct(page)).toHaveCount(0);
    const next = page.getByRole("button", { name: "次へ", exact: true });
    await expect(next).toBeEnabled();
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => recognition(page, answer)).toMatchObject({ attempts: 1, correct: 0 });
    expect((await recognition(page, answer)).unknownCount ?? 0).toBe(0);
});

test("card double Space handles remapped Shift release and interruption", async ({ page }) => {
    await start(page);
    await mask(page).focus();
    const tap = () => page.evaluate(() => {
        const target = document.activeElement ?? document.body;
        target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
        target.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", code: "ShiftLeft", bubbles: true, cancelable: true }));
    });
    await tap();
    await page.keyboard.press("a");
    await tap();
    await expect(mask(page)).toBeEnabled();
    await tap();
    await expect(page.getByRole("button", { name: "次へ", exact: true })).toBeEnabled();
});

for (const [key, remembered] of [["ArrowLeft", false], ["1", false], ["2", true]] as const) {
    test("card rating shortcut " + key, async ({ page }) => {
        const answer = await start(page);
        await page.getByText("question: " + answer, { exact: true }).click();
        await page.keyboard.press(key);
        await expect(mask(page)).toBeEnabled();
        await page.keyboard.press("Enter");
        await expect(correct(page)).toBeEnabled();
        await page.keyboard.press(key);
        await expect.poll(() => recognition(page, answer)).toMatchObject({ attempts: 1, correct: Number(remembered) });
    });
}

test("card mask scales only on press and reveal has no opacity animation", async ({ page }) => {
    const answer = await start(page);
    const button = mask(page);
    await button.hover();
    await page.mouse.down();
    await expect.poll(() => button.evaluate(el => getComputedStyle(el).scale)).toBe("0.95");
    await page.mouse.up();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    const maskStyle = await page.locator(".card-mask").evaluate(el => ({
        opacity: getComputedStyle(el).opacity,
        transitionProperty: getComputedStyle(el).transitionProperty,
    }));
    expect(maskStyle.opacity).toBe("0");
    expect(maskStyle.transitionProperty).toBe("scale");
    await expect(page.locator(".card-answer-text")).toHaveCSS("opacity", "1");
});

test("card focused buttons keep native Enter activation", async ({ page }) => {
    const answer = await start(page);
    await unknown(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await expect(correct(page)).toHaveCount(0);
    const next = page.getByRole("button", { name: "次へ", exact: true });
    await expect(next).toBeEnabled();
    await next.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => recognition(page, answer)).toMatchObject({ attempts: 1, correct: 0 });
});

test("card focused mask and rating buttons retain Enter activation", async ({ page }) => {
    const answer = await start(page);
    await mask(page).focus();
    await page.keyboard.press("Enter");
    await expect(correct(page)).toBeEnabled();
    await correct(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => recognition(page, answer)).toMatchObject({ attempts: 1, correct: 1 });
});

test("card shortcuts do not act on a focused control outside the question", async ({ page }) => {
    const answer = await start(page);
    const pause = page.getByRole("button", { name: "一時停止", exact: true });
    await pause.focus();
    await page.keyboard.press("Space");
    // Space retains the native pause action.
    await page.getByRole("button", { name: "再開", exact: true }).click();
    await mask(page).click();
    await pause.focus();
    await page.keyboard.press("2");
    await page.keyboard.press("ArrowRight");
    await expect(correct(page)).toBeEnabled();
    expect((await recognition(page, answer))?.attempts ?? 0).toBe(0);
});
