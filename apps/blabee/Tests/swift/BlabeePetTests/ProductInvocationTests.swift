import BlabeeProductSupport
import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let expectedBundleURL = URL(fileURLWithPath: "/tmp/\(BlabeeProductProfile.current.appBundleName)", isDirectory: true)

private func invocationEnvironment(
    identifier: String? = BlabeeProductProfile.current.bundleIdentifier,
    name: String? = BlabeeProductProfile.current.displayName,
    executable: String? = "blabee-coordinator",
    bundleURL: URL? = expectedBundleURL,
    executableURL: URL? = expectedBundleURL
        .appendingPathComponent("Contents/MacOS/blabee-coordinator")
) -> ProductInvocationEnvironment {
    ProductInvocationEnvironment(
        bundleIdentifier: identifier,
        bundleName: name,
        bundleExecutable: executable,
        bundleURL: bundleURL,
        executableURL: executableURL
    )
}

@Test("The unified app preserves the existing socket path and override precedence")
func productSocketDefaultsPreserveBlabee() throws {
    let home = URL(fileURLWithPath: "/Users/example", isDirectory: true)
    let standard = "/Users/example/Library/Application Support/Blabee/runtime/blabee.sock"
    #expect(OperationalSocketPath.defaultPath(homeDirectory: home) == standard)
    #expect(try OperationalSocketPath.resolve(explicitPath: nil, environment: ["HOME": home.path]) == standard)
    let inherited = ["HOME": home.path, "BLABEE_SOCKET": "/tmp/existing-blabee.sock"]
    #expect(try OperationalSocketPath.resolve(explicitPath: nil, environment: inherited) == "/tmp/existing-blabee.sock")
    #expect(try OperationalSocketPath.resolve(explicitPath: "/tmp/explicit-blabee.sock", environment: inherited)
        == "/tmp/explicit-blabee.sock")
}

@Test("explicit product commands and legacy flags preserve their original dispatch")
func productInvocationPreservesExplicitDispatch() {
    for mode in [
        "daemon", "service", "project-settings", "pet", "doctor", "hook", "mcp",
        "managed-codex", "runtime-identity", "installed-pet", "--database",
    ] {
        #expect(ProductInvocationResolver.mode(
            commandLineArguments: ["/tmp/\(BlabeeProductProfile.current.appBundleName)/Contents/MacOS/blabee-coordinator", mode],
            environment: invocationEnvironment()
        ) == mode)
    }
}

@Test("implicit nonstandard app launches enter installation without affecting explicit commands")
func productInvocationInstallationRouting() {
    for path in ["/Volumes/Blabee/\(BlabeeProductProfile.current.appBundleName)", "/Users/test/Downloads/\(BlabeeProductProfile.current.appBundleName)", "/Users/test/Downloads/Blabee 2.app"] {
        let app = URL(fileURLWithPath: path, isDirectory: true)
        let executable = app.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        let environment = invocationEnvironment(bundleURL: app, executableURL: executable)
        for arguments in [[executable.path], [executable.path, "-psn_0_123"]] {
            #expect(ProductInvocationResolver.mode(commandLineArguments: arguments, environment: environment) == "pet")
            #expect(ProductInvocationResolver.requiresInstallation(commandLineArguments: arguments, environment: environment))
        }
        for mode in ["pet", "app-service", "service", "mcp", "hook", "doctor", "installed-pet"] {
            #expect(!ProductInvocationResolver.requiresInstallation(commandLineArguments: [executable.path, mode], environment: environment))
        }
    }
    let installed = URL(fileURLWithPath: "/Applications/\(BlabeeProductProfile.current.appBundleName)", isDirectory: true)
    let environment = invocationEnvironment(bundleURL: installed,
        executableURL: installed.appendingPathComponent("Contents/MacOS/blabee-coordinator"))
    #expect(ProductInvocationResolver.isStandardInstalledApp(environment))
    #expect(!ProductInvocationResolver.requiresInstallation(commandLineArguments: ["blabee-coordinator"], environment: environment))
}

@Test("renamed app candidates do not weaken the strict service bundle predicate")
func productInvocationRenamedCandidateKeepsStrictServiceIdentity() {
    let renamed = URL(fileURLWithPath: "/tmp/Blabee 2.app", isDirectory: true)
    let environment = invocationEnvironment(bundleURL: renamed,
        executableURL: renamed.appendingPathComponent("Contents/MacOS/blabee-coordinator"))
    #expect(ProductInvocationResolver.isInstallationCandidateAppBundle(environment))
    #expect(!ProductInvocationResolver.isExpectedAppBundle(environment))
    #expect(!ProductInvocationResolver.isStandardInstalledApp(environment))
}

