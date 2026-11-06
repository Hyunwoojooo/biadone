import AuthenticationServices
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Pet account browser")
@MainActor
struct PetAccountBrowserTests {
    @Test(
        "Native completions on a background queue deliver sanitized results on MainActor",
        arguments: AccountBrowserCompletionCase.allCases
    )
    fileprivate func completionFromBackgroundQueue(_ input: AccountBrowserCompletionCase) async {
        let result = await withCheckedContinuation { continuation in
            let completion = PetASWebAccountBrowser.makeCompletionHandler { url, error in
                MainActor.assertIsolated()
                continuation.resume(returning: AccountBrowserCompletionResult(url: url, error: error))
            }
            let nativeCallback = AccountBrowserNativeCallback(completion: completion, input: input)
            DispatchQueue(label: "BlabeeTests.AuthenticationServices.callback").async {
                nativeCallback.invoke()
            }
        }

        #expect(result.url == input.url)
        #expect(result.error == input.expectedError)
    }
}

private struct AccountBrowserCompletionResult: Sendable {
    let url: URL?
    let error: PetAccountAuthError?
}

private enum AccountBrowserCompletionCase: CaseIterable, Sendable {
    case success, cancelled, failed, missingResult

    var url: URL? {
        self == .success ? URL(string: "com.biadone.blabee://auth/callback?code=test-code") : nil
    }

    var nativeError: (any Error)? {
        switch self {
        case .success, .missingResult:
            nil
        case .cancelled:
            NSError(
                domain: ASWebAuthenticationSessionError.errorDomain,
                code: ASWebAuthenticationSessionError.canceledLogin.rawValue
            )
        case .failed:
            NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)
        }
    }

    var expectedError: PetAccountAuthError? {
        switch self {
        case .success, .missingResult: nil
        case .cancelled: .cancelled
        case .failed: .serviceUnavailable
        }
    }
}

// Match the SDK's non-Sendable completion type and arbitrary callback queue.
// This immutable test holder only transports a closure returned as @Sendable.
private final class AccountBrowserNativeCallback: @unchecked Sendable {
    private let completion: ASWebAuthenticationSession.CompletionHandler
    private let input: AccountBrowserCompletionCase

    init(
        completion: @escaping @Sendable (URL?, (any Error)?) -> Void,
        input: AccountBrowserCompletionCase
    ) {
        self.completion = completion
        self.input = input
    }

    func invoke() {
        dispatchPrecondition(condition: .notOnQueue(.main))
        completion(input.url, input.nativeError)
    }
}
