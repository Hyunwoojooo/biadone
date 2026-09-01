import BlabeeProductSupport
import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let expectedBundleURL = URL(fileURLWithPath: "/tmp/Blabee.app", isDirectory: true)

private func invocationEnvironment(
    identifier: String? = "com.biadone.blabee",
    name: String? = "Blabee",
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

@Test("explicit product commands and legacy flags preserve their original dispatch")
func productInvocationPreservesExplicitDispatch() {
    for mode in [
        "daemon", "service", "project-settings", "pet", "doctor", "hook", "mcp",
        "managed-codex", "runtime-identity", "--database",
    ] {
        #expect(ProductInvocationResolver.mode(
            commandLineArguments: ["/tmp/Blabee.app/Contents/MacOS/blabee-coordinator", mode],
            environment: invocationEnvironment()
        ) == mode)
    }
}

@Test("runtime identity inspection accepts only an exact absolute Blabee app path")
func runtimeIdentityInspectionArgumentsAreStrict() throws {
    let expected = try RuntimeIdentityInspectionArguments([
        "--app", "/tmp/Previous/Blabee.app",
    ])
    #expect(expected.appURL.path == URL(
        fileURLWithPath: "/tmp/Previous/Blabee.app",
        isDirectory: true
    ).resolvingSymlinksInPath().standardizedFileURL.path)

    let canonicalTemporaryAlias = try RuntimeIdentityInspectionArguments([
        "--app", "/var/tmp/Blabee.app",
    ])
    #expect(canonicalTemporaryAlias.appURL.path == URL(
        fileURLWithPath: "/var/tmp/Blabee.app",
        isDirectory: true
    ).resolvingSymlinksInPath().standardizedFileURL.path)

    for invalid in [
        ["--app"],
        ["--app", "Blabee.app"],
        ["--app", "/tmp/Previous/../Blabee.app"],
        ["--app", "/tmp/Previous/Other.app"],
        ["--other", "/tmp/Previous/Blabee.app"],
        ["--app", "/tmp/Previous/Blabee.app", "extra"],
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
    ).run(arguments: ["--app", "/tmp/Previous/Blabee.app"])
    #expect(inspectedURL?.path
        == "/tmp/Previous/Blabee.app/Contents/MacOS/blabee-coordinator")
    let expectedOutput = "{\"assembly_manifest_sha256\":\""
        + manifestIdentity + "\",\"runtime_identity\":\"" + identity
        + "\",\"schema_version\":\"blabee.runtime-identity-inspection.v2\"}\n"
    #expect(String(data: try response.outputData(), encoding: .utf8) == expectedOutput)

    #expect(throws: CoordinatorError.self) {
        _ = try RuntimeIdentityInspectionApplication(
            installedInspection: { _ in nil }
        ).run(arguments: ["--app", "/tmp/Previous/Blabee.app"])
    }
}

@Test("a no-argument launch from the exact Blabee app bundle selects Pet")
func productInvocationSelectsPetForExpectedApp() {
    #expect(ProductInvocationResolver.mode(
        commandLineArguments: ["/tmp/Blabee.app/Contents/MacOS/blabee-coordinator"],
        environment: invocationEnvironment()
    ) == "pet")
    #expect(ProductInvocationResolver.mode(
        commandLineArguments: [
            "/tmp/Blabee.app/Contents/MacOS/blabee-coordinator", "-psn_0_12345",
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
