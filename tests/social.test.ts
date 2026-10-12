import { describe, expect, it } from "vitest";
import { captionFromInstagramEmbed, captionFromOgDescription } from "@/lib/social/parse";

describe("instagram caption extraction", () => {
  it("reads the embed page caption", () => {
    const html = `<div class="Caption"><a class="CaptionUsername" href="#">chef.lea</a><br />Tarte aux pommes &#x1f34e;<br/>200 g de farine<br>100 g de beurre<div class="CaptionComments"></div></div>`;
    expect(captionFromInstagramEmbed(html)).toEqual({ author: "@chef.lea", caption: "Tarte aux pommes 🍎\n200 g de farine\n100 g de beurre" });
  });
  it("reads og:description", () => {
    const html = `<meta property="og:description" content="1,234 likes, 56 comments - chef.lea on March 3, 2025: &quot;Easy pasta&#10;200 g spaghetti&quot;." />`;
    expect(captionFromOgDescription(html)).toEqual({ author: "@chef.lea", caption: "Easy pasta\n200 g spaghetti" });
  });
});

describe("unflattenCaption", () => {
  it("restores lines in a one-line TikTok caption", async () => {
    const { unflattenCaption } = await import("@/lib/social/parse");
    const { heuristicDraft } = await import("@/lib/recipe/heuristic");
    const caption =
      "LEMON LOAF Bright and soft ✨ Full recipe below 🍋 Cake: - 1 1/2 cups (190g) flour @mill - 1 cup (200g) sugar - 2 eggs Glaze: - 1 cup (120g) powdered sugar - 2 tbsp lemon juice Instructions: Heat the oven to 350F. Whisk the flour and sugar. Add the eggs and bake for 45 minutes. Mix the glaze and pour it over.";
    const text = unflattenCaption(caption);
    expect(text.split("\n")[0]).toBe("LEMON LOAF Bright and soft");
    const draft = heuristicDraft(text);
    expect(draft.ingredientGroups.flatMap((g) => g.items)).toHaveLength(5);
    expect(draft.ingredientGroups.map((g) => g.name)).toContain("Glaze");
    expect(draft.steps).toHaveLength(4);
  });
});

describe("captionFromTikTokPage", () => {
  it("reads desc from the rehydration JSON", async () => {
    const { captionFromTikTokPage } = await import("@/lib/social/parse");
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{"itemInfo":{"itemStruct":{"id":"1","desc":"Crêpes 🥞\\n250 g farine\\n\\"easy\\""}}}</script>`;
    expect(captionFromTikTokPage(html)).toBe('Crêpes 🥞\n250 g farine\n"easy"');
    expect(captionFromTikTokPage(`<meta property="og:description" content="Soup &amp; bread">`)).toBe("Soup & bread");
  });
});

describe("captionFromInstagramJson", () => {
  it("reads a caption from escaped embed JSON", async () => {
    const { captionFromInstagramJson } = await import("@/lib/social/parse");
    const html = `<script>s.handle("{\\"shortcode_media\\":{\\"owner\\":{\\"id\\":\\"1\\",\\"username\\":\\"chef.lea\\"},\\"edge_media_to_caption\\":{\\"edges\\":[{\\"node\\":{\\"text\\":\\"Tarte \\\\u00e0 l'oignon\\\\n200 g de farine\\"}}]}}}")</script>`;
    expect(captionFromInstagramJson(html)).toEqual({ caption: "Tarte à l'oignon\n200 g de farine", author: "@chef.lea" });
  });
});
