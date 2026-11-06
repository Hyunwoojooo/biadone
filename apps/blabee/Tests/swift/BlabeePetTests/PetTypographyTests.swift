import AppKit
import CoreText
import CryptoKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

/// SwiftPM's test executable is not an assembled Blabee.app. Render tests must
/// explicitly load the same resource that the app assembler ships.
enum PetTypographyTestResources {
    static let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../Packaging/macos/Resources/Fonts/Pretendard")
        .standardizedFileURL

    static func register() throws { try PetTypography.registerFonts(in: directory) }
}

@Suite("Bundled Pretendard typography", .petLanguage(.korean))
@MainActor
struct PetTypographyTests {
    @Test("All text weights resolve to the supplied bundled font, including Korean glyphs")
    func bundledFaces() throws {
        try PetTypographyTestResources.register()
        // Repeated registration must be safe across windows and render suites.
        try PetTypographyTestResources.register()
        let resource = PetTypographyTestResources.directory.appendingPathComponent(PetTypography.fileName)
        let weights: [(Font.Weight, Double)] = [
            (.ultraLight, 100), (.thin, 200), (.light, 300), (.regular, 400),
            (.medium, 500), (.semibold, 600), (.bold, 700), (.heavy, 800), (.black, 900),
        ]
        for (weight, expectedAxis) in weights {
            let name = PetTypography.fontName(weight: weight)
            let font = CTFontCreateWithName(name as CFString, 14, nil)
            #expect(CTFontCopyPostScriptName(font) as String == name)
            #expect(CTFontCopyFamilyName(font) as String == "Pretendard Variable")
            let source = try #require(CTFontCopyAttribute(font, kCTFontURLAttribute) as? URL)
            #expect(source.resolvingSymlinksInPath() == resource.resolvingSymlinksInPath())
            let variations = try #require(CTFontCopyVariation(font) as? [NSNumber: NSNumber])
            let axes = try #require(CTFontCopyVariationAxes(font) as? [[String: Any]])
            let weightAxis = try #require(axes.first {
                ($0[kCTFontVariationAxisIdentifierKey as String] as? NSNumber)?.intValue == 2_003_265_652
            })
            let defaultWeight = try #require(weightAxis[kCTFontVariationAxisDefaultValueKey as String] as? NSNumber)
            // CoreText omits an unchanged axis from Regular's variation map.
            let actualWeight = variations[NSNumber(value: 2_003_265_652)] ?? defaultWeight
            #expect(actualWeight.doubleValue == expectedAxis)
            let characters = Array("Blabee 선택 권장 설정 업데이트 Waiting 1234".utf16)
            var glyphs = [CGGlyph](repeating: 0, count: characters.count)
            #expect(CTFontGetGlyphsForCharacters(font, characters, &glyphs, characters.count))
            #expect(glyphs.allSatisfy { $0 != 0 })
        }
    }

    @Test("Font and license retain the bytes supplied in Pretendard 1.3.9")
    func originalResources() throws {
        for (file, expected) in [
            (PetTypography.fileName, "3090ccde0442bb347aa7685d9ba8b17436a60682df6e8f92a9a670de14056e22"),
            ("LICENSE.txt", "b04538c9abec39a3db75108cf0af0fd9c77032fe8aa2cf38345b4d250e98e38e"),
        ] {
            let data = try Data(contentsOf: PetTypographyTestResources.directory.appendingPathComponent(file))
            #expect(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() == expected)
        }
    }

    @Test("Missing or corrupt font resources cannot report successful registration")
    func rejectsUnusableResources() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("blabee-font-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(throws: PetTypography.RegistrationError.self) { try PetTypography.registerFonts(in: root) }
        try Data("invalid-font".utf8).write(to: root.appendingPathComponent(PetTypography.fileName))
        #expect(throws: PetTypography.RegistrationError.self) { try PetTypography.registerFonts(in: root) }
    }
}
