// One-off maintenance helper: given a list of site URLs, fetch each
// homepage and look for the standard <link rel="alternate" type="...rss or
// atom..." href="..."> tag, plus a few common feed-path fallbacks. Prints
// findings to stdout — run via the "Discover feed URLs" workflow (manual
// dispatch only) and read the results from its job logs.
//
// Usage: node discover-feeds.mjs <siteUrl> [siteUrl...]

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15000;
const COMMON_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/atom.xml", "/index.xml"];

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, ok: response.ok, text: response.ok ? await response.text() : "" };
}

function extractFeedLinksFromHtml(html, baseUrl) {
  const found = [];
  const linkTagRegex = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkTagRegex) ?? []) {
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    const type = /type=["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    if (/alternate/i.test(rel) && /rss|atom/i.test(type)) {
      try {
        found.push(new URL(href, baseUrl).toString());
      } catch {
        // ignore malformed href
      }
    }
  }
  return [...new Set(found)];
}

async function probeCommonPaths(baseUrl) {
  const hits = [];
  for (const path of COMMON_PATHS) {
    const url = new URL(path, baseUrl).toString();
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && /xml|rss|atom/i.test(contentType)) {
        hits.push({ url, contentType });
      }
    } catch {
      // ignore — this is just a best-effort probe
    }
  }
  return hits;
}

async function discover(siteUrl) {
  const result = { siteUrl, homepageStatus: null, linkTagFeeds: [], commonPathHits: [], error: null };
  try {
    const { status, ok, text } = await fetchText(siteUrl);
    result.homepageStatus = status;
    if (ok) {
      result.linkTagFeeds = extractFeedLinksFromHtml(text, siteUrl);
    }
  } catch (error) {
    result.error = String(error?.message ?? error);
  }
  result.commonPathHits = await probeCommonPaths(siteUrl);
  return result;
}

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: node discover-feeds.mjs <siteUrl> [siteUrl...]");
    process.exit(1);
  }
  const results = await Promise.all(urls.map(discover));
  for (const r of results) {
    console.log(`\n=== ${r.siteUrl} ===`);
    console.log(`homepage status: ${r.homepageStatus ?? "fetch failed: " + r.error}`);
    if (r.linkTagFeeds.length) {
      console.log(`<link> feed tags found:`);
      for (const f of r.linkTagFeeds) console.log(`  - ${f}`);
    } else {
      console.log(`<link> feed tags found: none`);
    }
    if (r.commonPathHits.length) {
      console.log(`common-path probes that returned XML:`);
      for (const h of r.commonPathHits) console.log(`  - ${h.url} (${h.contentType})`);
    } else {
      console.log(`common-path probes that returned XML: none`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
