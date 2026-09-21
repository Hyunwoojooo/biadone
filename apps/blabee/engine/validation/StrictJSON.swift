import Foundation

public struct StrictJSONLimits: Sendable, Equatable {
    public var maximumBytes: Int
    public var maximumDepth: Int

    public init(maximumBytes: Int = 4 * 1024 * 1024, maximumDepth: Int = 64) {
        self.maximumBytes = maximumBytes
        self.maximumDepth = maximumDepth
    }

    public static let v1 = StrictJSONLimits()
}

public struct StrictJSONRequestCorrelationRecovery: Sendable, Equatable {
    public let requestID: String?
    public let ignoredIntegerRangeViolation: Bool

    init(requestID: String?, ignoredIntegerRangeViolation: Bool) {
        self.requestID = requestID
        self.ignoredIntegerRangeViolation = ignoredIntegerRangeViolation
    }
}

struct StrictJSONObject {
    let value: [String: Any]
    let canonicalData: Data
}

enum StrictJSON {
    static func object(from data: Data, limits: StrictJSONLimits) throws -> StrictJSONObject {
        do {
            try require(!data.isEmpty, "contract_validation_failed", "JSON input is empty")
            try require(
                data.count <= limits.maximumBytes,
                "contract_validation_failed",
                "JSON input exceeds the configured byte limit"
            )
            try require(
                String(data: data, encoding: .utf8) != nil,
                "contract_validation_failed",
                "JSON input is not valid UTF-8"
            )
            var scanner = JSONStructureScanner(bytes: Array(data), maximumDepth: limits.maximumDepth)
            _ = try scanner.parseDocument()
            let decoded = try JSONSerialization.jsonObject(with: data, options: [])
            guard let object = decoded as? [String: Any] else {
                throw CoordinatorError("contract_validation_failed", "top-level JSON value must be an object")
            }
            let canonical = try JSONSerialization.data(
                withJSONObject: object,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
            return StrictJSONObject(value: object, canonicalData: canonical)
        } catch let error as CoordinatorError {
            throw error
        } catch {
            throw CoordinatorError("contract_validation_failed", "invalid JSON")
        }
    }

    static func canonicalData(for object: Any) throws -> Data {
        guard JSONSerialization.isValidJSONObject(object) else {
            throw CoordinatorError("contract_validation_failed", "value is not a JSON object")
        }
        return try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
    }

    static func rejectRawTokenKeys(_ value: Any) throws {
        if let object = value as? [String: Any] {
            for (key, child) in object {
                if key == "continuation_token" || key == "correlation_token" {
                    throw CoordinatorError("raw_continuation_token_forbidden")
                }
                try rejectRawTokenKeys(child)
            }
        } else if let array = value as? [Any] {
            for child in array { try rejectRawTokenKeys(child) }
        }
    }
}

public enum StrictJSONTransport {
    public static func object(
        from data: Data,
        limits: StrictJSONLimits = StrictJSONLimits(maximumBytes: 16 * 1024 * 1024, maximumDepth: 72)
    ) throws -> [String: Any] {
        try StrictJSON.object(from: data, limits: limits).value
    }

    public static func data(forJSONObject object: Any) throws -> Data {
        try StrictJSON.canonicalData(for: object)
    }

