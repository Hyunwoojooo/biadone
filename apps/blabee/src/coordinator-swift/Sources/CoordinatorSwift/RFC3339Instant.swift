import Foundation

/// An RFC 3339 timestamp normalized without losing sub-second precision.
///
/// `Date` cannot represent every nanosecond exactly. This value keeps whole
/// seconds and nanoseconds separate so coordinator expiry comparisons preserve
/// the v1 contract's full precision.
public struct RFC3339Instant: Sendable, Hashable, Comparable, CustomStringConvertible {
    public let rawValue: String
    public let secondsSinceUnixEpoch: Int64
    public let nanosecond: Int

    public init(_ value: String, code: String = "timestamp_invalid") throws {
        let bytes = Array(value.utf8)

        func fail(_ message: String) -> CoordinatorError {
            CoordinatorError(code, message)
        }

        func decimal(_ start: Int, _ count: Int) throws -> Int {
            guard start >= 0, count > 0, start + count <= bytes.count else {
                throw fail("invalid RFC3339 timestamp: \(value)")
            }
            var result = 0
            for byte in bytes[start..<(start + count)] {
                guard (0x30...0x39).contains(byte) else {
                    throw fail("invalid RFC3339 timestamp: \(value)")
                }
                result = result * 10 + Int(byte - 0x30)
            }
            return result
        }

        guard bytes.count >= 20,
              bytes[4] == 0x2D,
              bytes[7] == 0x2D,
              bytes[10] == 0x54,
              bytes[13] == 0x3A,
              bytes[16] == 0x3A
        else {
            throw fail("invalid RFC3339 timestamp: \(value)")
        }

        let year = try decimal(0, 4)
        let month = try decimal(5, 2)
        let day = try decimal(8, 2)
        let hour = try decimal(11, 2)
        let minute = try decimal(14, 2)
        let second = try decimal(17, 2)

        guard (1...12).contains(month) else {
            throw fail("invalid month in timestamp: \(value)")
        }
        guard day >= 1, day <= Self.daysInMonth(year: year, month: month) else {
            throw fail("invalid calendar date in timestamp: \(value)")
        }
        guard hour <= 23, minute <= 59, second <= 59 else {
            throw fail("invalid time in timestamp: \(value)")
        }

        var cursor = 19
        var parsedNanosecond = 0
        if cursor < bytes.count, bytes[cursor] == 0x2E {
            cursor += 1
            let fractionStart = cursor
            while cursor < bytes.count, (0x30...0x39).contains(bytes[cursor]) {
                cursor += 1
            }
            let digitCount = cursor - fractionStart
            guard (1...9).contains(digitCount) else {
                throw fail("invalid RFC3339 timestamp: \(value)")
            }
            parsedNanosecond = try decimal(fractionStart, digitCount)
            for _ in digitCount..<9 { parsedNanosecond *= 10 }
        }

        var offsetSeconds = 0
        if cursor < bytes.count, bytes[cursor] == 0x5A {
            cursor += 1
        } else {
            guard cursor + 6 == bytes.count,
                  bytes[cursor] == 0x2B || bytes[cursor] == 0x2D,
                  bytes[cursor + 3] == 0x3A
            else {
                throw fail("invalid RFC3339 timestamp: \(value)")
            }
            let sign = bytes[cursor] == 0x2B ? 1 : -1
            let offsetHour = try decimal(cursor + 1, 2)
            let offsetMinute = try decimal(cursor + 4, 2)
            guard offsetHour <= 23, offsetMinute <= 59 else {
                throw fail("invalid timezone offset in timestamp: \(value)")
            }
            offsetSeconds = sign * (offsetHour * 3_600 + offsetMinute * 60)
            cursor += 6
        }

        guard cursor == bytes.count else {
            throw fail("invalid RFC3339 timestamp: \(value)")
        }

        let localSeconds = Self.daysFromCivil(
            year: Int64(year),
            month: Int64(month),
            day: Int64(day)
        ) * 86_400
            + Int64(hour * 3_600 + minute * 60 + second)

        self.rawValue = value
        self.secondsSinceUnixEpoch = localSeconds - Int64(offsetSeconds)
        self.nanosecond = parsedNanosecond
    }

    public static func parse(
        _ value: String,
        code: String = "timestamp_invalid"
    ) throws -> RFC3339Instant {
        try RFC3339Instant(value, code: code)
    }

    public static func == (left: RFC3339Instant, right: RFC3339Instant) -> Bool {
        left.secondsSinceUnixEpoch == right.secondsSinceUnixEpoch
            && left.nanosecond == right.nanosecond
    }

    public static func < (left: RFC3339Instant, right: RFC3339Instant) -> Bool {
        if left.secondsSinceUnixEpoch != right.secondsSinceUnixEpoch {
            return left.secondsSinceUnixEpoch < right.secondsSinceUnixEpoch
        }
        return left.nanosecond < right.nanosecond
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(secondsSinceUnixEpoch)
        hasher.combine(nanosecond)
    }

    public var description: String { rawValue }

