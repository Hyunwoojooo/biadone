// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BlabeeClaudeCoreAdapter",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "blabee-claude-core-fixture", targets: ["ClaudeCoreFixture"]),
    ],
    dependencies: [.package(path: "../../src/coordinator-swift")],
    targets: [
        .executableTarget(name: "ClaudeCoreFixture", dependencies: [
            .product(name: "ClaudeCoreAdapter", package: "coordinator-swift"),
            .product(name: "CoordinatorSwift", package: "coordinator-swift"),
        ]),
        .testTarget(name: "ClaudeCoreAdapterTests", dependencies: [
            .product(name: "ClaudeCoreAdapter", package: "coordinator-swift"),
            .product(name: "CoordinatorSwift", package: "coordinator-swift"),
        ]),
    ]
)
