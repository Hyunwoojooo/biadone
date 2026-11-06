import AppKit
import CoreText
import SwiftUI

/// App-owned typography. Fonts are registered only for this process; launching
/// Blabee never installs a font into the user's macOS font library.
enum PetTypography {
    static let resourcePath = "Fonts/Pretendard"
    static let fileName = "PretendardVariable.ttf"
    static let familyName = "Pretendard Variable"
    private static let registration = PetFontRegistration()

    enum RegistrationError: Error {
        case missingFont, invalidFont, registrationFailed
    }

    /// Explicit resource seam for offscreen tests. Production always discovers
    /// its sealed resource in Bundle.main, never in Downloads or the checkout.
    static func registerFonts(in directory: URL) throws {
        try registration.register(directory.appendingPathComponent(fileName))
    }

    static func fontName(weight: Font.Weight) -> String {
        let suffix: String
        switch weight {
        case .ultraLight: suffix = "Thin"
        case .thin: suffix = "ExtraLight"
        case .light: suffix = "Light"
        case .medium: suffix = "Medium"
        case .semibold: suffix = "SemiBold"
        case .bold: suffix = "Bold"
        case .heavy: suffix = "ExtraBold"
        case .black: suffix = "Black"
        default: suffix = "Regular"
        }
        return "PretendardVariable-" + suffix
    }

    static func nativeTextStyle(_ style: Font.TextStyle) -> NSFont.TextStyle {
        switch style {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }

    static func font(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> Font {
        let resolvedWeight = weight ?? (style == .headline ? .bold : .regular)
        guard registration.isAvailable else { return .system(style).weight(resolvedWeight) }
        let size = NSFont.preferredFont(forTextStyle: nativeTextStyle(style)).pointSize
        return .custom(fontName(weight: resolvedWeight), size: size, relativeTo: style)
    }

    static func font(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        guard registration.isAvailable else { return .system(size: size, weight: weight) }
        return .custom(fontName(weight: weight), fixedSize: size)
    }
}

extension Font {
    static func blabee(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> Font {
        PetTypography.font(style, weight: weight)
    }

    static func blabee(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        PetTypography.font(size: size, weight: weight)
    }
}

/// CoreText registration is process-global. Serialize registration and cache
/// the outcome so rendering text never repeatedly opens a 6.7 MB font file.
private final class PetFontRegistration: @unchecked Sendable {
    private let lock = NSLock()
    private var attemptedBundle = false
    private var registeredURL: URL?

    var isAvailable: Bool {
        lock.lock()
        defer { lock.unlock() }
        if registeredURL != nil { return true }
        guard !attemptedBundle else { return false }
        attemptedBundle = true
        guard let resources = Bundle.main.resourceURL else { return false }
        let url = resources.appendingPathComponent(PetTypography.resourcePath)
            .appendingPathComponent(PetTypography.fileName)
        do {
            try registerLocked(url)
            return true
        } catch {
            // A missing resource must not prevent service recovery or settings.
            // Packaging and typography tests require the real font separately.
            return false
        }
    }

    func register(_ url: URL) throws {
        lock.lock()
        defer { lock.unlock() }
        try registerLocked(url)
    }

    private func registerLocked(_ url: URL) throws {
        let canonical = url.resolvingSymlinksInPath().standardizedFileURL
        if registeredURL == canonical { return }
        guard FileManager.default.fileExists(atPath: canonical.path) else {
            throw PetTypography.RegistrationError.missingFont
        }
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(canonical as CFURL)
                as? [CTFontDescriptor], !descriptors.isEmpty else {
            throw PetTypography.RegistrationError.invalidFont
        }
        let names = Set(descriptors.map { CTFontCopyPostScriptName(CTFontCreateWithFontDescriptor($0, 13, nil)) as String })
        let weights: [Font.Weight] = [.ultraLight, .thin, .light, .regular, .medium, .semibold, .bold, .heavy, .black]
        guard weights.allSatisfy({ names.contains(PetTypography.fontName(weight: $0)) }) else {
            throw PetTypography.RegistrationError.invalidFont
        }
        var error: Unmanaged<CFError>?
        let success = CTFontManagerRegisterFontsForURL(canonical as CFURL, .process, &error)
        if !success {
            let code = error.map { CFErrorGetCode($0.takeRetainedValue()) }
            guard code == CTFontManagerError.alreadyRegistered.rawValue else {
                throw PetTypography.RegistrationError.registrationFailed
            }
        }
        // Do not silently accept a different user-installed face with the same
        // name. The supplied app resource must actually be used by CoreText.
        for weight in weights {
            let name = PetTypography.fontName(weight: weight)
            let font = CTFontCreateWithName(name as CFString, 13, nil)
            guard CTFontCopyPostScriptName(font) as String == name,
                  let source = CTFontCopyAttribute(font, kCTFontURLAttribute) as? URL,
                  source.resolvingSymlinksInPath().standardizedFileURL == canonical else {
                throw PetTypography.RegistrationError.registrationFailed
            }
        }
        registeredURL = canonical
    }
}
