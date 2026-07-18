import { ok, strictEqual } from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const E2E_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// Native Font panel verification. WebDriver cannot inspect AppKit's separate
// panel window, so the suite verifies the Typography UI and injects the same
// scoped Tauri event the Rust callback emits after a native selection.
describe("Settings native font picker", function () {
  let workspaceRestored = false;

  before(async function () {
    workspaceRestored = await $('button[aria-label="Hide sidebar"]')
      .waitForExist({ timeout: 3_000 })
      .catch(() => false);
    if (workspaceRestored) return;

    // Keep the feature suite independent of the developer's recent-workspace
    // file: initialize this process through the real IPC bridge, then reload
    // so the frontend consumes the prepared startup state normally.
    await browser.executeAsync((path, done) => {
      window.__TAURI_INTERNALS__
        .invoke("open_workspace", { path })
        .then(() => done(null))
        .catch((error) => done(error && error.message ? error.message : String(error)));
    }, E2E_WORKSPACE);
    await browser.refresh();
    workspaceRestored = await $('button[aria-label="Hide sidebar"]')
      .waitForExist({ timeout: 15_000 })
      .catch(() => false);
    ok(workspaceRestored, "E2E workspace did not initialize");
  });

  async function pressCmd(key) {
    await browser.execute((pressedKey) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: pressedKey,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, key);
  }

  it("opens settings via the command palette", async function () {
    await pressCmd("p");
    const settingsCmd = await $('[cmdk-item][data-value="open-settings"]');
    await settingsCmd.waitForExist({ timeout: 5_000 });
    await settingsCmd.click();

    await $("[data-settings-panel]").waitForExist({ timeout: 5_000 });
  });

  it("renders one Typography section with row-specific native triggers", async function () {
    const typography = await $('//section[.//h2[normalize-space()="Typography"]]');
    await typography.waitForExist({ timeout: 5_000 });
    strictEqual((await $$('//section[.//h2[normalize-space()="Typography"]]')).length, 1);
    strictEqual((await $$('//section[.//h2[normalize-space()="Fonts"]]')).length, 0);

    for (const label of ["UI font", "Editor font", "Monospace font"]) {
      const input = await typography.$(`input[aria-label="${label} stack"]`);
      const trigger = await typography.$(`button[aria-label="Show Fonts for ${label}"]`);
      await input.waitForExist({ timeout: 5_000 });
      await trigger.waitForEnabled({ timeout: 5_000 });
    }
  });

  it("routes a scoped native selection and preserves the edited fallback tail", async function () {
    const input = await $('input[aria-label="Monospace font stack"]');
    const trigger = await $('button[aria-label="Show Fonts for Monospace font"]');
    await input.scrollIntoView({ block: "center" });
    await input.setValue('Custom Primary, Georgia, "Times New Roman", serif');
    await trigger.click();

    await browser.waitUntil(
      async () => Boolean(await trigger.getAttribute("data-native-font-request-id")),
      { timeout: 5_000, timeoutMsg: "native font request token was not published" },
    );
    const requestId = await trigger.getAttribute("data-native-font-request-id");
    ok(requestId, "expected an active native font request token");

    // The old searchable DOM imitation must not return when the native trigger opens.
    strictEqual(await $('[role="dialog"][aria-label="Installed fonts"]').isExisting(), false);
    strictEqual(await $('input[aria-label="Search installed fonts"]').isExisting(), false);

    await browser.executeAsync((token, done) => {
      window.__TAURI_INTERNALS__
        .invoke("plugin:event|emit", {
          event: "font:selected",
          payload: { requestId: token, family: "Menlo" },
        })
        .then(() => done(null))
        .catch((error) => done(error && error.message ? error.message : String(error)));
    }, requestId);

    await browser.waitUntil(async () => (await input.getValue()).startsWith("Menlo,"), {
      timeout: 5_000,
      timeoutMsg: "native selection event did not update the font stack",
    });
    strictEqual(await input.getValue(), 'Menlo, Georgia, "Times New Roman", serif');

    const cssVar = await browser.execute(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--mono-font"),
    );
    ok(cssVar.includes("Menlo"), `--mono-font should contain Menlo: ${cssVar}`);

    let persisted;
    await browser.waitUntil(
      async () => {
        persisted = await browser.executeAsync((key, done) => {
          window.__TAURI_INTERNALS__
            .invoke("get_setting", { key })
            .then((value) => done(JSON.stringify(value)))
            .catch((error) =>
              done(`ERROR: ${error && error.message ? error.message : String(error)}`),
            );
        }, "fonts.mono");
        return persisted === '"Menlo, Georgia, \\"Times New Roman\\", serif"';
      },
      { timeout: 5_000, timeoutMsg: `font setting did not persist: ${persisted}` },
    );

    await browser.executeAsync((token, done) => {
      window.__TAURI_INTERNALS__
        .invoke("close_native_font_panel", { requestId: token })
        .then(() => done(null))
        .catch((error) => done(error && error.message ? error.message : String(error)));
    }, requestId);
  });

  it("keeps direct font-stack editing available", async function () {
    const input = await $('input[aria-label="Monospace font stack"]');
    await input.scrollIntoView({ block: "center" });
    await input.setValue("Courier, monospace");

    await browser.waitUntil(
      async () => {
        const value = await browser.execute(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--mono-font"),
        );
        return value.includes("Courier");
      },
      { timeout: 5_000, timeoutMsg: "--mono-font never reflected the typed stack" },
    );
    strictEqual(await input.getValue(), "Courier, monospace");
  });
});
