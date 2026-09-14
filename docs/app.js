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
  const entry = document.createElement(isSafeHttpUrl(article.link) ? "a" : "div");
  entry.className = "entry";
  if (isSafeHttpUrl(article.link)) {
    entry.href = article.link;
    entry.target = "_blank";
    entry.rel = "noopener noreferrer";
  }

  if (isSafeHttpUrl(article.imageUrl)) {
    const img = document.createElement("img");
    img.className = "entry-image";
    img.loading = "lazy";
    img.alt = "";
    img.src = article.imageUrl;
    img.onerror = () => img.remove();
    entry.appendChild(img);
  }

  const body = document.createElement("div");
  body.className = "entry-body";

  const title = document.createElement("div");
  title.className = "entry-title";
  title.textContent = article.title ?? "";
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "entry-meta";
  meta.textContent = [article.sourceName, relativeTime(article.publishedAt)]
    .filter(Boolean)
    .join(" · ");
  body.appendChild(meta);

  entry.appendChild(body);

  return entry;
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
    li.className = "source-row";

    const enabled = !disabledSourceIds.has(source.id);

    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.textContent = source.name;
    nameButton.className = enabled ? "" : "source-name-disabled";
    nameButton.setAttribute("aria-pressed", String(enabled));
    nameButton.setAttribute("aria-label", `Toggle ${source.name}`);
    nameButton.addEventListener("click", () => {
      if (disabledSourceIds.has(source.id)) {
        disabledSourceIds.delete(source.id);
      } else {
        disabledSourceIds.add(source.id);
      }
      saveDisabledSourceIds(disabledSourceIds);
      render();
    });
    li.appendChild(nameButton);

    const status = document.createElement("span");
    status.className = "source-status";
    status.textContent = source.status === "error" ? "!" : enabled ? "on" : "off";
    li.appendChild(status);

    sourcesListEl.appendChild(li);
  }
}

function renderStatus() {
  if (isRefreshing) {
    statusTextEl.textContent = "refreshing";
    return;
  }
  if (!currentFeed?.generatedAt) {
    statusTextEl.textContent = "";
    return;
  }
  statusTextEl.textContent = `updated ${relativeTime(currentFeed.generatedAt)}`;
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
      statusTextEl.textContent = "couldn't load";
    } else {
      statusTextEl.textContent = "couldn't refresh";
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
