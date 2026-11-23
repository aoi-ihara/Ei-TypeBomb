import { test, expect } from "@playwright/test";

test("beta copy matches rendered forecast and excludes question content", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => {
            document.documentElement.dataset.diagnostic = value;
        } } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "ゲームを開始", exact: true }).click();
    const answer = (await page.getByText(/^question:/).innerText()).split(": ")[1];
    await page.getByRole("button", { name: new RegExp(`^[1-4]\\. ${answer}$`) }).click();
    await expect.poll(() => page.evaluate(() => {
        const memory = JSON.parse(localStorage.getItem("playground-memory:guest:shortcut-test") ?? "{}");
        return Object.keys(memory).length;
    })).toBeGreaterThan(0);
    await page.getByRole("button", { name: "設定", exact: true }).first().click();
    await page.getByRole("button", { name: "出題診断をコピー", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("出題診断をコピーしました。");
    const json = await page.locator("html").getAttribute("data-diagnostic");
    const diagnostic = JSON.parse(json!);
    const totals = diagnostic.masteryGraph.totals;
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(Math.round(totals.masteredNow / totals.total * 100)));
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext",
        `${totals.masteredNow} / ${totals.total} 語を現在習得。3時間後も ${totals.masteredAfter3Hours} 語、24時間後も ${totals.masteredAfter24Hours} 語は維持する予測`);
    const layers = await page.getByRole("progressbar").locator(":scope > div").evaluateAll(nodes =>
        nodes.map(node => ({ background: (node as HTMLElement).style.background, opacity: (node as HTMLElement).style.opacity })),
    );
    expect(layers).toHaveLength(2);
    expect(layers.some(layer => layer.opacity === "1")).toBe(true);
    expect(layers.every(layer => layer.background.includes("linear-gradient") ||
        layer.background.includes("var(--color-background-secondary)"))).toBe(true);
    expect(diagnostic.masteryGraph.items).toHaveLength(totals.total);
    expect(Number.isFinite(Date.parse(diagnostic.masteryGraph.calculatedAt))).toBe(true);
    expect(json).not.toMatch(/apple|banana|orange|grape|shortcut-test|question:/);
});

test("production settings never offer learning diagnostic copy", async ({ page }) => {
    await page.goto("/production");
    await page.getByRole("button", { name: "ゲームを開始", exact: true }).click();
    await page.getByRole("button", { name: "設定", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "出題診断をコピー", exact: true })).toHaveCount(0);
});

test("clipboard failure produces actionable status", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async () => { throw new Error("denied"); } },
    }));
    await page.goto("/");
    await page.getByRole("button", { name: "ゲームを開始", exact: true }).click();
    await page.getByRole("button", { name: "設定", exact: true }).first().click();
    await page.getByRole("button", { name: "出題診断をコピー", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("コピーできませんでした");
});
