import Foundation

enum SafeURLPolicy {
    static func githubURL(from rawValue: String) -> URL? {
        guard
            let components = URLComponents(string: rawValue),
            components.scheme?.lowercased() == "https",
            let host = components.host?.lowercased(),
            host == "github.com",
            components.user == nil,
            components.password == nil,
            components.port == nil,
            components.query == nil,
            components.fragment == nil,
            !components.percentEncodedPath.contains("%")
        else {
            return nil
        }
        let segments = components.percentEncodedPath.split(
            separator: "/",
            omittingEmptySubsequences: false
        )
        guard
            segments.count == 5,
            segments[0].isEmpty,
            String(segments[1]).range(
                of: #"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$"#,
                options: .regularExpression
            ) != nil,
            !segments[1].hasSuffix("-"),
            String(segments[2]).range(
                of: #"^[A-Za-z0-9._-]{1,100}$"#,
                options: .regularExpression
            ) != nil,
            segments[2] != ".",
            segments[2] != "..",
            segments[3] == "issues" || segments[3] == "pull",
            let number = Int(segments[4]),
            number > 0,
            String(number) == segments[4]
        else {
            return nil
        }
        return components.url
    }

    static func dashboardURL(
        path: String,
        baseURL: URL = URL(string: "https://app.blabase.com")!
    ) -> URL? {
        guard path.hasPrefix("/"), !path.hasPrefix("//") else { return nil }
        guard var components = URLComponents(
            url: baseURL,
            resolvingAgainstBaseURL: false
        ) else {
            return nil
        }
        let scheme = components.scheme?.lowercased()
        let host = components.host?.lowercased()
        let production =
            scheme == "https" && host == "app.blabase.com" && components.port == nil
        let localDevelopment =
            scheme == "http" &&
            (host == "localhost" || host == "127.0.0.1") &&
            (components.port == nil || (1...65_535).contains(components.port ?? 0))
        guard
            production || localDevelopment,
            components.user == nil,
            components.password == nil,
            components.query == nil,
            components.fragment == nil
        else {
            return nil
        }
        components.path = path
        components.query = nil
        components.fragment = nil
        return components.url
    }
}
