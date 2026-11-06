import Foundation

enum IdentifierNormalization {
    static func isNFC(_ value: String) -> Bool {
        value.utf8.elementsEqual(value.precomposedStringWithCanonicalMapping.utf8)
    }

    static func isByteExact(_ left: String, _ right: String) -> Bool {
        left.utf8.elementsEqual(right.utf8)
    }
}