    /// Recovers only the top-level request correlation string after strict
    /// transport decoding fails. The returned value must never be used as a
    /// decoded command: this pass keeps the byte, UTF-8, structure, duplicate
    /// key, and depth checks, while tolerating only integer range violations.
    public static func recoverRequestCorrelation(
        from data: Data,
        limits: StrictJSONLimits = StrictJSONLimits(
            maximumBytes: 16 * 1024 * 1024,
            maximumDepth: 72
        )
    ) throws -> StrictJSONRequestCorrelationRecovery {
        do {
            try require(!data.isEmpty, "contract_validation_failed", "JSON input is empty")
            try require(
                data.count <= limits.maximumBytes,
                "contract_validation_failed",
                "JSON input exceeds the configured byte limit"
            )
            try require(
                String(data: data, encoding: .utf8) != nil,
                "contract_validation_failed",
                "JSON input is not valid UTF-8"
            )
            var scanner = JSONStructureScanner(
                bytes: Array(data),
                maximumDepth: limits.maximumDepth,
                integerRangePolicy: .recordViolation
            )
            let requestID = try scanner.parseDocument(
                capturingTopLevelStringFor: "request_id"
            )
            return StrictJSONRequestCorrelationRecovery(
                requestID: requestID,
                ignoredIntegerRangeViolation: scanner.ignoredIntegerRangeViolation
            )
        } catch let error as CoordinatorError {
            throw error
        } catch {
            throw CoordinatorError("contract_validation_failed", "invalid JSON")
        }
    }
}

private enum JSONIntegerRangePolicy {
    case reject
    case recordViolation
}

private struct JSONStructureScanner {
    let bytes: [UInt8]
    let maximumDepth: Int
    var integerRangePolicy: JSONIntegerRangePolicy = .reject
    var index = 0
    var ignoredIntegerRangeViolation = false

    mutating func parseDocument(
        capturingTopLevelStringFor key: String? = nil
    ) throws -> String? {
        skipWhitespace()
        let captured: String?
        if key != nil, peek() == 0x7B {
            captured = try parseObject(depth: 1, capturingTopLevelStringFor: key)
        } else {
            try parseValue(depth: 0)
            captured = nil
        }
        skipWhitespace()
        try require(index == bytes.count, "contract_validation_failed", "trailing JSON content")
        return captured
    }

    mutating func parseValue(depth: Int) throws {
        try require(index < bytes.count, "contract_validation_failed", "unexpected end of JSON")
        switch bytes[index] {
        case 0x7B: _ = try parseObject(depth: depth + 1) // {
        case 0x5B: try parseArray(depth: depth + 1) // [
        case 0x22: _ = try parseString(decode: false)
        case 0x74: try consumeLiteral("true")
        case 0x66: try consumeLiteral("false")
        case 0x6E: try consumeLiteral("null")
        case 0x2D, 0x30...0x39: try parseNumber()
        default: throw CoordinatorError("contract_validation_failed", "invalid JSON token")
        }
    }

    mutating func parseObject(
        depth: Int,
        capturingTopLevelStringFor captureKey: String? = nil
    ) throws -> String? {
        try require(depth <= maximumDepth, "contract_validation_failed", "JSON nesting is too deep")
        index += 1
        skipWhitespace()
        if consume(0x7D) { return nil }
        var keys = Set<String>()
        var captured: String?
        while true {
            try require(peek() == 0x22, "contract_validation_failed", "object key must be a string")
            let key = try parseString(decode: true)!
            try require(keys.insert(key).inserted, "contract_validation_failed", "duplicate JSON object key")
            skipWhitespace()
            try require(consume(0x3A), "contract_validation_failed", "missing colon after object key")
            skipWhitespace()
            if key == captureKey, peek() == 0x22 {
                captured = try parseString(decode: true)
            } else {
                try parseValue(depth: depth)
            }
            skipWhitespace()
            if consume(0x7D) { return captured }
            try require(consume(0x2C), "contract_validation_failed", "missing comma in object")
            skipWhitespace()
        }
    }

    mutating func parseArray(depth: Int) throws {
        try require(depth <= maximumDepth, "contract_validation_failed", "JSON nesting is too deep")
        index += 1
        skipWhitespace()
        if consume(0x5D) { return }
        while true {
            try parseValue(depth: depth)
            skipWhitespace()
            if consume(0x5D) { return }
            try require(consume(0x2C), "contract_validation_failed", "missing comma in array")
            skipWhitespace()
        }
    }

