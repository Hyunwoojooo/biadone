import CoordinatorSwift
import Foundation

enum CodexAppServerApprovalAdapterError: Error, Equatable, CustomStringConvertible {
    case invalid(String)
    case unsupportedMethod
    case unavailableDecision(String)

    var description: String {
        switch self {
        case .invalid(let field):
            return "invalid Codex App Server approval field: \(field)"
        case .unsupportedMethod:
            return "unsupported Codex App Server request method"
        case .unavailableDecision(let decision):
            return "Codex App Server approval decision is unavailable: \(decision)"
        }
    }
}

enum CodexAppServerRequestID: Sendable, Hashable {
    case string(String)
    case integer(Int64)

    fileprivate init(jsonValue: Any?) throws {
        if let value = jsonValue as? String {
            try codexAppServerRequireBoundedText(
                value,
                field: "id",
                maximumScalars: 512,
                allowLineBreaks: false
            )
            guard value.precomposedStringWithCanonicalMapping.utf8.elementsEqual(value.utf8) else {
                throw CodexAppServerApprovalAdapterError.invalid("id")
            }
            self = .string(value)
            return
        }
        if let value = ExactJSONInteger.int64(jsonValue) {
            self = .integer(value)
            return
        }
        throw CodexAppServerApprovalAdapterError.invalid("id")
    }

    fileprivate var jsonValue: Any {
        switch self {
        case .string(let value): value
        case .integer(let value): value
        }
    }
}

struct CodexAppServerApprovalCorrelation: Sendable, Hashable {
    let threadID: String
    let turnID: String
    let itemID: String
    let approvalID: String?
}

enum CodexAppServerAvailableApprovalDecision: String, Sendable, Hashable {
    case accept
    case acceptForSession
    case acceptWithExecpolicyAmendment
    case decline
    case cancel
}

struct CodexAppServerCommandApprovalRequest: Sendable, Equatable {
    let requestID: CodexAppServerRequestID
    let jsonRPCVersion: String?
    let threadID: String
    let turnID: String
    let itemID: String
    let approvalID: String?
    let startedAtMilliseconds: Int64
    let environmentID: String?
    let command: String
    let cwd: String
    let reason: String?
    let availableDecisions: [CodexAppServerAvailableApprovalDecision]
    let forwardingData: Data

    var correlation: CodexAppServerApprovalCorrelation {
        CodexAppServerApprovalCorrelation(
            threadID: threadID,
            turnID: turnID,
            itemID: itemID,
            approvalID: approvalID
        )
    }
}

enum CodexAppServerApprovalDecision: Sendable, Equatable {
    case allowOnce
    case deny
    case decideInCodex
}

enum CodexAppServerSyntheticApprovalDecision: String, Sendable, Equatable {
    case accept
    case decline
    case cancel
}

struct CodexAppServerApprovalResponse: Sendable, Equatable {
    let requestID: CodexAppServerRequestID
    let jsonRPCVersion: String?
    let decision: CodexAppServerSyntheticApprovalDecision

    func encodedData() throws -> Data {
        var object: [String: Any] = [
            "id": requestID.jsonValue,
            "result": ["decision": decision.rawValue],
        ]
        if let jsonRPCVersion {
            object["jsonrpc"] = jsonRPCVersion
        }
        return try StrictJSONTransport.data(forJSONObject: object)
    }
}

enum CodexAppServerApprovalOutcome: Sendable, Equatable {
    case respond(CodexAppServerApprovalResponse)
    case forwardToCodex(requestData: Data)
}

enum CodexAppServerApprovalAdapter {
    static let commandApprovalMethod = "item/commandExecution/requestApproval"

    private static let topLevelKeys: Set<String> = [
        "id", "jsonrpc", "method", "params", "trace",
    ]

    /// The first adapter slice deliberately accepts only the command context
    /// that Blabee can display without hiding extra permission grants or
    /// persistent policy amendments from the user.
    private static let supportedParameterKeys: Set<String> = [
        "additionalPermissions", "approvalId", "availableDecisions", "command",
        "commandActions", "cwd", "environmentId", "itemId", "kind",
        "networkApprovalContext", "proposedExecpolicyAmendment",
        "proposedNetworkPolicyAmendments", "reason", "startedAtMs", "threadId",
        "turnId",
    ]

