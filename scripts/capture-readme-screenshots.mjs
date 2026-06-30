// Capture deterministic README screenshots from the built Electron app.
// Run with: npm run screenshots:readme
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(ROOT, "docs", "assets", "readme");
const WINDOW_SIZE = { width: 1440, height: 960 };
const SETTLE_MS = 450;

const languages = [
  { appValue: "en", dir: "en", label: "English" },
  { appValue: "zh", dir: "zh-CN", label: "Chinese" },
];

const tabShots = [
  {
    tabId: "audit",
    file: "check-draft.png",
    prepare: async (page) => {
      await page.fill(
        ".hero .draft-input",
        "Social media use is associated with adolescent depression (Twenge, 2018). Sleep is unrelated here (Orben, 2019).",
      );
      await page.waitForSelector(".hero .sentence-card", { timeout: 25000 });
    },
  },
  {
    tabId: "review",
    file: "check-claim.png",
    prepare: async (page) => {
      const panel = page.locator('[aria-labelledby="review-title"]');
      await panel.locator(".thesis-input").fill("Social media use is associated with adolescent depression");
      await panel.locator(".review-body .action-button").click();
      await panel.locator(".verdict-banner").waitFor({ timeout: 30000 });
    },
  },
  {
    tabId: "writing",
    file: "writing-desk.png",
    prepare: async (page) => {
      const panel = page.locator('[aria-labelledby="writing-title"]');
      await panel.locator(".draft-input").fill(
        "Social media use causes adolescent depression, although prior studies mostly report associations (Twenge, 2018). Sleep quality may explain part of the pattern.",
      );
      await panel.locator(".review-body .action-button").click();
      await panel.locator(".sentence-card").first().waitFor({ timeout: 30000 });
    },
  },
  {
    tabId: "sources",
    file: "checking-scope.png",
    prepare: async (page) => {
      await page.locator('[aria-labelledby="sources-title"] .data-table tbody tr').first().waitFor({ timeout: 12000 });
    },
  },
  {
    tabId: "library",
    file: "my-library.png",
    prepare: async (page) => {
      await page.locator('[aria-labelledby="library-title"] .library-layout').waitFor({ timeout: 12000 });
    },
  },
  {
    tabId: "matrix",
    file: "evidence-table.png",
    prepare: async (page) => {
      const panel = page.locator('[aria-labelledby="matrix-title"]');
      await panel.locator(".workspace-header .action-button").click();
      await panel.locator(".matrix-table tbody tr").first().waitFor({ timeout: 30000 });
    },
  },
  {
    tabId: "eval",
    file: "quality-check.png",
    prepare: async (page) => {
      const panel = page.locator('[aria-labelledby="eval-title"]');
      await panel.locator(".workspace-header .action-button").first().click();
      await panel.locator(".metric-strip").waitFor({ timeout: 30000 });
    },
  },
  {
    tabId: "settings",
    file: "settings.png",
    prepare: async (page) => {
      await page.locator('[aria-labelledby="settings-title"] select:has(option[value="zh"])').waitFor({ timeout: 12000 });
    },
  },
];

function screenshotEnv() {
  const env = { ...process.env };
  const sensitive =
    /(^AGENT_|^OPENAI_|^ANTHROPIC_|^CONSENSUS_|^SCITE_|^AIHUBMIX_|^DEEPSEEK_|^GEMINI_|^GOOGLE_|^AZURE_|^AWS_|^HF_|^HUGGINGFACE_|API|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)/i;
  for (const key of Object.keys(env)) {
    if (sensitive.test(key)) delete env[key];
  }
  return env;
}

async function resizeWindow(app, page) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(size.width, size.height);
    window.center();
  }, WINDOW_SIZE);
  await page.setViewportSize(WINDOW_SIZE);
}

async function setLanguage(page, appValue) {
  await page.evaluate((lang) => {
    window.localStorage.setItem("rr-lang", lang);
    window.location.reload();
  }, appValue);
  await page.waitForSelector(".nav-item", { timeout: 20000 });
  await page.waitForFunction(
    (lang) => {
      const labels = [...document.querySelectorAll(".nav-item")].map((item) => item.textContent?.trim() ?? "");
      if (lang === "zh") return labels.some((label) => /[\u4E00-\u9FFF]/.test(label));
      return labels.some((label) => /^Check Draft/.test(label));
    },
    appValue,
    { timeout: 12000 },
  );
  await page.waitForTimeout(SETTLE_MS);
}

async function captureShot(page, language, shot, outDir) {
  try {
    await page.locator(`[data-tab-id="${shot.tabId}"]`).click();
    await page.waitForTimeout(SETTLE_MS);
    await shot.prepare(page);
    await page.waitForTimeout(SETTLE_MS);
    const target = path.join(outDir, shot.file);
    await page.screenshot({ path: target });
    console.log(`captured ${language.label}: ${path.relative(ROOT, target)}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to capture ${language.label} ${shot.file}: ${detail}`);
  }
}

async function captureLanguage(language) {
  const outDir = path.join(OUT_ROOT, language.dir);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const app = await electron.launch({
    args: ["electron/dist/main.cjs"],
    cwd: ROOT,
    env: screenshotEnv(),
  });

  try {
    const page = await app.firstWindow();
    await resizeWindow(app, page);
    await page.waitForSelector(".nav-item", { timeout: 20000 });
    await setLanguage(page, language.appValue);

    for (const shot of tabShots) {
      await captureShot(page, language, shot, outDir);
    }
  } finally {
    await app.close();
  }
}

for (const language of languages) {
  await captureLanguage(language);
}
