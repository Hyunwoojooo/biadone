// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BlabeeCoordinator",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .library(name: "CoordinatorSwift", targets: ["CoordinatorSwift"]),
        .executable(name: "blabee-coordinator", targets: ["BlabeeCoordinator"]),
    ],
    targets: [
        .target(
            name: "CoordinatorSwift",
            linkerSettings: [
                .linkedLibrary("sqlite3"),
                .linkedFramework("Security"),
            ]
        ),
        .target(
            name: "BlabeeProductSupport",
            dependencies: ["CoordinatorSwift"]
        ),
        .executableTarget(
            name: "BlabeeCoordinator",
            dependencies: ["CoordinatorSwift", "BlabeeProductSupport"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Carbon"),
                .linkedFramework("ServiceManagement"),
                .linkedFramework("SwiftUI"),
            ]
        ),
        .executableTarget(
            name: "BlabeeSettingsTestHelper",
            dependencies: ["BlabeeProductSupport", "CoordinatorSwift"],
            path: "Tests/BlabeeSettingsTestHelper"
        ),
        .testTarget(
            name: "CoordinatorSwiftTests",
            dependencies: ["CoordinatorSwift"]
        ),
        .testTarget(
            name: "BlabeePetTests",
            dependencies: [
                "BlabeeCoordinator", "BlabeeProductSupport", "BlabeeSettingsTestHelper",
            ]
        ),
    ]
)
