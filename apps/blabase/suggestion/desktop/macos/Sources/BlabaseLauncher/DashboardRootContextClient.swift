import Foundation

enum DashboardRootContextClientError: LocalizedError, Equatable, Sendable {
    case invalidDashboardURL
    case unreachable
    case invalidResponse
    case responseTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidDashboardURL:
            "허용된 Blabase 대시보드 주소가 아닙니다."
        case .unreachable:
            "웹 대시보드의 작업 저장소 상태를 확인하지 못했습니다."
        case .invalidResponse:
            "웹 대시보드의 작업 저장소 응답을 확인하지 못했습니다."
        case .responseTooLarge:
            "웹 대시보드의 작업 저장소 응답이 너무 큽니다."
        }
    }
}

@MainActor
final class DashboardRootContextClient {
    typealias DataLoader = (URLRequest) async throws -> (Data, URLResponse)

    private static let maximumResponseBytes = 16 * 1_024

    private let dataLoader: DataLoader
    private let timeoutInterval: TimeInterval

    init(
        timeoutInterval: TimeInterval = 5,
        dataLoader: @escaping DataLoader = { request in
            try await URLSession.shared.data(for: request)
        }
    ) {
        self.timeoutInterval = timeoutInterval
        self.dataLoader = dataLoader
    }

    func getRootContext(baseURL: URL) async throws -> DashboardRootContext {
        guard let endpoint = SafeURLPolicy.dashboardRootContextURL(
            baseURL: baseURL
        ) else {
            throw DashboardRootContextClientError.invalidDashboardURL
        }
        var request = URLRequest(
            url: endpoint,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: timeoutInterval
        )
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await dataLoader(request)
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw DashboardRootContextClientError.unreachable
        }
        try Task.checkCancellation()
        guard data.count <= Self.maximumResponseBytes else {
            throw DashboardRootContextClientError.responseTooLarge
        }
        guard
            let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200,
            httpResponse.url == endpoint
        else {
            throw DashboardRootContextClientError.invalidResponse
        }
        do {
            return try JSONDecoder().decode(
                DashboardRootContext.self,
                from: data
            )
        } catch {
            throw DashboardRootContextClientError.invalidResponse
        }
    }
}
