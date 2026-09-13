import Foundation

struct Article: Identifiable, Codable, Hashable {
    /// Stable identity derived from the feed's guid/id, falling back to the link.
    let id: String
    let title: String
    let link: URL
    let summary: String?
    let publishedAt: Date?
    let imageURL: URL?
    let publicationID: String
    let publicationName: String
}
