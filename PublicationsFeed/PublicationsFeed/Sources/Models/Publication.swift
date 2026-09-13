import Foundation

struct Publication: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let feedURL: URL

    /// Starter list of well-known publications with reliable RSS/Atom feeds.
    /// Add or remove entries here to change what ships in the app by default;
    /// readers can still toggle any of these off from the Sources screen.
    static let defaults: [Publication] = [
        Publication(id: "nyt", name: "The New York Times",
                    feedURL: URL(string: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml")!),
        Publication(id: "verge", name: "The Verge",
                    feedURL: URL(string: "https://www.theverge.com/rss/index.xml")!),
        Publication(id: "wired", name: "Wired",
                    feedURL: URL(string: "https://www.wired.com/feed/rss")!),
        Publication(id: "arstechnica", name: "Ars Technica",
                    feedURL: URL(string: "https://feeds.arstechnica.com/arstechnica/index")!),
        Publication(id: "atlantic", name: "The Atlantic",
                    feedURL: URL(string: "https://www.theatlantic.com/feed/all/")!),
        Publication(id: "bbc", name: "BBC News",
                    feedURL: URL(string: "http://feeds.bbci.co.uk/news/rss.xml")!),
        Publication(id: "techcrunch", name: "TechCrunch",
                    feedURL: URL(string: "https://techcrunch.com/feed/")!),
        Publication(id: "npr", name: "NPR",
                    feedURL: URL(string: "https://feeds.npr.org/1001/rss.xml")!)
    ]
}
