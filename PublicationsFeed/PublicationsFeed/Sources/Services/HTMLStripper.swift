import Foundation

/// Turns a feed's (often HTML) description into a short plain-text snippet
/// for the row preview. Full reading happens in-browser via SafariView.
enum HTMLStripper {
    static func plainText(from html: String, limit: Int = 240) -> String {
        guard !html.isEmpty else { return "" }

        var text = html.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        let entities: [String: String] = [
            "&nbsp;": " ", "&amp;": "&", "&#39;": "'",
            "&quot;": "\"", "&lt;": "<", "&gt;": ">"
        ]
        for (entity, replacement) in entities {
            text = text.replacingOccurrences(of: entity, with: replacement)
        }
        text = text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        guard text.count > limit else { return text }
        let cutoff = text.index(text.startIndex, offsetBy: limit)
        return String(text[..<cutoff]) + "…"
    }
}
