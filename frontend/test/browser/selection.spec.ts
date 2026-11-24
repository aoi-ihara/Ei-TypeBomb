import { test, expect, type Page } from "@playwright/test";

const hint = (page: Page) => page.getByRole("button", { name: "分からない" });
const choices = (page: Page) => page.getByRole("button", { name: /^[1-4]\. / });
async function choiceForAnswer(page: Page, answer: string) {
  for (const choice of await choices(page).all()) {
    if ((await choice.innerText()).trim().endsWith(`. ${answer}`))
      return choice;
  }
  throw new Error(`No choice for expected answer: ${answer}`);
}
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "ゲームを開始", exact: true }).click();
  await expect(hint(page)).toBeEnabled();
  return (await page.getByText(/^question:/).innerText()).split(": ")[1];
}
async function controls(page: Page, mode = "controls") {
  await page.goto(`/?${mode}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-ready",
    "true",
  );
  await page.getByText("question: apple", { exact: true }).click();
}
async function reveal(page: Page) {
  await page.keyboard.press("Space");
  await expect(hint(page)).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(hint(page)).toBeDisabled();
}
async function expectRevealed(page: Page, answer: string) {
  for (const choice of await choices(page).all()) {
    if ((await choice.innerText()).endsWith(`. ${answer}`))
      await expect(choice).toBeEnabled();
    else await expect(choice).toBeDisabled();
  }
}

test("offline double Space reveals distractors and records assisted history once", async ({
  page,
}) => {
  const answer = await start(page);
  await page.getByText(`question: ${answer}`, { exact: true }).click();
  await reveal(page);
  await expectRevealed(page, answer);
  await (await choiceForAnswer(page, answer)).click();
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const memory = JSON.parse(
          localStorage.getItem("playground-memory:guest:shortcut-test") ?? "{}",
        );
        return memory[id]?.answerModeStats?.recognition;
      }, answer),
    )
    .toMatchObject({ attempts: 1, correct: 0, unknownCount: 1 });
  // History survives a page reload; do not just inspect a callback spy.
  await page.reload();
  const stats = await page.evaluate(
    (id) =>
      JSON.parse(
        localStorage.getItem("playground-memory:guest:shortcut-test")!,
      )[id].answerModeStats.recognition,
    answer,
  );
  expect(stats).toMatchObject({ attempts: 1, correct: 0, unknownCount: 1 });
});

test("double Space after clicking a wrong choice", async ({ page }) => {
  const answer = await start(page);
  for (const choice of await choices(page).all()) {
    if (!(await choice.innerText()).endsWith(`. ${answer}`)) {
      await choice.click();
      break;
    }
  }
  await reveal(page);
  await expectRevealed(page, answer);
});

test("focused enabled choice does not receive a native Space click", async ({
  page,
}) => {
  const answer = await start(page);
  const correct = await choiceForAnswer(page, answer);
  await correct.focus();
  await reveal(page);
  await expect(
    page.getByText(`question: ${answer}`, { exact: true }),
  ).toBeVisible();
  await expectRevealed(page, answer);
});

test("dual-role Space/Shift tap works without a matching Space keyup", async ({
  page,
}) => {
  const answer = await start(page);
  // Focused answers must not receive a native click from the shortcut.
  await choices(page).first().focus();
  const remappedTap = () =>
    page.evaluate(() => {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", {
        key: " ", code: "Space", bubbles: true, cancelable: true,
      }));
      // Some dual-role mappers emit Shift keyup instead of Space keyup.
      target.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Shift", code: "ShiftLeft", bubbles: true, cancelable: true,
      }));
    });
  await remappedTap();
  await expect(hint(page)).toBeEnabled();
  await page.waitForTimeout(90);
  await remappedTap();
  await expectRevealed(page, answer);
  await expect(page.getByText(`question: ${answer}`, { exact: true })).toBeVisible();
});

test("dual-role Space with intervening Shift down/up still reveals", async ({
  page,
}) => {
  const answer = await start(page);
  await choices(page).first().focus();
  await page.evaluate(() => {
    const target = document.activeElement ?? document.body;
    const dispatch = (type: string, key: string, code: string) =>
      target.dispatchEvent(new KeyboardEvent(type, {
        key, code, bubbles: true, cancelable: true,
      }));
    // A dual-role remapper may send a Shift down/up pair between
    // consecutive Space keydowns instead of a matching Space keyup.
    dispatch("keydown", " ", "Space");
    dispatch("keydown", "Shift", "ShiftLeft");
    dispatch("keyup", "Shift", "ShiftLeft");
    dispatch("keydown", " ", "Space");
  });
  await expectRevealed(page, answer);
  await expect(page.getByText(`question: ${answer}`, { exact: true }))
    .toBeVisible();
});

test("focus within a question does not reset an armed Space shortcut", async ({
  page,
}) => {
  const answer = await start(page);
  await page.keyboard.press("Space");
  // Internal focus updates should not invalidate the first press.
  await choices(page).first().focus();
  await page.keyboard.press("Space");
  await expectRevealed(page, answer);
});

test("Space then non-Shift keys still cancel the shortcut", async ({ page }) => {
  await controls(page);
  const send = (key: string, code: string) =>
    page.evaluate(({ key, code }) => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", {
        key, code, bubbles: true, cancelable: true,
      }));
      document.body.dispatchEvent(new KeyboardEvent("keyup", {
        key, code, bubbles: true, cancelable: true,
      }));
    }, { key, code });
  await send(" ", "Space");
  await send("a", "KeyA");
  await send(" ", "Space");
  await expect(hint(page)).toBeEnabled();
  await send(" ", "Space");
  await expect(hint(page)).toBeDisabled();
});

test("very short Space down/up pairs reveal without a hold-time requirement", async ({
  page,
}) => {
  const answer = await start(page);
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", {
        key: " ", code: "Space", bubbles: true, cancelable: true,
      }));
      document.body.dispatchEvent(new KeyboardEvent("keyup", {
        key: " ", code: "Space", bubbles: true, cancelable: true,
      }));
    }
  });
  await expectRevealed(page, answer);
});

test("holding Space and repeated keydowns without repeat never count twice", async ({
  page,
}) => {
  const answer = await start(page);
  await page.keyboard.down("Space");
  for (let i = 0; i < 5; i++) await page.keyboard.down("Space");
  await expect(hint(page)).toBeEnabled();
  await page.keyboard.up("Space");
  await page.keyboard.press("Space");
  await expectRevealed(page, answer);
  await controls(page);
  // Exercise real DOM events too: bridges may omit KeyboardEvent.repeat.
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++)
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await expect(hint(page)).toBeEnabled();
  await page.keyboard.up("Space");
  await page.keyboard.press("Space");
  await expect(hint(page)).toBeDisabled();
});

test("delayed hold keydowns without repeat flags never count as a second tap", async ({
  page,
}) => {
  const answer = await start(page);
  const fakeKeydown = () =>
    page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", {
        key: " ", code: "Space", repeat: false,
        bubbles: true, cancelable: true,
      }));
    });

  await fakeKeydown();
  await page.waitForTimeout(150);
  await fakeKeydown();
  await page.waitForTimeout(150);
  await fakeKeydown();
  await expect(hint(page)).toBeEnabled();
  for (const choice of await choices(page).all())
    await expect(choice).toBeEnabled();

  // A true release, not elapsed time, allows a second press to reveal.
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent("keyup", {
      key: " ", code: "Space", bubbles: true, cancelable: true,
    }));
  });
  await fakeKeydown();
  await expectRevealed(page, answer);
});

test("pause blocks hints and resets the previous press", async ({ page }) => {
  const answer = await start(page);
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect(hint(page)).toBeEnabled();
  await reveal(page);
  await expectRevealed(page, answer);
});

test("number keys 1–4 still answer and preserve clean history", async ({
  page,
}) => {
  for (let index = 0; index < 4; index++) {
    const answer = await start(page);
    const text = await choices(page).nth(index).innerText();
    await page.keyboard.press(String(index + 1));
    if (text.endsWith(`. ${answer}`)) {
      await expect
        .poll(() =>
          page.evaluate(
            (id) =>
              JSON.parse(
                localStorage.getItem("playground-memory:guest:shortcut-test") ??
                  "{}",
              )[id]?.answerModeStats?.recognition,
            answer,
          ),
        )
        .toMatchObject({ correct: 1 });
    } else await expect(choices(page).nth(index)).toBeDisabled();
    await page.evaluate(() => localStorage.clear());
  }
});

test("online selection never reveals on double Space", async ({ page }) => {
  await controls(page, "online");
  await expect(hint(page)).toHaveCount(0);
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(choices(page).locator(":disabled")).toHaveCount(0);
  for (const choice of await choices(page).all())
    await expect(choice).toBeEnabled();
  await page.keyboard.press("1");
  // Numeric answering remains active online as well (apple may be option 1).
});

test("editors and outside buttons keep native operations", async ({ page }) => {
  await controls(page);
  for (const label of ["editor", "notes", "rich editor"]) {
    const editor = page.getByRole("textbox", { name: label, exact: true });
    await editor.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");
    await expect(hint(page)).toBeEnabled();
    if (label === "rich editor") await expect(editor).toHaveText("  ");
    else await expect(editor).toHaveValue("  ");
  }
  const outside = page.getByRole("button", { name: "Outside 0" });
  await outside.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Outside 2" })).toBeVisible();
  await expect(hint(page)).toBeEnabled();
});

test("focus changes, modifiers and window blur reset a partial shortcut", async ({
  page,
}) => {
  await controls(page);
  await page.keyboard.press("Space");
  await page.getByRole("textbox", { name: "editor", exact: true }).focus();
  await choices(page).first().focus();
  await reveal(page);
  await controls(page);
  await page.keyboard.press("Space");
  await page.keyboard.press("Control+a");
  await reveal(page);
  await controls(page);
  await page.keyboard.press("Space");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await reveal(page);
});

test("parent rerender does not lose the first press or duplicate listeners", async ({
  page,
}) => {
  await controls(page);
  await page.keyboard.press("Space");
  // Programmatic click rerenders without moving keyboard focus.
  await page
    .getByRole("button", { name: "Rerender 0" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.keyboard.press("Space");
  await expect(hint(page)).toBeDisabled();
});

test("key/code fallbacks work and IME composition cannot arm a hint", async ({
  page,
}) => {
  for (const key of [" ", "Spacebar", "Unidentified"]) {
    await controls(page);
    const press = () =>
      page.evaluate((key) => {
        const init = {
          key,
          code: key === "Unidentified" ? "Space" : "",
          bubbles: true,
          cancelable: true,
        };
        const down = new KeyboardEvent("keydown", init);
        document.body.dispatchEvent(down);
        document.body.dispatchEvent(new KeyboardEvent("keyup", init));
        return down.defaultPrevented;
      }, key);
    expect(await press()).toBe(true);
    await expect(hint(page)).toBeEnabled();
    expect(await press()).toBe(true);
    await expect(hint(page)).toBeDisabled();
  }
  await controls(page);
  await page.keyboard.press("Space");
  await page.evaluate(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  await reveal(page);
});

test("selection numeric shortcuts respect focus outside the question", async ({ page }) => {
  await controls(page);
  const outside = page.getByRole("button", { name: "Outside 0" });
  await outside.focus();
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  for (const choice of await choices(page).all())
    await expect(choice).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Outside 1" })).toBeVisible();
});

test("selection focused unknown button retains native Enter activation", async ({ page }) => {
  const answer = await start(page);
  await hint(page).focus();
  await page.keyboard.press("Enter");
  await expect(hint(page)).toBeDisabled();
  await expectRevealed(page, answer);
});
