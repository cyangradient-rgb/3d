import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Parser from "rss-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(__dirname, "sources.json");
const OUTPUT_PATH = path.join(__dirname, "..", "docs", "feed.json");

const MAX_ITEMS_PER_SOURCE = 20;
const MAX_TOTAL_ITEMS = 400;
const FETCH_TIMEOUT_MS = 15000;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; PublicationsFeedBot/1.0; +https://github.com/)",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

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
    const feed = await parser.parseURL(source.feedUrl);
    const articles = (feed.items ?? [])
      .filter((item) => item.title && item.link)
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map((item) => ({
        id: articleId(item),
        title: item.title.trim(),
        link: item.link,
        summary: stripHtml(item.contentSnippet || item.content || item.summary || ""),
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

  const articles = Array.from(merged.values())
    .sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0))
    .slice(0, MAX_TOTAL_ITEMS);

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
