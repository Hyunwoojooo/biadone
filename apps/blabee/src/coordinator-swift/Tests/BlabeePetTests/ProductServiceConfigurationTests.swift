import CoordinatorSwift
import BlabeeProductSupport
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct ProductServiceFixture {
    let root: URL
    let applicationSupport: URL
    let bundle: URL

    init() throws {
        root = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent("bst-\(UUID().uuidString)", isDirectory: true)
        applicationSupport = root.appendingPathComponent("as", isDirectory: true)
        bundle = root.appendingPathComponent("Blabee.app", isDirectory: true)
        try FileManager.default.createDirectory(
            at: bundle.appendingPathComponent(
                "Contents/Resources/Contracts/v1",
                isDirectory: true
            ),
            withIntermediateDirectories: true
        )
    }

    var configDirectory: URL {
        applicationSupport.appendingPathComponent("Blabee/config", isDirectory: true)
    }

    var productDirectory: URL {
        applicationSupport.appendingPathComponent("Blabee", isDirectory: true)
    }

    var configFile: URL {
        configDirectory.appendingPathComponent("service.json")
    }

    func environment(
        identifier: String? = "com.biadone.blabee",
        name: String? = "Blabee",
        executable: String? = "blabee-coordinator",
        bundleURL: URL? = nil,
        executableURL: URL? = nil,
        resourceURL: URL? = nil,
        applicationSupportURL: URL? = nil
    ) -> ProductServiceEnvironment {
        let selectedBundle = bundleURL ?? bundle
        return ProductServiceEnvironment(
            invocation: ProductInvocationEnvironment(
                bundleIdentifier: identifier,
                bundleName: name,
                bundleExecutable: executable,
                bundleURL: selectedBundle,
                executableURL: executableURL ?? selectedBundle
                    .appendingPathComponent("Contents/MacOS/blabee-coordinator")
            ),
            resourceURL: resourceURL ?? selectedBundle
                .appendingPathComponent("Contents/Resources", isDirectory: true),
            applicationSupportURL: applicationSupportURL ?? applicationSupport
        )
    }

    func writeConfig(_ object: Any) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try writeConfigData(data)
    }

    func writeConfigData(_ data: Data) throws {
        try FileManager.default.createDirectory(
            at: configDirectory,
            withIntermediateDirectories: true
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: productDirectory.path
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: configDirectory.path
        )
        try data.write(to: configFile)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: configFile.path
        )
    }
}

private func productServiceErrorCode(
    _ operation: () throws -> ProductServiceConfiguration
) -> String? {
    do {
        _ = try operation()
        return nil
    } catch let error as CoordinatorError {
        return error.code
    } catch {
        return "unexpected_error"
    }
}

@Test("product service derives only bundle and Application Support paths")
func productServiceDerivesFixedPathsWithoutConfig() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }

    let configuration = try ProductServiceBootstrap.resolve(
        environment: fixture.environment()
    )
    let root = fixture.applicationSupport.appendingPathComponent("Blabee", isDirectory: true)
    #expect(configuration.database == root.appendingPathComponent("storage/coordinator.sqlite3"))
    #expect(configuration.key == root.appendingPathComponent("storage/coordinator.key"))
    #expect(configuration.socketPath == root.appendingPathComponent("runtime/blabee.sock").path)
    #expect(configuration.config == root.appendingPathComponent("config/service.json"))
    #expect(configuration.contracts == fixture.bundle
        .appendingPathComponent("Contents/Resources/Contracts/v1", isDirectory: true))
    #expect(configuration.enabledProjectPaths == [])

    try FileManager.default.createDirectory(
        at: fixture.configDirectory,
        withIntermediateDirectories: true
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fixture.productDirectory.path
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fixture.configDirectory.path
    )
    #expect(try ProductServiceBootstrap.resolve(
        environment: fixture.environment()
    ).enabledProjectPaths == [])
}

@Test("product service rejects every extra launch argument before bootstrapping")
func productServiceRejectsExtraArguments() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(
            arguments: ["--database", "/tmp/override.sqlite3"],
            environment: fixture.environment()
        )
    } == "invalid_arguments")
}

@Test("product service accepts, normalizes, and UTF-8 sorts enabled projects")
func productServiceLoadsEnabledProjectsDeterministically() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    try fixture.writeConfig([
        "schema_version": "1.0",
        "enabled_projects": ["/zeta/project", "/beta/../alpha", "/가/project"],
    ])

    let configuration = try ProductServiceBootstrap.resolve(
        environment: fixture.environment()
    )
    #expect(configuration.enabledProjectPaths == [
        "/alpha", "/zeta/project", "/가/project",
    ])
}

@Test("product service rejects bundle identity and layout lookalikes")
func productServiceRejectsBundleLookalikes() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    let otherBundle = fixture.root.appendingPathComponent("Other.app", isDirectory: true)
    let lookalikes = [
        fixture.environment(identifier: "com.example.blabee"),
        fixture.environment(name: "Not Blabee"),
        fixture.environment(executable: "other"),
        fixture.environment(bundleURL: otherBundle),
        fixture.environment(executableURL: fixture.root.appendingPathComponent("blabee-coordinator")),
        fixture.environment(resourceURL: fixture.bundle.appendingPathComponent("Resources")),
        fixture.environment(applicationSupportURL: URL(string: "https://example.com/support")),
    ]
    for environment in lookalikes {
        #expect(productServiceErrorCode {
            try ProductServiceBootstrap.resolve(environment: environment)
        } == "product_service_bundle_invalid")
    }
}

