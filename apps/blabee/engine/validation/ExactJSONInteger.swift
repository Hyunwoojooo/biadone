import CoreFoundation
import Foundation

/// Converts Foundation JSON numbers without routing an integer boundary through
/// `Double`. In particular, `Int64.max + 1` must never wrap to `Int64.min`.
public enum ExactJSONInteger {
    public static func int64(_ value: Any?, minimum: Int64 = Int64.min) -> Int64? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              let decimal = Decimal(
                  string: number.stringValue,
                  locale: Locale(identifier: "en_US_POSIX")
              )
        else { return nil }

        var source = decimal
        var integral = Decimal()
        NSDecimalRound(&integral, &source, 0, .plain)
        guard integral == decimal,
              decimal >= Decimal(minimum),
              decimal <= Decimal(Int64.max)
        else { return nil }

        return NSDecimalNumber(decimal: decimal).int64Value
    }
}
