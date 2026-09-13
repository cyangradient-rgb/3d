# Publications Feed

A native SwiftUI iOS app that merges your favorite publications' RSS/Atom
feeds into a single, auto-refreshing reading feed.

## Features

- **Built-in publication list** — a starter set of well-known feeds (NYT,
  The Verge, Wired, Ars Technica, The Atlantic, BBC News, TechCrunch, NPR)
  defined in `PublicationsFeed/Sources/Models/Publication.swift`. Edit that
  array to change what ships by default.
- **On-device RSS/Atom parsing** — no backend, no API keys. All feeds are
  fetched and merged directly on-device (`FeedStore.swift`, `FeedParser.swift`).
- **Auto-refresh**
  - Pull-to-refresh and a refresh on first launch.
  - iOS **Background App Refresh** (`BackgroundRefreshManager.swift`) keeps
    the feed populated with new articles even when the app isn't open,
    using `BGTaskScheduler`.
- **Easy to consume**
  - One merged, newest-first list across all your publications.
  - Compact rows with a snippet and thumbnail; tap to read in an in-app
    Safari view with Reader mode.
  - A "Sources" screen (toolbar icon) lets you toggle individual
    publications on/off without touching code.
  - Articles are cached to disk so the feed shows instantly on relaunch,
    even before the network refresh completes.

## Project layout

```
PublicationsFeed/
  project.yml                     # XcodeGen project spec
  PublicationsFeed/
    Info.plist
    Sources/
      App/                        # @main entry point, AppDelegate
      Models/                     # Article, Publication
      Services/                   # FeedStore, FeedParser, background refresh
      Views/                      # FeedListView, ArticleRowView, SourcesView, SafariView
    Resources/
      Assets.xcassets/
```

The `.xcodeproj` is intentionally **not** committed — it's generated from
`project.yml` so there's nothing to merge-conflict on. Regenerate it any
time with XcodeGen (see below).

## Building & running

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen) (one-time):
   ```sh
   brew install xcodegen
   ```
2. From the `PublicationsFeed/` directory, generate the Xcode project:
   ```sh
   xcodegen generate
   ```
3. Open `PublicationsFeed.xcodeproj` in Xcode 15+ and run on a simulator
   or device (iOS 16+).

If you'd rather not install XcodeGen, create a new iOS App project in
Xcode (SwiftUI, iOS 16+) and drag the contents of `Sources/` and
`Resources/` into it, then copy the background-mode keys from `Info.plist`
into your generated one.

### Changing the bundle identifier

The default bundle id is `com.cyangradient.publicationsfeed`
(`project.yml` → `PRODUCT_BUNDLE_IDENTIFIER`, and it must also match the
identifier in `Info.plist`'s `BGTaskSchedulerPermittedIdentifiers` and
`BackgroundRefreshManager.taskIdentifier`). Update all three together if
you change it, or background refresh registration will silently fail.

## Notes on background refresh

- iOS decides *when* to actually run background refresh tasks based on
  usage patterns and battery/network conditions — the 30-minute minimum
  interval in `BackgroundRefreshManager` is a floor, not a guarantee.
- To test it in the simulator/device during development, pause at a
  breakpoint after `BGTaskScheduler.shared.submit(...)` and run in the
  Xcode debugger console:
  ```
  e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.cyangradient.publicationsfeed.refresh"]
  ```
