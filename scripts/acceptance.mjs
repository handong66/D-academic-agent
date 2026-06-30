// GUI acceptance smoke: launches the built Electron app via Playwright and asserts the
// renderer actually mounted (a sandboxed-preload crash renders a blank window that a
// main-process "did it boot" check misses — exactly the bug this guards against).
// Also exercises the bilingual switch (English default -> Chinese). Run: npm run acceptance.
import { _electron as electron } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const fail = (msg) => { console.error(`✗ acceptance: ${msg}`); process.exitCode = 1; };

const app = await electron.launch({ args: ["electron/dist/main.cjs"], cwd: ROOT, env: { ...process.env } });
try {
  const win = await app.firstWindow();
  await win.waitForSelector(".nav-item", { timeout: 20000 });
  // deterministic starting point regardless of language persisted by prior runs
  await win.evaluate(() => { localStorage.removeItem("rr-lang"); location.reload(); });
  await win.waitForSelector(".nav-item", { timeout: 20000 });
  await win.waitForTimeout(800);

  const state = await win.evaluate(() => ({
    harness: typeof window.harness === "object" && window.harness !== null,
    harnessMethods: window.harness ? Object.keys(window.harness).length : 0,
    navItems: document.querySelectorAll(".nav-item").length,
    navFirst: document.querySelector(".nav-item")?.textContent?.trim(),
    rootLen: (document.getElementById("root")?.innerHTML || "").length,
  }));
  if (!state.harness) fail("window.harness is undefined (preload failed to load)");
  if (state.harnessMethods < 14) fail(`window.harness has only ${state.harnessMethods} methods`);
  if (state.navItems < 8) fail(`sidebar rendered ${state.navItems} nav items (expected 8 incl. Writing Desk)`);
  if (state.rootLen < 2000) fail(`#root content is ${state.rootLen} chars (renderer likely crashed)`);
  // label-agnostic (UI copy is actively reworked): English default ⇒ first tab is Latin-script
  if (!/^[A-Za-z]/.test(state.navFirst || "")) fail(`default language not English (first tab = "${state.navFirst}" is not Latin-script)`);

  // drive the second tab (the Review / Check-Claim hero) end to end: thesis -> pipeline -> verdict
  await win.locator(".nav-item").nth(1).click();
  await win.waitForSelector(".thesis-input", { timeout: 8000 });
  await win.fill(".thesis-input", "Social media use is associated with adolescent depression");
  await win.click(".review-body .action-button");
  await win.waitForSelector(".verdict-banner", { timeout: 25000 });
  const verdict = (await win.textContent(".verdict-word"))?.trim();
  if (!verdict) fail("Review produced no verdict");

  // drive the Writing Desk tab (3rd): paragraph -> claim map
  await win.locator(".nav-item").nth(2).click();
  await win.waitForSelector(".draft-input", { timeout: 8000 });
  await win.fill(".draft-input", "Social media use causes adolescent depression (Twenge, 2018). Sleep quality is associated with mood.");
  await win.click(".review-body .action-button");
  await win.waitForSelector(".verdict-banner", { timeout: 25000 });
  const claimCards = await win.locator(".sentence-list .sentence-card").count();
  if (claimCards < 1) fail("Writing Desk produced no claim cards");

  // bilingual switch: last tab (Settings) -> the language picker (the select offering "zh") -> nav relabels live
  await win.locator(".nav-item").last().click();
  await win.locator('select:has(option[value="zh"])').selectOption("zh");
  await win.waitForTimeout(300);
  const navZh = await win.$$eval(".nav-item", (els) => els.map((e) => e.textContent.trim()));
  if (!/[一-鿿]/.test(navZh[0] || "")) fail(`zh switch did not relabel nav to Chinese (first tab = "${navZh[0]}")`);

  if (!process.exitCode) {
    console.log(`✓ acceptance: renderer mounted (${state.navItems} tabs, harness ${state.harnessMethods} methods), Review verdict = "${verdict}", Writing Desk claims = ${claimCards}, zh switch → "${navZh[0]}"`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await app.close();
}
