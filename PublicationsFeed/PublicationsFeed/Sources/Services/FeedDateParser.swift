import Foundation

/// Feeds mix RFC 822 (RSS `pubDate`) and ISO 8601 (Atom `published`/`updated`)
/// date formats, plus small real-world variations. Try each in turn.
enum FeedDateParser {
    private static let iso8601Fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let rfc822Formatters: [DateFormatter] = {
        [
            "EEE, dd MMM yyyy HH:mm:ss zzz",
            "EEE, dd MMM yyyy HH:mm:ss Z",
            "dd MMM yyyy HH:mm:ss zzz",
            "dd MMM yyyy HH:mm:ss Z"
        ].map { pattern in
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "UTC")
            formatter.dateFormat = pattern
            return formatter
        }
    }()

    static func parse(_ string: String) -> Date? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let date = iso8601Fractional.date(from: trimmed) { return date }
        if let date = iso8601.date(from: trimmed) { return date }
        for formatter in rfc822Formatters {
            if let date = formatter.date(from: trimmed) { return date }
        }
        return nil
    }
}
