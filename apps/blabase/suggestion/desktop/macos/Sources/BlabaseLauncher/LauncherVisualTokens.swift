import SwiftUI

enum LauncherVisualTokens {
    static let panelWidth: CGFloat = 780
    static let panelHeight: CGFloat = 462
    static let panelCornerRadius: CGFloat = 18
    static let contentHorizontalPadding: CGFloat = 22
    static let contentTopPadding: CGFloat = 22
    static let contentBottomPadding: CGFloat = 18
    static let sectionSpacing: CGFloat = 14
    static let cardCornerRadius: CGFloat = 12

    static func surfaceFloating(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x1A1D24) : color(0xFFFEFB)
    }

    static func surfaceSubtle(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x232731) : color(0xECEBE6)
    }

    static func surfaceSelected(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x1A2B49) : color(0xEAF1FF)
    }

    static func borderDefault(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x363C48) : color(0xD9DCE3)
    }

    static func borderFocus(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x82A2FF) : color(0x5C7CFA)
    }

    static func textPrimary(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0xF5F7FA) : color(0x171A20)
    }

    static func textSecondary(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0xB2BBCA) : color(0x5C6577)
    }

    static func textTertiary(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x9AA4B5) : color(0x576070)
    }

    static func actionPrimary(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x6F8EFF) : color(0x3457D5)
    }

    static func statusSignal(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0xFF8D79) : color(0xCA4B3C)
    }

    static func statusSuccess(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x59C99A) : color(0x186743)
    }

    static func statusWarning(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0xF0B86A) : color(0xA45B12)
    }

    private static func color(_ rgb: UInt32) -> Color {
        Color(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}
