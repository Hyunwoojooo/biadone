import AppKit
import Foundation

enum PetAsset: String, CaseIterable, Sendable {
    case action1 = "figma-v14-action-1.svg"
    case action2 = "figma-v14-action-2.svg"
    case action3 = "figma-v14-action-3.svg"
    case action4 = "figma-v14-action-4.svg"
    case action5 = "figma-v14-action-5.svg"
    case ambientBlue = "figma-v14-ambient-blue.svg"
    case ambientCoral = "figma-v14-ambient-coral.svg"
    case bee = "figma-v14-bee.svg"
    case needsInput = "figma-v14-needs-input.svg"
    case working = "figma-v14-working.svg"

    static func action(slot: Int) -> PetAsset {
        switch slot {
        case 1: .action1
        case 2: .action2
        case 3: .action3
        case 4: .action4
        default: .action5
        }
    }
}

enum PetAssetError: Error, Equatable, CustomStringConvertible {
    case missingResourceDirectory
    case missingAsset(String)
    case unreadableAsset(String)

    var description: String {
        switch self {
        case .missingResourceDirectory:
            "Blabee Figma SVG resource directory is missing"
        case .missingAsset(let name):
            "Blabee Figma SVG resource is missing: \(name)"
        case .unreadableAsset(let name):
            "Blabee Figma SVG resource could not be decoded: \(name)"
        }
    }
}

struct PetAssetCatalog: Sendable, Equatable {
    static let resourceDirectoryName = "blabee-dark-menu-bar"

    let rootURL: URL

    init(rootURL: URL) {
        self.rootURL = rootURL.standardizedFileURL
    }

    init(
        bundle: Bundle = .main,
        currentDirectoryURL: URL = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )
    ) throws {
        let fileManager = FileManager.default
        let candidates: [URL] = [
            bundle.resourceURL?.appendingPathComponent(
                Self.resourceDirectoryName,
                isDirectory: true
            ),
            currentDirectoryURL.appendingPathComponent("assets", isDirectory: true),
        ].compactMap { $0?.standardizedFileURL }

        guard let root = candidates.first(where: { candidate in
            var isDirectory: ObjCBool = false
            return fileManager.fileExists(atPath: candidate.path, isDirectory: &isDirectory)
                && isDirectory.boolValue
        }) else {
            throw PetAssetError.missingResourceDirectory
        }
        self.init(rootURL: root)
    }

    func url(for asset: PetAsset) -> URL {
        rootURL.appendingPathComponent(asset.rawValue, isDirectory: false)
    }

    func validate() throws {
        for asset in PetAsset.allCases {
            let assetURL = url(for: asset)
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(
                atPath: assetURL.path,
                isDirectory: &isDirectory
            ), !isDirectory.boolValue else {
                throw PetAssetError.missingAsset(asset.rawValue)
            }
            guard let image = NSImage(contentsOf: assetURL), image.isValid else {
                throw PetAssetError.unreadableAsset(asset.rawValue)
            }
        }
    }

    func image(for asset: PetAsset) -> NSImage? {
        guard let image = NSImage(contentsOf: url(for: asset)), image.isValid else {
            return nil
        }
        image.isTemplate = false
        return image
    }
}