    static func parse(_ data: Data) throws -> CodexAppServerCommandApprovalRequest {
        let object: [String: Any]
        do {
            object = try StrictJSONTransport.object(
                from: data,
                limits: StrictJSONLimits(maximumBytes: 256 * 1_024, maximumDepth: 24)
            )
        } catch {
            throw CodexAppServerApprovalAdapterError.invalid("json")
        }

        let keys = Set(object.keys)
        guard keys.isSubset(of: topLevelKeys),
              keys.contains("id"),
              keys.contains("method"),
              keys.contains("params")
        else {
            throw CodexAppServerApprovalAdapterError.invalid("request")
        }

        let jsonRPCVersion: String?
        if let rawVersion = object["jsonrpc"] {
            guard let version = rawVersion as? String, version == "2.0" else {
                throw CodexAppServerApprovalAdapterError.invalid("jsonrpc")
            }
            jsonRPCVersion = version
        } else {
            jsonRPCVersion = nil
        }

        try validateTrace(object["trace"])

        guard let method = object["method"] as? String else {
            throw CodexAppServerApprovalAdapterError.invalid("method")
        }
        guard method == commandApprovalMethod else {
            throw CodexAppServerApprovalAdapterError.unsupportedMethod
        }
        guard let parameters = object["params"] as? [String: Any] else {
            throw CodexAppServerApprovalAdapterError.invalid("params")
        }
        guard Set(parameters.keys).isSubset(of: supportedParameterKeys) else {
            throw CodexAppServerApprovalAdapterError.invalid("params.unsupported")
        }
        try validateCommandApprovalKind(parameters["kind"])
        try requireNull(parameters, key: "additionalPermissions")
        try requireNull(parameters, key: "networkApprovalContext")
        try validateCommandActions(parameters["commandActions"])
        try validateExecpolicyAmendment(
            parameters["proposedExecpolicyAmendment"],
            field: "params.proposedExecpolicyAmendment",
            allowEmpty: true,
            allowNull: true
        )
        try requireNullOrEmptyArray(parameters, key: "proposedNetworkPolicyAmendments")

        let requestID = try CodexAppServerRequestID(jsonValue: object["id"])
        let threadID = try requiredIdentifier(parameters, key: "threadId")
        let turnID = try requiredIdentifier(parameters, key: "turnId")
        let itemID = try requiredIdentifier(parameters, key: "itemId")
        let approvalID = try optionalIdentifier(parameters, key: "approvalId")
        guard parameters.keys.contains("environmentId") else {
            throw CodexAppServerApprovalAdapterError.invalid("params.environmentId")
        }
        let environmentID = try optionalIdentifier(parameters, key: "environmentId")
        guard let startedAtMilliseconds = ExactJSONInteger.int64(
            parameters["startedAtMs"],
            minimum: 0
        ) else {
            throw CodexAppServerApprovalAdapterError.invalid("params.startedAtMs")
        }
        let command = try requiredText(
            parameters,
            key: "command",
            maximumScalars: PetPermissionRequest.maximumCommandScalars,
            allowLineBreaks: false
        )
        let cwd = try requiredText(
            parameters,
            key: "cwd",
            maximumScalars: 4_096,
            allowLineBreaks: false
        )
        guard NSString(string: cwd).isAbsolutePath else {
            throw CodexAppServerApprovalAdapterError.invalid("params.cwd")
        }
        let reason = try optionalText(
            parameters,
            key: "reason",
            maximumScalars: 4_096,
            allowLineBreaks: true
        )
        let availableDecisions = try parseAvailableDecisions(parameters["availableDecisions"])

        return CodexAppServerCommandApprovalRequest(
            requestID: requestID,
            jsonRPCVersion: jsonRPCVersion,
            threadID: threadID,
            turnID: turnID,
            itemID: itemID,
            approvalID: approvalID,
            startedAtMilliseconds: startedAtMilliseconds,
            environmentID: environmentID,
            command: command,
            cwd: cwd,
            reason: reason,
            availableDecisions: availableDecisions,
            forwardingData: data
        )
    }

    static func resolve(
        _ decision: CodexAppServerApprovalDecision,
        for request: CodexAppServerCommandApprovalRequest
    ) throws -> CodexAppServerApprovalOutcome {
        switch decision {
        case .allowOnce:
            guard request.availableDecisions.contains(.accept) else {
                throw CodexAppServerApprovalAdapterError.unavailableDecision("accept")
            }
            return .respond(CodexAppServerApprovalResponse(
                requestID: request.requestID,
                jsonRPCVersion: request.jsonRPCVersion,
                decision: .accept
            ))
        case .deny:
            let decision: CodexAppServerSyntheticApprovalDecision
            if request.availableDecisions.contains(.decline) {
                decision = .decline
            } else if request.availableDecisions.contains(.cancel) {
                decision = .cancel
            } else {
                throw CodexAppServerApprovalAdapterError.unavailableDecision(
                    "decline_or_cancel"
                )
            }
            return .respond(CodexAppServerApprovalResponse(
                requestID: request.requestID,
                jsonRPCVersion: request.jsonRPCVersion,
                decision: decision
            ))
        case .decideInCodex:
            return .forwardToCodex(requestData: request.forwardingData)
        }
    }

