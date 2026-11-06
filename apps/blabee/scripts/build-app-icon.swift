#!/usr/bin/env swift

import AppKit

// Reuse the menu-bar SVG rather than maintaining another copy of the bee path.
// Run: xcrun swift scripts/build-app-icon.swift <output.icns> [preview.png]
let arguments = Array(CommandLine.arguments.dropFirst())
guard (1...2).contains(arguments.count), arguments[0].hasSuffix(".icns") else {
    fatalError("Usage: build-app-icon.swift <output.icns> [preview.png]")
}
let project = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = project.appendingPathComponent("Packaging/macos/Resources/BlabeeMenuBar.svg")
guard let bee = NSImage(contentsOf: source) else {
    fatalError("Cannot read the menu-bar bee SVG")
}
let output = URL(fileURLWithPath: arguments[0]).standardizedFileURL
let manager = FileManager.default
let scratch = manager.temporaryDirectory.appendingPathComponent("blabee-app-icon-\(UUID().uuidString)")
let iconset = scratch.appendingPathComponent("Blabee.iconset")
try manager.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? manager.removeItem(at: scratch) }

func render(pixels: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Cannot create the icon bitmap")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    defer { NSGraphicsContext.restoreGraphicsState() }
    graphics.imageInterpolation = .high
    let context = graphics.cgContext
    context.clear(CGRect(x: 0, y: 0, width: pixels, height: pixels))
    context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)

    // A quiet Air surface with transparent margins for macOS icon spacing.
    let tile = NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 196, yRadius: 196)
    let top = NSColor(srgbRed: 0.97, green: 0.985, blue: 0.995, alpha: 1)
    let bottom = NSColor(srgbRed: 0.82, green: 0.90, blue: 0.94, alpha: 1)
    NSGradient(starting: bottom, ending: top)!.draw(in: tile, angle: 90)

    // Preserve the SVG's 28:24 aspect ratio and its original silhouette.
    context.saveGState()
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    let frame = NSRect(x: 92, y: 152, width: 840, height: 720)
    bee.draw(in: frame, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: nil)
    NSColor(srgbRed: 0.12, green: 0.17, blue: 0.23, alpha: 1).setFill()
    frame.fill(using: .sourceIn)
    context.endTransparencyLayer()
    context.restoreGState()

    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Cannot encode the icon PNG")
    }
    return data
}

var images: [Int: Data] = [:]
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        if images[pixels] == nil { images[pixels] = try render(pixels: pixels) }
        let suffix = scale == 1 ? "" : "@2x"
        try images[pixels]!.write(to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
try manager.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
let converter = Process()
converter.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
converter.arguments = ["--convert", "icns", "--output", output.path, iconset.path]
try converter.run()
converter.waitUntilExit()
guard converter.terminationStatus == 0 else { fatalError("iconutil failed") }
if arguments.count == 2 {
    let preview = URL(fileURLWithPath: arguments[1]).standardizedFileURL
    try manager.createDirectory(at: preview.deletingLastPathComponent(), withIntermediateDirectories: true)
    try images[1024]!.write(to: preview, options: .atomic)
}
print("Generated \(output.lastPathComponent) from BlabeeMenuBar.svg (16–1024 pixels)")
