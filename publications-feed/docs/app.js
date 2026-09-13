const FEED_URL = "feed.json";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const DISABLED_SOURCES_KEY = "publicationsFeed.disabledSourceIds";
const CACHED_FEED_KEY = "publicationsFeed.cachedFeed";

const articleListEl = document.getElementById("articleList");
const emptyStateEl = document.getElementById("emptyState");
const statusTextEl = document.getElementById("statusText");
const refreshButton = document.getElementById("refreshButton");
const emptyRefreshButton = document.getElementById("emptyRefreshButton");
const sourcesButton = document.getElementById("sourcesButton");
const sourcesDialog = document.getElementById("sourcesDialog");
const closeSourcesButton = document.getElementById("closeSourcesButton");
const sourcesListEl = document.getElementById("sourcesList");

let currentFeed = null;
let isRefreshing = false;

function loadDisabledSourceIds() {
  try {
    const raw = localStorage.getItem(DISABLED_SOURCES_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveDisabledSourceIds(set) {
  try {
    localStorage.setItem(DISABLED_SOURCES_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // localStorage unavailable (private mode etc); toggles just won't persist.
  }
}

let disabledSourceIds = loadDisabledSourceIds();

function isSafeHttpUrl(url) {
  if (typeof url !== "string") return false;
  return /^https:\/\//i.test(url) || /^http:\/\//i.test(url);
}

function relativeTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const divisions = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.34524, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ];
  let duration = diffSeconds;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return "";
}

function buildArticleCard(article) {
  const card = document.createElement(isSafeHttpUrl(article.link) ? "a" : "div");
  card.className = "article-card";
  if (isSafeHttpUrl(article.link)) {
    card.href = article.link;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
  }

  const body = document.createElement("div");
  body.className = "article-body";

  const source = document.createElement("div");
  source.className = "article-source";
  source.textContent = article.sourceName ?? "";
  body.appendChild(source);

  const title = document.createElement("div");
  title.className = "article-title";
  title.textContent = article.title ?? "";
  body.appendChild(title);

  if (article.summary) {
    const summary = document.createElement("div");
    summary.className = "article-summary";
    summary.textContent = article.summary;
    body.appendChild(summary);
  }

  const time = document.createElement("div");
  time.className = "article-time";
  time.textContent = relativeTime(article.publishedAt);
  body.appendChild(time);

  card.appendChild(body);

  if (isSafeHttpUrl(article.imageUrl)) {
    const img = document.createElement("img");
    img.className = "article-thumb";
    img.loading = "lazy";
    img.alt = "";
    img.src = article.imageUrl;
    img.onerror = () => img.remove();
    card.appendChild(img);
  }

  return card;
}

function render() {
  if (!currentFeed) return;

  const visibleArticles = currentFeed.articles.filter(
    (article) => !disabledSourceIds.has(article.sourceId)
  );

  articleListEl.innerHTML = "";
  if (visibleArticles.length === 0) {
    emptyStateEl.hidden = false;
  } else {
    emptyStateEl.hidden = true;
    const fragment = document.createDocumentFragment();
    for (const article of visibleArticles) {
      fragment.appendChild(buildArticleCard(article));
    }
    articleListEl.appendChild(fragment);
  }

  renderSourcesList();
  renderStatus();
}

function renderSourcesList() {
  sourcesListEl.innerHTML = "";
  if (!currentFeed) return;

  for (const source of currentFeed.sources) {
    const li = document.createElement("li");

    const nameWrap = document.createElement("span");
    const enabled = !disabledSourceIds.has(source.id);
    nameWrap.textContent = source.name + (source.status === "error" ? " ⚠" : "");
    nameWrap.className = enabled ? "" : "source-name-disabled";
    li.appendChild(nameWrap);

    const toggle = document.createElement("button");
    toggle.className = "source-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-checked", String(enabled));
    toggle.setAttribute("aria-label", `Toggle ${source.name}`);
    toggle.addEventListener("click", () => {
      if (disabledSourceIds.has(source.id)) {
        disabledSourceIds.delete(source.id);
      } else {
        disabledSourceIds.add(source.id);
      }
      saveDisabledSourceIds(disabledSourceIds);
      render();
    });
    li.appendChild(toggle);

    sourcesListEl.appendChild(li);
  }
}

function renderStatus() {
  if (isRefreshing) {
    statusTextEl.textContent = "Refreshing…";
    return;
  }
  if (!currentFeed?.generatedAt) {
    statusTextEl.textContent = "";
    return;
  }
  statusTextEl.textContent = `Updated ${relativeTime(currentFeed.generatedAt)}`;
}

async function refresh() {
  if (isRefreshing) return;
  isRefreshing = true;
  renderStatus();

  try {
    const response = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    currentFeed = data;
    try {
      localStorage.setItem(CACHED_FEED_KEY, JSON.stringify(data));
    } catch {
      // ignore storage errors
    }
  } catch (error) {
    console.error("Failed to refresh feed", error);
    if (!currentFeed) {
      statusTextEl.textContent = "Couldn't load the feed.";
    } else {
      statusTextEl.textContent = "Couldn't refresh — showing saved articles";
    }
  } finally {
    isRefreshing = false;
    render();
  }
}

function hydrateFromCache() {
  try {
    const raw = localStorage.getItem(CACHED_FEED_KEY);
    if (raw) {
      currentFeed = JSON.parse(raw);
      render();
    }
  } catch {
    // ignore
  }
}

refreshButton.addEventListener("click", refresh);
emptyRefreshButton.addEventListener("click", refresh);
sourcesButton.addEventListener("click", () => sourcesDialog.showModal());
closeSourcesButton.addEventListener("click", () => sourcesDialog.close());
sourcesDialog.addEventListener("click", (event) => {
  if (event.target === sourcesDialog) sourcesDialog.close();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

setInterval(refresh, POLL_INTERVAL_MS);

hydrateFromCache();
refresh();