    /// Codex 0.150.1 added `kind` to distinguish a new command approval from
    /// approval to write into an existing terminal. Older servers omit it and
    /// mean `command`; only that authority can be represented by this Pet card.
    private static func validateCommandApprovalKind(_ rawValue: Any?) throws {
        guard let rawValue else { return }
        guard let kind = rawValue as? String, kind == "command" else {
            throw CodexAppServerApprovalAdapterError.invalid("params.kind")
        }
    }

    private static func parseAvailableDecisions(
        _ rawValue: Any?
    ) throws -> [CodexAppServerAvailableApprovalDecision] {
        guard let values = rawValue as? [Any],
              !values.isEmpty,
              values.count <= 8
        else {
            throw CodexAppServerApprovalAdapterError.invalid("params.availableDecisions")
        }

        var parsed: [CodexAppServerAvailableApprovalDecision] = []
        var seen = Set<CodexAppServerAvailableApprovalDecision>()
        for value in values {
            let decision: CodexAppServerAvailableApprovalDecision
            if let rawDecision = value as? String,
               let parsedDecision = CodexAppServerAvailableApprovalDecision(
                rawValue: rawDecision
               )
            {
                decision = parsedDecision
            } else if let object = value as? [String: Any],
                      Set(object.keys) == ["acceptWithExecpolicyAmendment"],
                      let payload = object[
                        "acceptWithExecpolicyAmendment"
                      ] as? [String: Any],
                      Set(payload.keys) == ["execpolicy_amendment"]
            {
                try validateExecpolicyAmendment(
                    payload["execpolicy_amendment"],
                    field: "params.availableDecisions.execpolicy_amendment",
                    allowEmpty: false,
                    allowNull: false
                )
                decision = .acceptWithExecpolicyAmendment
            } else {
                throw CodexAppServerApprovalAdapterError.invalid(
                    "params.availableDecisions"
                )
            }
            guard seen.insert(decision).inserted else {
                throw CodexAppServerApprovalAdapterError.invalid(
                    "params.availableDecisions"
                )
            }
            parsed.append(decision)
        }
        return parsed
    }

    private static func validateExecpolicyAmendment(
        _ rawValue: Any?,
        field: String,
        allowEmpty: Bool,
        allowNull: Bool
    ) throws {
        if rawValue == nil || rawValue is NSNull {
            guard allowNull else {
                throw CodexAppServerApprovalAdapterError.invalid(field)
            }
            return
        }
        guard let values = rawValue as? [Any],
              values.count <= 64,
              allowEmpty || !values.isEmpty
        else {
            throw CodexAppServerApprovalAdapterError.invalid(field)
        }
        for value in values {
            guard let token = value as? String else {
                throw CodexAppServerApprovalAdapterError.invalid(field)
            }
            try codexAppServerRequireBoundedText(
                token,
                field: field,
                maximumScalars: 4_096,
                allowLineBreaks: false
            )
        }
    }

    private static func requiredText(
        _ object: [String: Any],
        key: String,
        maximumScalars: Int,
        allowLineBreaks: Bool = false
    ) throws -> String {
        guard let value = object[key] as? String else {
            throw CodexAppServerApprovalAdapterError.invalid("params.\(key)")
        }
        try codexAppServerRequireBoundedText(
            value,
            field: "params.\(key)",
            maximumScalars: maximumScalars,
            allowLineBreaks: allowLineBreaks
        )
        return value
    }

    private static func requiredIdentifier(
        _ object: [String: Any],
        key: String
    ) throws -> String {
        let value = try requiredText(object, key: key, maximumScalars: 512)
        guard value.precomposedStringWithCanonicalMapping.utf8.elementsEqual(value.utf8) else {
            throw CodexAppServerApprovalAdapterError.invalid("params.\(key)")
        }
        return value
    }

    private static func optionalIdentifier(
        _ object: [String: Any],
        key: String
    ) throws -> String? {
        guard let value = try optionalText(object, key: key, maximumScalars: 512) else {
            return nil
        }
        guard value.precomposedStringWithCanonicalMapping.utf8.elementsEqual(value.utf8) else {
            throw CodexAppServerApprovalAdapterError.invalid("params.\(key)")
        }
        return value
    }

