import Foundation

public struct CoordinatorError: Error, CustomStringConvertible, Sendable, Equatable {
    public let code: String
    public let message: String

    public init(_ code: String, _ message: String? = nil) {
        self.code = code
        self.message = message ?? code
    }

    public var description: String { "\(code): \(message)" }
}

@inline(__always)
func require(
    _ condition: @autoclosure () -> Bool,
    _ code: String,
    _ message: String? = nil
) throws {
    guard condition() else { throw CoordinatorError(code, message) }
}

extension Error {
    public var coordinatorError: CoordinatorError {
        if let error = self as? CoordinatorError { return error }
        return CoordinatorError("internal_error", String(describing: self))
    }
}
