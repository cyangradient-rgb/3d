import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zlib from "node:zlib";
import Parser from "rss-parser";
import sanitizeHtml from "sanitize-html";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(__dirname, "sources.json");
const OUTPUT_PATH = path.join(__dirname, "..", "..", "docs", "feed.json");

const MAX_ITEMS_PER_SOURCE = 20;
const MAX_TOTAL_ITEMS = 400;
const FETCH_TIMEOUT_MS = 15000;

// A generic "bot"-labeled UA gets flatly 403'd by some publishers' anti-bot
// rules; a realistic browser UA is standard practice for feed readers.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

// We fetch the raw feed ourselves (instead of parser.parseURL) so we can:
//  - use AbortSignal.timeout for a real, socket-level cancel (rss-parser's
//    own `timeout` option isn't reliably enforced against every host)
//  - recover from a server that sends gzip bytes without declaring
//    Content-Encoding, which otherwise looks like garbage to the XML parser
//  - sanitize the occasional bare "&" that some feeds emit unescaped, which
//    would otherwise fail the whole feed on one bad character
async function fetchFeedXml(url, timeoutMs) {
  // Deliberately no custom Accept header: the discover-feeds.mjs probes (no
  // Accept override) reached feeds that 403'd when this fetch sent an
  // RSS-specific Accept header, on hosts whose WAF apparently treats that
  // header as bot-like. A plain default Accept looks more like a browser to
  // them, ironically.
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  let buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    buffer = zlib.gunzipSync(buffer);
  }
  return buffer.toString("utf-8");
}

function sanitizeXmlEntities(xml) {
  return xml
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;")
    // A "<" is only valid XML as the start of a tag, comment, CDATA, or
    // processing instruction — a bare "<" in text content (e.g. "< 3" or a
    // math comparison) fails the whole feed otherwise.
    .replace(/<(?![a-zA-Z/!?])/g, "&lt;");
}

function stripHtml(html, limit = 240) {
  if (!html) return "";
  let text = html.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  text = text.split(/\s+/).filter(Boolean).join(" ");
  return text.length > limit ? text.slice(0, limit) + "…" : text;
}

// Renders the article body in the in-app reader, so it only needs to be
// safe to drop into innerHTML — not a full readability-style rewrite. We
// only ever use whatever the feed's own content:encoded/content field
// already contains (i.e. what the publisher chose to syndicate), never a
// separate fetch of the article page itself.
function sanitizeArticleHtml(html) {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "a", "img", "figure", "figcaption",
      "blockquote", "ul", "ol", "li", "h2", "h3", "h4", "hr", "pre", "code", "span",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt"],
    },
    allowedSchemes: ["http", "https"],
    nonTextTags: ["script", "style", "iframe", "object", "embed", "form", "textarea"],
    exclusiveFilter: (frame) =>
      frame.tag === "a" && !/^https?:\/\//i.test(frame.attribs.href ?? ""),
  }).trim();
}

function extractImage(item) {
  if (item.enclosure?.url && /^image\//.test(item.enclosure.type ?? "")) {
    return item.enclosure.url;
  }
  const mediaContent = Array.isArray(item.mediaContent)
    ? item.mediaContent[0]
    : item.mediaContent;
  if (mediaContent?.$?.url) return mediaContent.$.url;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;

  const html = item["content:encoded"] || item.content || "";
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return match ? match[1] : null;
}

function articleId(item) {
  return item.guid || item.id || item.link;
}

async function loadPreviousFeed() {
  try {
    const raw = await readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchSource(source) {
  try {
    const xml = await fetchFeedXml(source.feedUrl, FETCH_TIMEOUT_MS);
    const feed = await parser.parseString(sanitizeXmlEntities(xml));
    const articles = (feed.items ?? [])
      .filter((item) => item.title && item.link)
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map((item) => ({
        id: articleId(item),
        title: stripHtml(item.title, Infinity),
        link: item.link,
        summary: stripHtml(item.contentSnippet || item.content || item.summary || ""),
        content: sanitizeArticleHtml(item["content:encoded"] || item.content || item.summary || ""),
        publishedAt: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
        imageUrl: extractImage(item),
        sourceId: source.id,
        sourceName: source.name,
        category: source.category ?? null,
      }));
    return { source, status: "ok", articles };
  } catch (error) {
    return { source, status: "error", error: String(error?.message ?? error), articles: [] };
  }
}

// Sorting purely by publishedAt lets a high-frequency source (Hacker News,
// say) flood the top of the feed just because it posts more often than
// everyone else. Interleave instead: each "round" takes at most one article
// per source (that source's next-most-recent), rounds ordered by recency
// among that round's picks — so no source can appear twice before every
// other active source has had a turn, while the feed still reads roughly
// newest-first overall.
function interleaveBySource(articles) {
  const bySource = new Map();
  for (const article of articles) {
    if (!bySource.has(article.sourceId)) bySource.set(article.sourceId, []);
    bySource.get(article.sourceId).push(article);
  }
  for (const queue of bySource.values()) {
    queue.sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0));
  }

  const queues = Array.from(bySource.values());
  const interleaved = [];
  for (let round = 0; interleaved.length < articles.length; round++) {
    const picks = queues
      .filter((queue) => queue.length > round)
      .map((queue) => queue[round])
      .sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0));
    if (picks.length === 0) break;
    interleaved.push(...picks);
  }
  return interleaved;
}

async function main() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, "utf8"));
  const previousFeed = await loadPreviousFeed();
  const previousArticlesBySource = new Map();
  for (const article of previousFeed?.articles ?? []) {
    if (!previousArticlesBySource.has(article.sourceId)) {
      previousArticlesBySource.set(article.sourceId, []);
    }
    previousArticlesBySource.get(article.sourceId).push(article);
  }

  const results = await Promise.all(sources.map(fetchSource));

  const merged = new Map();
  const sourceStatuses = [];

  for (const { source, status, error, articles } of results) {
    sourceStatuses.push({
      id: source.id,
      name: source.name,
      siteUrl: source.siteUrl,
      category: source.category ?? null,
      status,
      error: error ?? null,
    });

    const effectiveArticles =
      status === "ok" ? articles : previousArticlesBySource.get(source.id) ?? [];

    for (const article of effectiveArticles) {
      if (article.id) merged.set(article.id, article);
    }
  }

  const articles = interleaveBySource(Array.from(merged.values())).slice(0, MAX_TOTAL_ITEMS);

  const output = {
    generatedAt: new Date().toISOString(),
    sources: sourceStatuses,
    articles,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  const failed = sourceStatuses.filter((s) => s.status === "error");
  console.log(`Fetched ${sources.length} sources, ${articles.length} articles total.`);
  if (failed.length) {
    console.log(`${failed.length} source(s) failed this run:`);
    for (const s of failed) console.log(`  - ${s.name}: ${s.error}`);
  }
}

main()
  .then(() => {
    // A stalled connection to some host can leave a dangling socket that
    // keeps the event loop alive well past our own timeouts; force exit
    // once the output is written rather than hoping Node drains naturally.
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