@Test("runtime identity inspection accepts only an exact absolute Blabee app path")
func runtimeIdentityInspectionArgumentsAreStrict() throws {
    let expected = try RuntimeIdentityInspectionArguments([
        "--app", "/tmp/Previous/\(BlabeeProductProfile.current.appBundleName)",
    ])
    #expect(expected.appURL.path == URL(
        fileURLWithPath: "/tmp/Previous/\(BlabeeProductProfile.current.appBundleName)",
        isDirectory: true
    ).resolvingSymlinksInPath().standardizedFileURL.path)

    let canonicalTemporaryAlias = try RuntimeIdentityInspectionArguments([
        "--app", "/var/tmp/\(BlabeeProductProfile.current.appBundleName)",
    ])
    #expect(canonicalTemporaryAlias.appURL.path == URL(
        fileURLWithPath: "/var/tmp/\(BlabeeProductProfile.current.appBundleName)",
        isDirectory: true
    ).resolvingSymlinksInPath().standardizedFileURL.path)

    for invalid in [
        ["--app"],
        ["--app", "\(BlabeeProductProfile.current.appBundleName)"],
        ["--app", "/tmp/Previous/../\(BlabeeProductProfile.current.appBundleName)"],
        ["--app", "/tmp/Previous/Other.app"],
        ["--other", "/tmp/Previous/\(BlabeeProductProfile.current.appBundleName)"],
        ["--app", "/tmp/Previous/\(BlabeeProductProfile.current.appBundleName)", "extra"],
    ] {
        #expect(throws: CoordinatorError.self) {
            _ = try RuntimeIdentityInspectionArguments(invalid)
        }
    }
}

@Test("runtime identity inspection verifies the app and emits one strict JSON line")
func runtimeIdentityInspectionResponseIsStrict() throws {
    let identity = "sha256:" + String(repeating: "a", count: 64)
    let manifestIdentity = "sha256:" + String(repeating: "b", count: 64)
    var inspectedURL: URL?
    let response = try RuntimeIdentityInspectionApplication(
        installedInspection: { executableURL in
            inspectedURL = executableURL
            return OperationalInstalledRuntimeInspection(
                snapshot: OperationalRuntimeIdentitySnapshot(
                    runtimeIdentity: identity,
                    compatiblePreviousRuntimes: []
                ),
                assemblyManifestSHA256: manifestIdentity
            )
        }
    ).run(arguments: ["--app", "/tmp/Previous/\(BlabeeProductProfile.current.appBundleName)"])
    #expect(inspectedURL?.path
        == "/tmp/Previous/\(BlabeeProductProfile.current.appBundleName)/Contents/MacOS/blabee-coordinator")
    let expectedOutput = "{\"assembly_manifest_sha256\":\""
        + manifestIdentity + "\",\"runtime_identity\":\"" + identity
        + "\",\"schema_version\":\"blabee.runtime-identity-inspection.v2\"}\n"
    #expect(String(data: try response.outputData(), encoding: .utf8) == expectedOutput)

    #expect(throws: CoordinatorError.self) {
        _ = try RuntimeIdentityInspectionApplication(
            installedInspection: { _ in nil }
        ).run(arguments: ["--app", "/tmp/Previous/\(BlabeeProductProfile.current.appBundleName)"])
    }
}

@Test("a no-argument launch from the exact Blabee app bundle selects Pet")
func productInvocationSelectsPetForExpectedApp() {
    #expect(ProductInvocationResolver.mode(
        commandLineArguments: ["/tmp/\(BlabeeProductProfile.current.appBundleName)/Contents/MacOS/blabee-coordinator"],
        environment: invocationEnvironment()
    ) == "pet")
    #expect(ProductInvocationResolver.mode(
        commandLineArguments: [
            "/tmp/\(BlabeeProductProfile.current.appBundleName)/Contents/MacOS/blabee-coordinator", "-psn_0_12345",
        ],
        environment: invocationEnvironment()
    ) == "pet")
}

@Test("unbundled and lookalike no-argument launches remain legacy")
func productInvocationRejectsLookalikeApps() {
    let unbundled = ProductInvocationEnvironment(
        bundleIdentifier: nil,
        bundleName: nil,
        bundleExecutable: nil,
        bundleURL: URL(fileURLWithPath: "/tmp/build", isDirectory: true),
        executableURL: URL(fileURLWithPath: "/tmp/build/blabee-coordinator")
    )
    #expect(ProductInvocationResolver.mode(
        commandLineArguments: ["/tmp/build/blabee-coordinator"],
        environment: unbundled
    ) == nil)
    #expect(ProductInvocationResolver.mode(
        commandLineArguments: [],
        environment: invocationEnvironment()
    ) == nil)

    let lookalikes = [
        invocationEnvironment(identifier: "com.example.blabee"),
        invocationEnvironment(name: "Not Blabee"),
        invocationEnvironment(executable: "other"),
        invocationEnvironment(
            bundleURL: URL(fileURLWithPath: "/tmp/Other.app", isDirectory: true)
        ),
        invocationEnvironment(
            executableURL: URL(fileURLWithPath: "/tmp/blabee-coordinator")
        ),
    ]
    for environment in lookalikes {
        #expect(ProductInvocationResolver.mode(
            commandLineArguments: ["blabee-coordinator"],
            environment: environment
        ) == nil)
    }

    for malformedPSN in [
        "-psn_0_", "-psn__1", "-psn_a_1", "-psn_0_1_extra", "--psn_0_1",
    ] {
        #expect(ProductInvocationResolver.mode(
            commandLineArguments: ["blabee-coordinator", malformedPSN],
            environment: invocationEnvironment()
        ) == malformedPSN)
    }
}