    mutating func parseString(decode: Bool) throws -> String? {
        let start = index
        index += 1
        while index < bytes.count {
            let byte = bytes[index]
            if byte == 0x22 {
                index += 1
                guard decode else { return nil }
                let fragment = Data(bytes[start..<index])
                guard let decoded = try JSONSerialization.jsonObject(
                    with: fragment,
                    options: [.fragmentsAllowed]
                ) as? String else {
                    throw CoordinatorError("contract_validation_failed", "invalid JSON object key")
                }
                return decoded
            }
            if byte < 0x20 {
                throw CoordinatorError("contract_validation_failed", "unescaped control character")
            }
            if byte == 0x5C {
                index += 1
                try require(index < bytes.count, "contract_validation_failed", "unterminated escape")
                switch bytes[index] {
                case 0x22, 0x5C, 0x2F, 0x62, 0x66, 0x6E, 0x72, 0x74:
                    index += 1
                case 0x75:
                    let first = try parseUnicodeEscape()
                    if (0xD800...0xDBFF).contains(first) {
                        try require(
                            index + 1 < bytes.count && bytes[index] == 0x5C && bytes[index + 1] == 0x75,
                            "contract_validation_failed",
                            "unpaired Unicode surrogate"
                        )
                        index += 1
                        let second = try parseUnicodeEscape()
                        try require(
                            (0xDC00...0xDFFF).contains(second),
                            "contract_validation_failed",
                            "unpaired Unicode surrogate"
                        )
                    } else if (0xDC00...0xDFFF).contains(first) {
                        throw CoordinatorError("contract_validation_failed", "unpaired Unicode surrogate")
                    }
                default:
                    throw CoordinatorError("contract_validation_failed", "invalid JSON escape")
                }
            } else {
                index += 1
            }
        }
        throw CoordinatorError("contract_validation_failed", "unterminated JSON string")
    }

    mutating func parseUnicodeEscape() throws -> UInt16 {
        try require(bytes[index] == 0x75, "contract_validation_failed")
        index += 1
        try require(index + 4 <= bytes.count, "contract_validation_failed", "short Unicode escape")
        var value: UInt16 = 0
        for _ in 0..<4 {
            guard let digit = hexadecimal(bytes[index]) else {
                throw CoordinatorError("contract_validation_failed", "invalid Unicode escape")
            }
            value = value * 16 + UInt16(digit)
            index += 1
        }
        return value
    }

    mutating func parseNumber() throws {
        let start = index
        if consume(0x2D) {
            try require(index < bytes.count, "contract_validation_failed", "invalid number")
        }
        if consume(0x30) {
            if let byte = peek(), (0x30...0x39).contains(byte) {
                throw CoordinatorError("contract_validation_failed", "leading zero in number")
            }
        } else {
            try require(consumeRange(0x31...0x39), "contract_validation_failed", "invalid number")
            while consumeRange(0x30...0x39) {}
        }
        if consume(0x2E) {
            try require(consumeRange(0x30...0x39), "contract_validation_failed", "invalid fraction")
            while consumeRange(0x30...0x39) {}
        }
        if consume(0x65) || consume(0x45) {
            _ = consume(0x2B) || consume(0x2D)
            try require(consumeRange(0x30...0x39), "contract_validation_failed", "invalid exponent")
            while consumeRange(0x30...0x39) {}
        }
        try validateExactInt64Lexeme(start: start, end: index)
    }