@Test("product service requires a real bundled Contracts v1 directory")
func productServiceRejectsMissingAndSymlinkedContracts() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    let contracts = fixture.bundle.appendingPathComponent(
        "Contents/Resources/Contracts/v1",
        isDirectory: true
    )
    try FileManager.default.removeItem(at: contracts)
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_bundle_invalid")

    let external = fixture.root.appendingPathComponent("external-contracts", isDirectory: true)
    try FileManager.default.createDirectory(at: external, withIntermediateDirectories: false)
    try FileManager.default.createSymbolicLink(at: contracts, withDestinationURL: external)
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_bundle_invalid")
}

@Test("product service rejects malformed schemas and unsafe project paths")
func productServiceRejectsInvalidConfigContent() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }

    let invalidObjects: [[String: Any]] = [
        ["schema_version": "2.0", "enabled_projects": []],
        ["schema_version": "1.0", "enabled_projects": [], "extra": true],
        ["schema_version": "1.0", "enabled_projects": ["relative/path"]],
        ["schema_version": "1.0", "enabled_projects": ["/a/../project", "/project"]],
        ["schema_version": "1.0", "enabled_projects": [1]],
    ]
    for object in invalidObjects {
        try fixture.writeConfig(object)
        #expect(productServiceErrorCode {
            try ProductServiceBootstrap.resolve(environment: fixture.environment())
        } == "product_service_config_invalid")
    }

    try fixture.writeConfigData(Data(#"{"schema_version":"1.0","enabled_projects":[],"schema_version":"1.0"}"#.utf8))
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_invalid")
}

@Test("product service enforces project count and UTF-8 path bounds")
func productServiceRejectsConfigCollectionLimits() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }

    let tooMany = (0...ProductServiceBootstrap.maximumEnabledProjects).map { "/p/\($0)" }
    try fixture.writeConfig([
        "schema_version": "1.0",
        "enabled_projects": tooMany,
    ])
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_invalid")

    try fixture.writeConfig([
        "schema_version": "1.0",
        "enabled_projects": ["/" + String(repeating: "a", count: 4_096)],
    ])
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_invalid")
}

@Test("product service requires secure config directory and file metadata")
func productServiceRejectsUnsafeConfigMetadata() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    try fixture.writeConfig(["schema_version": "1.0", "enabled_projects": []])

    try FileManager.default.setAttributes(
        [.posixPermissions: 0o755],
        ofItemAtPath: fixture.configDirectory.path
    )
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_unsafe")

    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fixture.configDirectory.path
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o644],
        ofItemAtPath: fixture.configFile.path
    )
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_unsafe")
}

@Test("product service refuses symlinked, special, and oversized config inputs")
func productServiceRejectsSymlinkSpecialAndOversizedConfig() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    try FileManager.default.createDirectory(
        at: fixture.configDirectory,
        withIntermediateDirectories: true
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fixture.productDirectory.path
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fixture.configDirectory.path
    )
    let outside = fixture.root.appendingPathComponent("outside.json")
    try Data(#"{"schema_version":"1.0","enabled_projects":[]}"#.utf8).write(to: outside)
    try FileManager.default.createSymbolicLink(at: fixture.configFile, withDestinationURL: outside)
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_unsafe")

    try FileManager.default.removeItem(at: fixture.configFile)
    guard mkfifo(fixture.configFile.path, mode_t(0o600)) == 0 else {
        throw CoordinatorError("test_fixture_failed", "could not create config FIFO")
    }
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_unsafe")

    try FileManager.default.removeItem(at: fixture.configFile)
    try Data(repeating: 0x20, count: ProductServiceBootstrap.maximumConfigBytes + 1)
        .write(to: fixture.configFile)
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o600],
        ofItemAtPath: fixture.configFile.path
    )
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_unsafe")
}

@Test("product service refuses a symlinked config directory")
func productServiceRejectsSymlinkedConfigDirectory() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    let parent = fixture.configDirectory.deletingLastPathComponent()
    let external = fixture.root.appendingPathComponent("external-config", isDirectory: true)
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: external, withIntermediateDirectories: false)
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fixture.productDirectory.path
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: external.path
    )
    try FileManager.default.createSymbolicLink(
        at: fixture.configDirectory,
        withDestinationURL: external
    )
    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_unsafe")
}

@Test("product service refuses a symlinked Blabee ancestor on restart")
func productServiceRejectsSymlinkedProductDirectory() throws {
    let fixture = try ProductServiceFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    try FileManager.default.createDirectory(
        at: fixture.applicationSupport,
        withIntermediateDirectories: true
    )
    let externalProduct = fixture.root.appendingPathComponent(
        "external-Blabee",
        isDirectory: true
    )
    let externalConfig = externalProduct.appendingPathComponent("config", isDirectory: true)
    try FileManager.default.createDirectory(
        at: externalConfig,
        withIntermediateDirectories: true
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: externalProduct.path
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: externalConfig.path
    )
    let externalConfigFile = externalConfig.appendingPathComponent("service.json")
    try Data(#"{"schema_version":"1.0","enabled_projects":[]}"#.utf8)
        .write(to: externalConfigFile)
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o600],
        ofItemAtPath: externalConfigFile.path
    )
    try FileManager.default.createSymbolicLink(
        at: fixture.productDirectory,
        withDestinationURL: externalProduct
    )

    #expect(productServiceErrorCode {
        try ProductServiceBootstrap.resolve(environment: fixture.environment())
    } == "product_service_config_unsafe")
}
