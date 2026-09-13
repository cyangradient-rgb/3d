import Foundation
import Combine

@MainActor
final class FeedStore: ObservableObject {
    static let shared = FeedStore()

    @Published private(set) var articles: [Article] = []
    @Published private(set) var isRefreshing = false
    @Published private(set) var lastRefreshDate: Date?
    @Published private(set) var refreshErrors: [String: String] = [:]
    @Published var enabledPublicationIDs: Set<String> {
        didSet { persistEnabledPublications() }
    }

    let allPublications = Publication.defaults

    private let session: URLSession
    private let cacheURL: URL
    private let enabledDefaultsKey = "enabledPublicationIDs"

    private init(session: URLSession = .shared) {
        self.session = session
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        self.cacheURL = caches.appendingPathComponent("articles-cache.json")

        if let saved = UserDefaults.standard.array(forKey: enabledDefaultsKey) as? [String] {
            enabledPublicationIDs = Set(saved)
        } else {
            enabledPublicationIDs = Set(Publication.defaults.map(\.id))
        }

        loadCachedArticles()
    }

    var visibleArticles: [Article] {
        articles.filter { enabledPublicationIDs.contains($0.publicationID) }
    }

    func togglePublication(_ id: String) {
        if enabledPublicationIDs.contains(id) {
            enabledPublicationIDs.remove(id)
        } else {
            enabledPublicationIDs.insert(id)
        }
    }

    /// Fetches every publication concurrently, merges the results by article
    /// id, and sorts newest-first. Safe to call from the UI (pull-to-refresh,
    /// launch) or from a background task.
    func refreshAll() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        let publications = allPublications
        let results = await withTaskGroup(of: (Publication, Result<[Article], Error>).self) { group in
            for publication in publications {
                group.addTask { [session] in
                    do {
                        let (data, _) = try await session.data(from: publication.feedURL)
                        let articles = FeedParser.parse(data: data).compactMap { item -> Article? in
                            guard !item.title.isEmpty, let url = URL(string: item.link) else { return nil }
                            let id = item.guid.isEmpty ? item.link : item.guid
                            return Article(
                                id: id,
                                title: item.title,
                                link: url,
                                summary: HTMLStripper.plainText(from: item.summary),
                                publishedAt: FeedDateParser.parse(item.dateString),
                                imageURL: item.imageURLString.flatMap(URL.init(string:)),
                                publicationID: publication.id,
                                publicationName: publication.name
                            )
                        }
                        return (publication, .success(articles))
                    } catch {
                        return (publication, .failure(error))
                    }
                }
            }

            var collected: [(Publication, Result<[Article], Error>)] = []
            for await result in group { collected.append(result) }
            return collected
        }

        var merged: [String: Article] = [:]
        var newErrors: [String: String] = [:]
        for (publication, result) in results {
            switch result {
            case .success(let fetched):
                for article in fetched { merged[article.id] = article }
            case .failure(let error):
                newErrors[publication.id] = error.localizedDescription
            }
        }

        // A publication that failed this round keeps its last-known articles
        // instead of vanishing from the feed because of a transient error.
        for article in articles where newErrors[article.publicationID] != nil && merged[article.id] == nil {
            merged[article.id] = article
        }

        articles = merged.values.sorted { ($0.publishedAt ?? .distantPast) > ($1.publishedAt ?? .distantPast) }
        refreshErrors = newErrors
        lastRefreshDate = Date()
        persistArticlesCache()
    }

    private func persistEnabledPublications() {
        UserDefaults.standard.set(Array(enabledPublicationIDs), forKey: enabledDefaultsKey)
    }

    private func persistArticlesCache() {
        do {
            let data = try JSONEncoder().encode(articles)
            try data.write(to: cacheURL, options: .atomic)
        } catch {
            print("Failed to cache articles: \(error)")
        }
    }

    private func loadCachedArticles() {
        guard let data = try? Data(contentsOf: cacheURL),
              let decoded = try? JSONDecoder().decode([Article].self, from: data) else { return }
        articles = decoded
    }
}
