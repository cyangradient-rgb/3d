// Some browsers try to restore the previous scroll position on reload —
// override that so the page always starts at the top, with the logo where
// it's meant to be, rather than wherever the user last scrolled to.
if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}
window.scrollTo(0, 0);

const FEED_URL = "feed.json";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const SELECTED_SOURCES_KEY = "chip.selectedSourceIds";
const CACHED_FEED_KEY = "publicationsFeed.cachedFeed";
const FONT_KEY = "chip.font";

const appHeaderEl = document.querySelector(".app-header");
const headerIconEl = document.querySelector(".header-icon");
const articleListEl = document.getElementById("articleList");
const emptyStateEl = document.getElementById("emptyState");
const statusTextEl = document.getElementById("statusText");
const emptyRefreshButton = document.getElementById("emptyRefreshButton");
const sourcesButton = document.getElementById("sourcesButton");
const sourcesDialog = document.getElementById("sourcesDialog");
const closeSourcesButton = document.getElementById("closeSourcesButton");
const sourcesListEl = document.getElementById("sourcesList");
const fontOptionButtons = document.querySelectorAll(".font-option");

let currentFeed = null;
let isRefreshing = false;
let hasPlayedEntrance = false;

// Article/divider DOM nodes are kept and reused across renders (keyed by
// article id / divider label) rather than torn down and rebuilt every
// time — that's what lets an already-loaded thumbnail stay exactly as it
// is (no re-fetch, no flicker) when a background refresh or pull-to-refresh
// re-renders the list, and lets the stagger-in animation below apply only
// to genuinely new items instead of replaying for everything each time.
let renderedItemNodes = new Map();
const STAGGER_STEP_MS = 40;
const STAGGER_MAX_STEPS = 10;

// Fade + rise the whole UI in once on first paint (cache hydration or the
// initial fetch, whichever renders first) — never again on later refreshes.
function playEntranceOnce() {
  if (hasPlayedEntrance) return;
  hasPlayedEntrance = true;
  requestAnimationFrame(() => {
    document.body.classList.add("is-loaded");
  });
}

// null means "all" (no filter). A non-null Set means "show only these" —
// tapping a source chip switches from all -> just that source, and tapping
// more chips adds to the set; emptying the set falls back to "all".
function loadSelectedSourceIds() {
  try {
    const raw = localStorage.getItem(SELECTED_SOURCES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? new Set(parsed) : null;
  } catch {
    return null;
  }
}

function saveSelectedSourceIds(set) {
  try {
    if (set === null) {
      localStorage.removeItem(SELECTED_SOURCES_KEY);
    } else {
      localStorage.setItem(SELECTED_SOURCES_KEY, JSON.stringify(Array.from(set)));
    }
  } catch {
    // localStorage unavailable (private mode etc); selection just won't persist.
  }
}

let selectedSourceIds = loadSelectedSourceIds();

function loadFont() {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    return raw === "serif" || raw === "sans" ? raw : "mono";
  } catch {
    return "mono";
  }
}

function saveFont(font) {
  try {
    localStorage.setItem(FONT_KEY, font);
  } catch {
    // localStorage unavailable (private mode etc); selection just won't persist.
  }
}

let currentFont = loadFont();
document.body.setAttribute("data-font", currentFont);

function isSafeHttpUrl(url) {
  if (typeof url !== "string") return false;
  return /^https:\/\//i.test(url) || /^http:\/\//i.test(url);
}

