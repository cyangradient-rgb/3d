import Foundation

/// A minimal, dependency-free RSS 2.0 / Atom parser built on XMLParser.
/// It intentionally only extracts the handful of fields the feed UI needs.
final class FeedParser: NSObject, XMLParserDelegate {
    struct ParsedItem {
        var title: String = ""
        var link: String = ""
        var summary: String = ""
        var dateString: String = ""
        var imageURLString: String?
        var guid: String = ""
    }

    private var items: [ParsedItem] = []
    private var current: ParsedItem?
    private var buffer = ""
    private var isAtom = false

    static func parse(data: Data) -> [ParsedItem] {
        let delegate = FeedParser()
        let xmlParser = XMLParser(data: data)
        xmlParser.delegate = delegate
        xmlParser.parse()
        return delegate.items
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                qualifiedName qName: String?, attributes attributeDict: [String: String]) {
        buffer = ""

        switch elementName {
        case "item":
            current = ParsedItem()
        case "entry":
            isAtom = true
            current = ParsedItem()
        case "link":
            // Atom's <link> is a self-closing element with an href attribute;
            // RSS's <link> is plain text, handled in didEndElement instead.
            if isAtom, attributeDict["rel"] == nil || attributeDict["rel"] == "alternate",
               let href = attributeDict["href"] {
                current?.link = href
            }
        case "media:thumbnail", "media:content":
            if let url = attributeDict["url"] {
                current?.imageURLString = url
            }
        case "enclosure":
            if let url = attributeDict["url"], let type = attributeDict["type"], type.hasPrefix("image") {
                current?.imageURLString = url
            }
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        buffer += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?,
                qualifiedName qName: String?) {
        let trimmed = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
        buffer = ""

        switch elementName {
        case "title":
            if current != nil, current!.title.isEmpty { current?.title = trimmed }
        case "link":
            if !isAtom, !trimmed.isEmpty { current?.link = trimmed }
        case "guid", "id":
            if current != nil, current!.guid.isEmpty { current?.guid = trimmed }
        case "description", "summary":
            if current != nil, current!.summary.isEmpty { current?.summary = trimmed }
        case "pubDate", "published", "updated":
            if current != nil, current!.dateString.isEmpty { current?.dateString = trimmed }
        case "item", "entry":
            if let item = current { items.append(item) }
            current = nil
        default:
            break
        }
    }
}
