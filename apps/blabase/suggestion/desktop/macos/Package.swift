// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "BlabaseLauncher",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "BlabaseLauncher", targets: ["BlabaseLauncher"])
    ],
    targets: [
        .executableTarget(
            name: "BlabaseLauncher",
            path: "Sources/BlabaseLauncher"
        ),
        .testTarget(
            name: "BlabaseLauncherTests",
            dependencies: ["BlabaseLauncher"],
            path: "Tests/BlabaseLauncherTests"
        )
    ]
)