// Compact form ("13h" rather than "13 hours ago") — units are unambiguous
// enough on their own that the "ago" reads as implied.
function relativeTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const diffSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));

  if (diffSeconds < 60) return "now";

  const minutes = diffSeconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m`;

  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;

  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;

  const weeks = days / 7;
  if (weeks < 4.34524) return `${Math.floor(weeks)}w`;

  const months = days / 30.44;
  if (months < 12) return `${Math.floor(months)}mo`;

  return `${Math.floor(days / 365.25)}y`;
}

// Groups articles into "today" / "yesterday" / weekday / date sections as
// the feed is walked in its existing (source-diversified) order — no
// re-sorting, just a divider wherever the calendar day changes.
function dateGroupLabel(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "long" });

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

function buildDateDivider(label) {
  const divider = document.createElement("div");
  divider.className = "date-divider";

  const leftOrnament = document.createElement("span");
  leftOrnament.className = "divider-ornament";
  leftOrnament.textContent = "⚘";
  leftOrnament.setAttribute("aria-hidden", "true");

  const labelEl = document.createElement("span");
  labelEl.className = "date-divider-label";
  labelEl.textContent = label;

  const rightOrnament = document.createElement("span");
  rightOrnament.className = "divider-ornament";
  rightOrnament.textContent = "⚘";
  rightOrnament.setAttribute("aria-hidden", "true");

  divider.append(leftOrnament, labelEl, rightOrnament);
  return divider;
}

function buildArticleCard(article) {
  const entry = document.createElement(isSafeHttpUrl(article.link) ? "a" : "div");
  entry.className = "entry";
  if (isSafeHttpUrl(article.link)) {
    entry.href = article.link;
    entry.target = "_blank";
    entry.rel = "noopener noreferrer";
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

  if (isSafeHttpUrl(article.imageUrl)) {
    const img = document.createElement("img");
    img.className = "entry-image";
    img.loading = "lazy";
    img.alt = "";
    // Fade in on the actual `load` event rather than the moment `src` is
    // set — a slow thumbnail otherwise pops in abruptly once its bytes
    // finally arrive, with no transition to soften it.
    img.onload = () => img.classList.add("is-loaded");
    img.onerror = () => img.remove();
    img.src = article.imageUrl;
    entry.appendChild(img);
  }

  return entry;
}

function render() {
  if (!currentFeed) return;

  // The underlying feed order is round-robined across sources to keep any
  // one source from dominating, so it isn't strictly chronological — sort
  // for display so the "today" / "yesterday" / ... dividers read in order
  // instead of jumping backward and forward in time.
  const visibleArticles = (
    selectedSourceIds === null
      ? currentFeed.articles
      : currentFeed.articles.filter((article) => selectedSourceIds.has(article.sourceId))
  )
    .slice()
    .sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0));

  if (visibleArticles.length === 0) {
    // Filtering down to a source with no results otherwise snaps instantly
    // — reuse the same entrance animation as article cards, but only when
    // the empty state was actually hidden a moment ago.
    if (emptyStateEl.hidden) {
      emptyStateEl.classList.remove("item-enter");
      void emptyStateEl.offsetWidth;
      emptyStateEl.style.setProperty("--stagger-delay", "0ms");
      emptyStateEl.classList.add("item-enter");
    }
    emptyStateEl.hidden = false;
    articleListEl.replaceChildren();
    renderedItemNodes = new Map();
  } else {
    emptyStateEl.hidden = true;

    const nextNodes = new Map();
    const fragment = document.createDocumentFragment();
    let newItemCount = 0;

    // Reuse the existing node for a key untouched (same article, same
    // divider label) so an already-loaded thumbnail is never re-fetched
    // or repainted; only a node built fresh here gets the stagger-in
    // animation, so unrelated background refreshes don't replay it for
    // articles that were already on screen.
    const placeItem = (key, build) => {
      let node = renderedItemNodes.get(key);
      if (!node) {
        node = build();
        node.style.setProperty("--stagger-delay", `${Math.min(newItemCount, STAGGER_MAX_STEPS) * STAGGER_STEP_MS}ms`);
        node.classList.add("item-enter");
        newItemCount++;
      }
      nextNodes.set(key, node);
      fragment.appendChild(node);
    };

    let lastGroupLabel = null;
    for (const article of visibleArticles) {
      const groupLabel = dateGroupLabel(article.publishedAt);
      if (groupLabel && groupLabel !== lastGroupLabel) {
        placeItem(`divider:${groupLabel}`, () => buildDateDivider(groupLabel));
        lastGroupLabel = groupLabel;
      }
      placeItem(`article:${article.id}`, () => buildArticleCard(article));
    }

    articleListEl.replaceChildren(fragment);
    renderedItemNodes = nextNodes;
  }

  renderSourceChips();
  renderStatus();
  playEntranceOnce();
}

function selectAllSources() {
  selectedSourceIds = null;
  saveSelectedSourceIds(null);
  render();
}

function toggleSource(sourceId) {
  const next = selectedSourceIds === null ? new Set() : new Set(selectedSourceIds);
  if (next.has(sourceId)) {
    next.delete(sourceId);
  } else {
    next.add(sourceId);
  }
  selectedSourceIds = next.size === 0 ? null : next;
  saveSelectedSourceIds(selectedSourceIds);
  render();
}

function renderSourceChips() {
  sourcesListEl.innerHTML = "";
  if (!currentFeed) return;

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "source-chip" + (selectedSourceIds === null ? " is-selected" : "");
  allChip.textContent = "all";
  allChip.setAttribute("aria-pressed", String(selectedSourceIds === null));
  allChip.addEventListener("click", selectAllSources);
  sourcesListEl.appendChild(allChip);

  for (const source of currentFeed.sources) {
    const isSelected = selectedSourceIds !== null && selectedSourceIds.has(source.id);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className =
      "source-chip" +
      (isSelected ? " is-selected" : "") +
      (source.status === "error" ? " has-error" : "");
    chip.textContent = source.name;
    chip.setAttribute("aria-pressed", String(isSelected));
    chip.addEventListener("click", () => toggleSource(source.id));
    sourcesListEl.appendChild(chip);
  }
}

function renderStatus() {
  appHeaderEl.classList.toggle("is-refreshing", isRefreshing);

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

emptyRefreshButton.addEventListener("click", refresh);
sourcesButton.addEventListener("click", () => {
  headerIconEl.classList.remove("is-bouncing");
  void headerIconEl.offsetWidth; // restart the animation even on rapid taps
  headerIconEl.classList.add("is-bouncing");
  sourcesDialog.showModal();
});
headerIconEl.addEventListener("animationend", () => {
  headerIconEl.classList.remove("is-bouncing");
});
closeSourcesButton.addEventListener("click", () => sourcesDialog.close());
sourcesDialog.addEventListener("click", (event) => {
  if (event.target === sourcesDialog) sourcesDialog.close();
});

function renderFontToggle() {
  fontOptionButtons.forEach((button) => {
    const isSelected = button.dataset.font === currentFont;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

fontOptionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentFont = button.dataset.font;
    document.body.setAttribute("data-font", currentFont);
    saveFont(currentFont);
    renderFontToggle();
  });
});

renderFontToggle();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

setInterval(refresh, POLL_INTERVAL_MS);

// Pull-to-refresh: a downward drag starting from the very top of the page.
// Deliberately simple — just detect the threshold crossing once and play a
// single fixed, subtle up-and-back animation, rather than tracking the
// drag distance live. Live 1:1 tracking fought with the browser's own
// touch/scroll handling and looked janky in practice.
const PULL_THRESHOLD_PX = 70;
let pullStartY = null;
let pullTriggered = false;

function playPullRefreshAnimation() {
  headerIconEl.classList.remove("is-pull-refreshing");
  void headerIconEl.offsetWidth; // restart the animation if triggered again quickly
  headerIconEl.classList.add("is-pull-refreshing");
}

headerIconEl.addEventListener("animationend", () => {
  headerIconEl.classList.remove("is-pull-refreshing");
});

document.addEventListener(
  "touchstart",
  (event) => {
    pullStartY = window.scrollY === 0 ? event.touches[0].clientY : null;
    pullTriggered = false;
  },
  { passive: true }
);

document.addEventListener(
  "touchmove",
  (event) => {
    if (pullStartY === null || pullTriggered) return;
    const delta = event.touches[0].clientY - pullStartY;
    if (delta > PULL_THRESHOLD_PX) {
      pullTriggered = true;
      playPullRefreshAnimation();
      refresh();
    }
  },
  { passive: true }
);

document.addEventListener("touchend", () => {
  pullStartY = null;
  pullTriggered = false;
});

hydrateFromCache();
refresh();
