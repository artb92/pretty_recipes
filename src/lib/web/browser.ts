import "server-only";
import { assertPublicUrl } from "@/lib/net";
import { getBrowser } from "@/lib/pdf";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SKIPPED = new Set(["image", "media", "font", "stylesheet"]);

/**
 * Loads a page in the shared headless Chromium, for sites whose bot checks refuse plain server
 * requests. Every request the page makes is checked against private addresses.
 * shortcut: Playwright routes see only the first request of a redirect chain, so a public page
 * redirecting to a private address is not caught; fine for a self-hosted app, needs a DNS-level
 * guard before exposing the app publicly.
 */
export async function browserPage(url: URL): Promise<{ url: URL; status: number; body: string }> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: CHROME_UA, locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      if (SKIPPED.has(route.request().resourceType())) return route.abort();
      try {
        await assertPublicUrl(new URL(route.request().url()));
      } catch {
        return route.abort();
      }
      return route.continue();
    });
    const res = await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
    // A bot check serves an interstitial first, then reloads the real page; wait for the recipe data.
    const passed = await page
      .waitForSelector('script[type="application/ld+json"]', { state: "attached", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    const final = new URL(page.url());
    await assertPublicUrl(final);
    return { url: final, status: passed ? 200 : (res?.status() ?? 0), body: await page.content() };
  } finally {
    await context.close();
  }
}