    /// Returns the exact non-negative distance to `other` in nanoseconds.
    /// Coordinator deadlines are intentionally bounded to `UInt64`; an
    /// inverted or unrepresentable interval is rejected rather than rounded.
    public func nanoseconds(until other: RFC3339Instant) -> UInt64? {
        guard other >= self else { return nil }
        let (secondDelta, secondOverflow) = other.secondsSinceUnixEpoch
            .subtractingReportingOverflow(secondsSinceUnixEpoch)
        guard !secondOverflow, secondDelta >= 0 else { return nil }

        let (wholeNanoseconds, multiplyOverflow) = UInt64(secondDelta)
            .multipliedReportingOverflow(by: 1_000_000_000)
        guard !multiplyOverflow else { return nil }

        let fractionalDelta = other.nanosecond - nanosecond
        if fractionalDelta >= 0 {
            let (result, overflow) = wholeNanoseconds.addingReportingOverflow(
                UInt64(fractionalDelta)
            )
            return overflow ? nil : result
        }
        let magnitude = UInt64(-fractionalDelta)
        guard wholeNanoseconds >= magnitude else { return nil }
        return wholeNanoseconds - magnitude
    }

    /// Adds a bounded monotonic duration and renders a canonical UTC audit
    /// timestamp without passing through `Date`/`Double` precision.
    public func adding(nanoseconds delta: UInt64) throws -> RFC3339Instant {
        let secondsDelta = delta / 1_000_000_000
        let fractionalDelta = Int(delta % 1_000_000_000)
        guard secondsDelta <= UInt64(Int64.max) else {
            throw CoordinatorError("timestamp_overflow")
        }
        let (wholeSeconds, wholeOverflow) = secondsSinceUnixEpoch
            .addingReportingOverflow(Int64(secondsDelta))
        guard !wholeOverflow else { throw CoordinatorError("timestamp_overflow") }

        let fraction = nanosecond + fractionalDelta
        let carry = fraction / 1_000_000_000
        let normalizedNanosecond = fraction % 1_000_000_000
        let (normalizedSeconds, carryOverflow) = wholeSeconds
            .addingReportingOverflow(Int64(carry))
        guard !carryOverflow else { throw CoordinatorError("timestamp_overflow") }

        let text = try Self.utcText(
            secondsSinceUnixEpoch: normalizedSeconds,
            nanosecond: normalizedNanosecond
        )
        return try RFC3339Instant(text)
    }

    private static func isLeapYear(_ year: Int) -> Bool {
        year.isMultiple(of: 4) && (!year.isMultiple(of: 100) || year.isMultiple(of: 400))
    }

    private static func daysInMonth(year: Int, month: Int) -> Int {
        switch month {
        case 2: return isLeapYear(year) ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    // Howard Hinnant's civil-date algorithm, with floor division for year 0000.
    private static func daysFromCivil(year: Int64, month: Int64, day: Int64) -> Int64 {
        let adjustedYear = year - (month <= 2 ? 1 : 0)
        let era = floorDiv(adjustedYear, by: 400)
        let yearOfEra = adjustedYear - era * 400
        let adjustedMonth = month + (month > 2 ? -3 : 9)
        let dayOfYear = (153 * adjustedMonth + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365
            + yearOfEra / 4
            - yearOfEra / 100
            + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    private static func floorDiv(_ value: Int64, by divisor: Int64) -> Int64 {
        let quotient = value / divisor
        let remainder = value % divisor
        return remainder < 0 ? quotient - 1 : quotient
    }

    private static func utcText(
        secondsSinceUnixEpoch: Int64,
        nanosecond: Int
    ) throws -> String {
        var days = floorDiv(secondsSinceUnixEpoch, by: 86_400)
        var secondsOfDay = secondsSinceUnixEpoch - days * 86_400
        if secondsOfDay < 0 {
            days -= 1
            secondsOfDay += 86_400
        }

        // Inverse of `daysFromCivil`, also from Howard Hinnant's civil-date
        // algorithms. The v1 RFC3339 grammar is limited to four-digit years.
        let z = days + 719_468
        let era = floorDiv(z, by: 146_097)
        let dayOfEra = z - era * 146_097
        let yearOfEra = (dayOfEra - dayOfEra / 1_460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
        var year = yearOfEra + era * 400
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let monthPrime = (5 * dayOfYear + 2) / 153
        let day = dayOfYear - (153 * monthPrime + 2) / 5 + 1
        let month = monthPrime + (monthPrime < 10 ? 3 : -9)
        year += month <= 2 ? 1 : 0
        guard (0...9_999).contains(year) else {
            throw CoordinatorError("timestamp_overflow")
        }

        let hour = secondsOfDay / 3_600
        let minute = (secondsOfDay % 3_600) / 60
        let second = secondsOfDay % 60
        let base = String(
            format: "%04lld-%02lld-%02lldT%02lld:%02lld:%02lld",
            year, month, day, hour, minute, second
        )
        guard nanosecond != 0 else { return base + "Z" }
        var fraction = String(format: "%09d", nanosecond)
        while fraction.last == "0" { fraction.removeLast() }
        return base + "." + fraction + "Z"
    }
}
