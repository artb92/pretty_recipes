import "server-only";
import { safeFetch } from "@/lib/net";
import { captionFromInstagramEmbed, captionFromInstagramJson, captionFromOgDescription, captionFromTikTokPage, unflattenCaption } from "./parse";

export type SocialPlatform = "tiktok" | "instagram";
export type SocialPost = { platform: SocialPlatform; url: string; caption: string; author: string | null };

export class SocialFetchError extends Error {
  constructor(
    message: string,
    readonly code: "unsupported_url" | "not_found" | "blocked" | "no_caption",
  ) {
    super(message);
    this.name = "SocialFetchError";
  }
}

const HOSTS: Record<string, SocialPlatform> = {
  "tiktok.com": "tiktok",
  "www.tiktok.com": "tiktok",
  "m.tiktok.com": "tiktok",
  "vm.tiktok.com": "tiktok",
  "vt.tiktok.com": "tiktok",
  "instagram.com": "instagram",
  "www.instagram.com": "instagram",
  "m.instagram.com": "instagram",
};

export function isSocialUrl(input: string): boolean {
  try {
    return new URL(input.trim()).hostname.toLowerCase() in HOSTS;
  } catch {
    return false;
  }
}

/** Only TikTok and Instagram hosts over https are allowed, so the server cannot be pointed elsewhere. */
export function classifyUrl(input: string): { url: URL; platform: SocialPlatform } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SocialFetchError("That is not a valid link.", "unsupported_url");
  }
  if (url.protocol === "http:") url.protocol = "https:";
  const platform = HOSTS[url.hostname.toLowerCase()];
  if (url.protocol !== "https:" || !platform || url.port) {
    throw new SocialFetchError("Only TikTok and Instagram links are supported for now.", "unsupported_url");
  }
  return { url, platform };
}

const social = (accept?: string) => ({ accept, check: (u: URL) => void classifyUrl(u.toString()) });

async function fetchTikTok(url: URL): Promise<SocialPost> {
  // Short links (vm.tiktok.com) must be expanded before oEmbed accepts them.
  let canonical = url;
  if (url.hostname.startsWith("vm.") || url.hostname.startsWith("vt.")) {
    canonical = (await safeFetch(url, social())).url;
  }
  canonical = new URL(canonical.origin + canonical.pathname); // drop share-tracking parameters
  const author = canonical.pathname.match(/^\/(@[\w.]+)/)?.[1] ?? null;

  // oEmbed only knows /video/ URLs; photo carousels share the same id space.
  const tried: number[] = [];
  for (const candidate of new Set([canonical.href, canonical.href.replace("/photo/", "/video/")])) {
    const oembed = new URL("https://www.tiktok.com/oembed");
    oembed.searchParams.set("url", candidate);
    const res = await safeFetch(oembed, social("application/json"));
    tried.push(res.status);
    if (res.status !== 200) continue;
    try {
      const data = JSON.parse(res.body) as { title?: string; author_name?: string; author_unique_id?: string };
      if (data.title?.trim()) {
        return {
          platform: "tiktok",
          url: canonical.toString(),
          caption: unflattenCaption(data.title.trim()),
          author: data.author_unique_id ? `@${data.author_unique_id}` : (data.author_name ?? author),
        };
      }
    } catch {
      // fall through to the page
    }
  }

  // The post page embeds its data as JSON, description included.
  const page = await safeFetch(canonical, social());
  const caption = page.status === 200 ? captionFromTikTokPage(page.body) : null;
  if (caption) return { platform: "tiktok", url: canonical.toString(), caption: unflattenCaption(caption), author };
  console.warn(`[tiktok] no caption for ${canonical.pathname} (oembed ${tried.join(",")}, page ${page.status})`);
  if (tried.every((s) => s === 400 || s === 404) && page.status !== 200) {
    throw new SocialFetchError("TikTok could not find this video. It may be private or deleted.", "not_found");
  }
  throw new SocialFetchError("TikTok did not share this post's description. Paste it as text instead.", "no_caption");
}

async function fetchInstagram(url: URL): Promise<SocialPost> {
  const m = url.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
  if (!m) throw new SocialFetchError("This Instagram link does not point to a post or reel.", "unsupported_url");
  const kind = m[1] === "reels" ? "reel" : m[1];
  const shortcode = m[2];
  const canonical = `https://www.instagram.com/${kind}/${shortcode}/`;

  // The public embed page carries the full caption without a login.
  const embedUrl = new URL(`https://www.instagram.com/p/${shortcode}/embed/captioned/`);
  const embed = await safeFetch(embedUrl, social());
  if (embed.status === 200) {
    const found = captionFromInstagramEmbed(embed.body) ?? captionFromInstagramJson(embed.body);
    if (found?.caption) return { platform: "instagram", url: canonical, ...found };
  }
  // Fallback: the post page's meta description holds a (sometimes shortened) caption.
  const page = await safeFetch(new URL(canonical), social());
  if (page.status === 404) throw new SocialFetchError("Instagram could not find this post.", "not_found");
  if (page.status === 200) {
    const found = captionFromOgDescription(page.body) ?? captionFromInstagramJson(page.body);
    if (found?.caption) return { platform: "instagram", url: canonical, ...found };
  }
  // Last resort: let a real browser render the embed, which fills the caption in with JavaScript.
  const { browserPage } = await import("@/lib/web/browser");
  const rendered = await browserPage(embedUrl, ".Caption").catch(() => null);
  const found = rendered ? captionFromInstagramEmbed(rendered.body) : null;
  if (found?.caption) return { platform: "instagram", url: canonical, ...found };
  console.warn(
    `[instagram] no caption for ${shortcode} (embed ${embed.status}, page ${page.status}, browser ${rendered?.status ?? "failed"})`,
  );
  throw new SocialFetchError(
    "Instagram did not share this post's caption with us. Copy the caption from the app and paste it as text.",
    "blocked",
  );
}

export async function fetchSocialPost(input: string): Promise<SocialPost> {
  const { url, platform } = classifyUrl(input);
  try {
    return platform === "tiktok" ? await fetchTikTok(url) : await fetchInstagram(url);
  } catch (err) {
    if (err instanceof SocialFetchError) throw err;
    throw new SocialFetchError(
      `Could not reach ${platform === "tiktok" ? "TikTok" : "Instagram"}. Paste the caption as text instead.`,
      "blocked",
    );
  }
}
