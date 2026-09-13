# Publications Feed (web app)

A small, no-backend web app that merges your favorite publications' RSS/Atom
feeds into one auto-refreshing, mobile-friendly reading list — installable
straight to an iPhone home screen from Safari, no App Store or Xcode needed.

## How it works

- **`scripts/fetch-feeds.mjs`** reads `scripts/sources.json` (the list of
  publications), fetches and parses each feed with
  [`rss-parser`](https://github.com/rbren/rss-parser), merges everything
  into one newest-first list, and writes `docs/feed.json`.
- **`.github/workflows/refresh-feed.yml`** runs that script every 30
  minutes on GitHub's own servers (and on demand via "Run workflow"),
  committing `docs/feed.json` back to the repo whenever it changes. This is
  what makes the feed "auto-refresh" — no server of your own required.
- **`docs/`** is a static site (served by GitHub Pages) that fetches
  `feed.json`, renders the article list, and polls it every 5 minutes while
  open (plus on manual refresh and whenever the app is reopened).

Because everything lives in `docs/feed.json`, the page itself never needs
to talk to the individual publication sites directly — it only ever fetches
one same-origin JSON file, so there's no CORS problem.

## One-time setup

1. **Enable GitHub Pages** for this repo: Settings → Pages → Source:
   "Deploy from a branch" → Branch: `main`, folder: `/publications-feed/docs`
   → Save. (This has to happen after this branch is merged to `main`, or you
   can temporarily point Pages at this branch to preview it sooner.)
2. GitHub will give you a URL like
   `https://<username>.github.io/<repo>/`. Open it in Safari on your
   iPhone.
3. Tap the Share icon → **Add to Home Screen**. That's the install step —
   it adds a real icon that opens full-screen, no browser chrome.

## Auto-refresh schedule

Scheduled GitHub Actions workflows only run from the repo's **default
branch** (`main`). Until this is merged, the 30-minute schedule won't fire
on its own — but you can trigger it manually any time from the Actions tab
("Refresh publications feed" → Run workflow → pick this branch) to test it
before merging.

## Editing your sources

Edit `scripts/sources.json` — each entry is `{ id, name, siteUrl, feedUrl,
category }`. After editing, either wait for the next scheduled run or
trigger the workflow manually. The app also shows a ⚠ next to any
publication in the Sources sheet whose feed failed on the last run (check
the Action's logs for the specific error).

## Important caveat: feed URLs are unverified

This repo was built in a sandboxed session whose outbound network is
restricted to an internal allowlist, so **none of the feed URLs in
`sources.json` could actually be fetched and confirmed here** — they're
research-based best guesses (mostly high-confidence WordPress/Substack
`/feed` patterns, corroborated via web search, but not fetched). The
workflow degrades gracefully around bad URLs (a failing source just shows
0 new articles and a ⚠, it won't break the rest of the feed), but expect to
need to fix a few after the first real run — check the Action's logs.

Three sources from the original list couldn't be confidently identified
from the home-screen icons alone; the user confirmed them directly, and
they're now included as `daily-camera`, `arena-magazine`, and `surface`
(their feed URLs are still unverified WordPress-pattern guesses like the
rest of the list — see above). A handful of others from the screenshots
have no real article RSS feed at all and were left out for that reason:
Never Too Small, Savee, Softer Volumes, Design Anthology, Maximage Color
Combinations, and Longform (which shut down in 2022).