    private static func optionalText(
        _ object: [String: Any],
        key: String,
        maximumScalars: Int,
        allowLineBreaks: Bool = false
    ) throws -> String? {
        guard let rawValue = object[key] else { return nil }
        if rawValue is NSNull { return nil }
        guard let value = rawValue as? String else {
            throw CodexAppServerApprovalAdapterError.invalid("params.\(key)")
        }
        try codexAppServerRequireBoundedText(
            value,
            field: "params.\(key)",
            maximumScalars: maximumScalars,
            allowLineBreaks: allowLineBreaks
        )
        return value
    }

    private static func validateTrace(_ rawValue: Any?) throws {
        guard let rawValue else { return }
        if rawValue is NSNull { return }
        guard let trace = rawValue as? [String: Any],
              Set(trace.keys).isSubset(of: ["traceparent", "tracestate"])
        else {
            throw CodexAppServerApprovalAdapterError.invalid("trace")
        }
        for key in ["traceparent", "tracestate"] where trace[key] != nil {
            _ = try optionalText(trace, key: key, maximumScalars: 512)
        }
    }

    private static func requireNull(_ object: [String: Any], key: String) throws {
        guard let value = object[key] else { return }
        guard value is NSNull else {
            throw CodexAppServerApprovalAdapterError.invalid("params.\(key)")
        }
    }

    private static func requireNullOrEmptyArray(
        _ object: [String: Any],
        key: String
    ) throws {
        guard let value = object[key] else { return }
        if value is NSNull { return }
        guard let values = value as? [Any], values.isEmpty else {
            throw CodexAppServerApprovalAdapterError.invalid("params.\(key)")
        }
    }

    private static func validateCommandActions(_ rawValue: Any?) throws {
        guard let rawValue else { return }
        if rawValue is NSNull { return }
        guard let actions = rawValue as? [Any], actions.count <= 32 else {
            throw CodexAppServerApprovalAdapterError.invalid("params.commandActions")
        }

        for rawAction in actions {
            guard let action = rawAction as? [String: Any],
                  let type = action["type"] as? String
            else {
                throw CodexAppServerApprovalAdapterError.invalid("params.commandActions")
            }
            switch type {
            case "read":
                guard Set(action.keys) == ["type", "command", "name", "path"] else {
                    throw CodexAppServerApprovalAdapterError.invalid("params.commandActions")
                }
                _ = try requiredText(action, key: "command", maximumScalars: 4_096)
                _ = try requiredText(action, key: "name", maximumScalars: 512)
                _ = try requiredText(action, key: "path", maximumScalars: 4_096)
            case "listFiles":
                guard Set(action.keys) == ["type", "command", "path"] else {
                    throw CodexAppServerApprovalAdapterError.invalid("params.commandActions")
                }
                _ = try requiredText(action, key: "command", maximumScalars: 4_096)
                _ = try optionalText(action, key: "path", maximumScalars: 4_096)
            case "search":
                guard Set(action.keys) == ["type", "command", "path", "query"] else {
                    throw CodexAppServerApprovalAdapterError.invalid("params.commandActions")
                }
                _ = try requiredText(action, key: "command", maximumScalars: 4_096)
                _ = try optionalText(action, key: "path", maximumScalars: 4_096)
                _ = try optionalText(action, key: "query", maximumScalars: 4_096)
            case "unknown":
                guard Set(action.keys) == ["type", "command"] else {
                    throw CodexAppServerApprovalAdapterError.invalid("params.commandActions")
                }
                _ = try requiredText(action, key: "command", maximumScalars: 4_096)
            default:
                throw CodexAppServerApprovalAdapterError.invalid("params.commandActions")
            }
        }
    }
}

private func codexAppServerRequireBoundedText(
    _ value: String,
    field: String,
    maximumScalars: Int,
    allowLineBreaks: Bool
) throws {
    guard !value.isEmpty,
          value.unicodeScalars.count <= maximumScalars,
          value.rangeOfCharacter(from: .illegalCharacters) == nil
    else {
        throw CodexAppServerApprovalAdapterError.invalid(field)
    }

    let forbiddenSpoofingScalars: Set<UInt32> = [
        0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
        0x2066, 0x2067, 0x2068, 0x2069,
    ]
    for scalar in value.unicodeScalars {
        let category = scalar.properties.generalCategory
        let isPermittedCommandWhitespace = allowLineBreaks
            && [0x09, 0x0A, 0x0D].contains(scalar.value)
        let isUnsafeDisplayScalar = scalar.properties.isDefaultIgnorableCodePoint
            || category == .control
            || category == .format
            || category == .lineSeparator
            || category == .paragraphSeparator
        if forbiddenSpoofingScalars.contains(scalar.value)
            || (isUnsafeDisplayScalar && !isPermittedCommandWhitespace)
        {
            throw CodexAppServerApprovalAdapterError.invalid(field)
        }
    }
}
