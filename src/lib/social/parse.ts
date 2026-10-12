/** Pure HTML helpers for social pages, kept separate so they can be unit-tested. */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", deg: "°", times: "×", frac12: "½", frac14: "¼", frac34: "¾", frac13: "⅓", frac23: "⅔",
  frac18: "⅛", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", ccedil: "ç", icirc: "î",
  iuml: "ï", ocirc: "ô", ucirc: "û", ugrave: "ù", oelig: "œ", laquo: "«", raquo: "»",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ent] ?? NAMED[ent.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Instagram's /embed/captioned/ page: <div class="Caption"><a class="CaptionUsername">user</a> caption…</div> */
export function captionFromInstagramEmbed(html: string): { caption: string; author: string | null } | null {
  const block = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/i)
    ?? html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
  if (!block) return null;
  const userMatch = block[1].match(/<a[^>]*class="CaptionUsername"[^>]*>([\s\S]*?)<\/a>/i);
  const author = userMatch ? htmlToText(userMatch[1]) : null;
  const body = userMatch ? block[1].replace(userMatch[0], "") : block[1];
  const caption = htmlToText(body);
  return caption ? { caption, author: author ? `@${author.replace(/^@/, "")}` : null } : null;
}

/** og:description looks like: 1,234 likes, 56 comments - user on March 3, 2025: "caption". */
export function captionFromOgDescription(html: string): { caption: string; author: string | null } | null {
  const meta =
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) ??
    html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i) ??
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
  if (!meta) return null;
  const text = decodeEntities(meta[1]).trim();
  const m = text.match(/^[^-]*-\s*([\w.]+)\s+(?:on|le)\s+[^:]+:\s*["“]([\s\S]*)["”]\.?\s*$/);
  if (m) return { caption: m[2].trim(), author: `@${m[1]}` };
  return text ? { caption: text, author: null } : null;
}

const UNIT_WORDS = String.raw`(?:cups?|c\.|tablespoons?|tbsps?|teaspoons?|tsps?|g|kg|ml|cl|l|oz|ounces?|lbs?|pounds?|cloves?|pinch(?:es)?|cans?|sachets?|pinc[ée]es?|cuill[eè]res?|c\. à (?:soupe|café))`;
const QTY = String.raw`(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔])\s*${UNIT_WORDS}(?=\s|$)`;
const QTY_UNIT = new RegExp(QTY, "gi");
const QTY_UNIT_SPLIT = new RegExp(String.raw`\s+(?=${QTY})`, "gi");

const STEP_HEADING = String.raw`(?:instructions?|directions?|method|m[ée]thode|steps?|[ée]tapes?|pr[ée]paration)`;

/**
 * TikTok's oEmbed returns the caption on one line. Put list items, headings and sentences of
 * the method back on their own lines so the reader sees the shape the creator wrote.
 */
export function unflattenCaption(caption: string): string {
  const lines = caption.split("\n");
  if (lines.length > 3 && !lines.some((l) => l.length > 250)) return caption;
  let text = caption
    .replace(/\s*[\p{Extended_Pictographic}]+[️‍]*\s*/gu, "\n")
    .replace(/\s+[-•]\s+(?=\S)/g, "\n- ")
    // "… (400°F). 2. Toss the potatoes" -> numbered steps on their own lines
    .replace(/\s+(\d{1,2})[.)]\s+(?=[A-ZÀ-Ý])/g, "\n$1. ")
    .replace(new RegExp(String.raw`\s*\b(ingr[ée]dients?|${STEP_HEADING})\s*(?::\s*|\n)`, "gi"), "\n$1:\n")
    // "… @brand Chocolate Fudge Frosting:\n- 1 cup" -> a group heading on its own line
    .replace(/\s+((?:[A-ZÀ-Ý][\p{L}’'-]*\s?){1,4}):\n- /gu, "\n$1:\n- ");
  // "2 cups ground beef 3 cups potatoes 1 cup cheese": one ingredient per line.
  text = text
    .split("\n")
    .map((l) => ((l.match(QTY_UNIT) ?? []).length >= 3 ? l.replace(QTY_UNIT_SPLIT, "\n") : l))
    .join("\n");
  const steps = text.match(new RegExp(String.raw`\n${STEP_HEADING}:\n`, "i"));
  if (steps?.index !== undefined) {
    const cut = steps.index + steps[0].length;
    text = text.slice(0, cut) + text.slice(cut).replace(/(?<!(?:^|\n)\d{1,2})([.!?])\s+(?=[A-ZÀ-Ý])/g, "$1\n");
  }
  return text.replace(/[ \t]+/g, " ").replace(/\n /g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** TikTok post pages: the description sits in the rehydration JSON as "desc", else in og:description. */
export function captionFromTikTokPage(html: string): string | null {
  const desc = html.match(/"desc":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (desc) {
    try {
      const text = (JSON.parse(`"${desc}"`) as string).trim();
      if (text) return text;
    } catch {
      // malformed escape: try the meta tag
    }
  }
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1];
  return og ? decodeEntities(og).trim() || null : null;
}

/** Instagram pages sometimes carry the caption only in embedded JSON (edge_media_to_caption). */
export function captionFromInstagramJson(html: string): { caption: string; author: string | null } | null {
  // The JSON is often itself inside a JSON string, so quotes arrive escaped once more.
  const body = html.includes('\\"edge_media_to_caption') ? html.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : html;
  const text = body.match(/"edge_media_to_caption":\{"edges":\[\{"node":\{(?:"[^"]*":"[^"]*",)*"text":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!text) return null;
  let caption: string;
  try {
    caption = (JSON.parse(`"${text}"`) as string).trim();
  } catch {
    return null;
  }
  const user = body.match(/"owner":\{[^}]*?"username":"([\w.]+)"/)?.[1];
  return caption ? { caption, author: user ? `@${user}` : null } : null;
}
