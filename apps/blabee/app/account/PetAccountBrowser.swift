import AppKit
import AuthenticationServices
import Foundation

@MainActor
protocol PetAccountBrowsing: AnyObject {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
    func cancel()
}

/// AuthenticationServices routes the callback to this exact browser session.
/// No global URL handler, callback server, or bearer token in a URL is needed.
@MainActor
final class PetASWebAccountBrowser: NSObject, PetAccountBrowsing, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, any Error>?
    private var attemptID: UUID?
    private var presentationWindow: ASPresentationAnchor?
    private var timeout: Task<Void, Never>?

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        guard session == nil else { throw PetAccountAuthError.serviceUnavailable }
        guard let window = NSApplication.shared.keyWindow
            ?? NSApplication.shared.mainWindow
            ?? NSApplication.shared.windows.first(where: { $0.isVisible })
        else { throw PetAccountAuthError.serviceUnavailable }
        presentationWindow = window
        let id = UUID()
        attemptID = id
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let completion = Self.makeCompletionHandler { [weak self] url, error in
                self?.finish(id: id, url: url, error: error)
            }
            let session = ASWebAuthenticationSession(
                url: url, callbackURLScheme: callbackScheme, completionHandler: completion
            )
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            guard session.start() else {
                finish(id: id, url: nil, error: .serviceUnavailable)
                return
            }
            timeout = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(300)) } catch { return }
                guard let self, self.attemptID == id else { return }
                self.cancel()
            }
        }
    }

    // AuthenticationServices can invoke its Objective-C completion on an XPC queue.
    // A closure inheriting MainActor would trap before it could enqueue the Task.
    nonisolated static func makeCompletionHandler(
        deliver: @escaping @MainActor @Sendable (URL?, PetAccountAuthError?) -> Void
    ) -> @Sendable (URL?, (any Error)?) -> Void {
        { @Sendable url, error in
            let failure: PetAccountAuthError? = error.map {
                ($0 as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    ? .cancelled : .serviceUnavailable
            }
            Task { @MainActor in
                deliver(url, failure)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Retained until completion, including when the menu-bar panel hides.
        presentationWindow ?? ASPresentationAnchor()
    }

    func cancel() {
        guard let id = attemptID else { return }
        session?.cancel()
        finish(id: id, url: nil, error: .cancelled)
    }

    private func finish(id: UUID, url: URL?, error: PetAccountAuthError?) {
        guard attemptID == id else { return }
        let continuation = continuation
        self.continuation = nil
        attemptID = nil
        timeout?.cancel()
        timeout = nil
        session = nil
        presentationWindow = nil
        if let error {
            continuation?.resume(throwing: error)
        } else if let url {
            continuation?.resume(returning: url)
        } else {
            continuation?.resume(throwing: PetAccountAuthError.invalidCallback)
        }
    }
}
