import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { heuristicDraft } from "@/lib/recipe/heuristic";
import { normalizeDraft } from "@/lib/recipe/normalize";

vi.mock("server-only", () => ({}));

/**
 * Imports every link in tests/test_links.md against the live sites with the offline reader.
 * Network-bound, so it only runs with LIVE_LINKS=1 (the "Live links" workflow).
 */
const links = [...readFileSync(new URL("./test_links.md", import.meta.url), "utf8").matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);

describe.skipIf(!process.env.LIVE_LINKS)("live links", () => {
  it.each(links)("%s", async (url) => {
    const { isSocialUrl, fetchSocialPost } = await import("@/lib/social/fetch");
    const { fetchRecipePage } = await import("@/lib/web/fetch");
    let text: string;
    if (isSocialUrl(url)) {
      const post = await fetchSocialPost(url);
      text = post.caption;
      console.log(`\n=== ${url}\nresolved ${post.url} author ${post.author}\n--- caption ---\n${text.slice(0, 2500)}\n---`);
    } else {
      const page = await fetchRecipePage(url);
      text = page.text;
      console.log(`\n=== ${url}\nresolved ${page.url} structured=${Boolean(page.structured)}\n--- text ---\n${text.slice(0, 1500)}\n---`);
    }
    const recipe = normalizeDraft(heuristicDraft(text), { kind: "web" }, text);
    const ingredients = recipe.ingredientGroups.flatMap((g) => g.items);
    console.log(`title="${recipe.title}" lang=${recipe.language} ingredients=${ingredients.length} steps=${recipe.steps.length}`);
    console.log(ingredients.slice(0, 4).map((i) => `  ${i.quantity ?? ""} ${i.unit ?? ""} | ${i.name}`).join("\n"));
    expect(ingredients.length).toBeGreaterThan(1);
    expect(recipe.steps.length).toBeGreaterThan(0);
  }, 90_000);
});