    /// Every numeric field in the pinned v1 contracts is an integer. Validate
    /// the original wire lexeme before Foundation can round it through Double.
    /// Mathematically integral spellings such as `1.0` and `1e0` remain valid.
    mutating func validateExactInt64Lexeme(start: Int, end: Int) throws {
        let usesFloatingNotation = bytes[start..<end].contains(0x2E)
            || bytes[start..<end].contains(0x65)
            || bytes[start..<end].contains(0x45)
        var cursor = start
        let negative = bytes[cursor] == 0x2D
        if negative { cursor += 1 }

        var coefficient: [UInt8] = []
        var fractionalDigits = 0
        while cursor < end, (0x30...0x39).contains(bytes[cursor]) {
            coefficient.append(bytes[cursor])
            cursor += 1
        }
        if cursor < end, bytes[cursor] == 0x2E {
            cursor += 1
            let fractionStart = cursor
            while cursor < end, (0x30...0x39).contains(bytes[cursor]) {
                coefficient.append(bytes[cursor])
                cursor += 1
            }
            fractionalDigits = cursor - fractionStart
        }

        var exponent = 0
        if cursor < end, bytes[cursor] == 0x65 || bytes[cursor] == 0x45 {
            cursor += 1
            var exponentNegative = false
            if cursor < end, bytes[cursor] == 0x2B || bytes[cursor] == 0x2D {
                exponentNegative = bytes[cursor] == 0x2D
                cursor += 1
            }
            let cap = bytes.count + 32
            while cursor < end {
                let digit = Int(bytes[cursor] - 0x30)
                if exponent <= cap {
                    exponent = min(cap, exponent * 10 + digit)
                }
                cursor += 1
            }
            if exponentNegative { exponent = -exponent }
        }
        try require(cursor == end, "contract_validation_failed", "invalid number")

        guard let firstSignificantIndex = coefficient.firstIndex(where: { $0 != 0x30 }) else {
            return
        }
        let significantCoefficient = coefficient[firstSignificantIndex...]

        let scale = exponent - fractionalDigits
        var integerDigits: [UInt8]
        if scale < 0 {
            let removedCount = -scale
            guard removedCount <= significantCoefficient.count else {
                throw CoordinatorError("contract_validation_failed", "number must be an exact integer")
            }
            let removed = significantCoefficient.suffix(removedCount)
            guard removed.allSatisfy({ $0 == 0x30 }) else {
                throw CoordinatorError("contract_validation_failed", "number must be an exact integer")
            }
            let retained = significantCoefficient.dropLast(removedCount)
            guard retained.count <= 19 else {
                try handleIntegerRangeViolation("integer is outside Int64")
                return
            }
            integerDigits = Array(retained)
        } else {
            guard significantCoefficient.count + scale <= 19 else {
                try handleIntegerRangeViolation("integer is outside Int64")
                return
            }
            integerDigits = Array(significantCoefficient) + Array(repeating: 0x30, count: scale)
        }
        if integerDigits.isEmpty { return }

        let limit = Array((negative ? "9223372036854775808" : "9223372036854775807").utf8)
        guard integerDigits.count < limit.count
                || (integerDigits.count == limit.count
                    && integerDigits.lexicographicallyPrecedes(limit))
                || integerDigits == limit
        else {
            try handleIntegerRangeViolation("integer is outside Int64")
            return
        }
        if usesFloatingNotation {
            // JSONSerialization routes decimal/exponent spellings through
            // binary floating point. Keep those spellings inside the range
            // where every integer is represented exactly; plain integer
            // lexemes retain the complete Int64 range above.
            let safeDoubleInteger = Array("9007199254740992".utf8)
            guard integerDigits.count < safeDoubleInteger.count
                    || (integerDigits.count == safeDoubleInteger.count
                        && (integerDigits.lexicographicallyPrecedes(safeDoubleInteger)
                            || integerDigits == safeDoubleInteger))
            else {
                try handleIntegerRangeViolation(
                    "decimal or exponent integer exceeds the exact transport range"
                )
                return
            }
        }
    }

    mutating func handleIntegerRangeViolation(_ message: String) throws {
        switch integerRangePolicy {
        case .reject:
            throw CoordinatorError("contract_validation_failed", message)
        case .recordViolation:
            ignoredIntegerRangeViolation = true
        }
    }

    mutating func consumeLiteral(_ literal: StaticString) throws {
        let expected = Array(String(describing: literal).utf8)
        try require(
            index + expected.count <= bytes.count
                && Array(bytes[index..<(index + expected.count)]) == expected,
            "contract_validation_failed",
            "invalid JSON literal"
        )
        index += expected.count
    }

    mutating func skipWhitespace() {
        while let byte = peek(), byte == 0x20 || byte == 0x0A || byte == 0x0D || byte == 0x09 {
            index += 1
        }
    }

    func peek() -> UInt8? { index < bytes.count ? bytes[index] : nil }

    mutating func consume(_ expected: UInt8) -> Bool {
        guard peek() == expected else { return false }
        index += 1
        return true
    }

    mutating func consumeRange(_ range: ClosedRange<UInt8>) -> Bool {
        guard let byte = peek(), range.contains(byte) else { return false }
        index += 1
        return true
    }

    func hexadecimal(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 0x30...0x39: byte - 0x30
        case 0x41...0x46: byte - 0x41 + 10
        case 0x61...0x66: byte - 0x61 + 10
        default: nil
        }
    }
}
