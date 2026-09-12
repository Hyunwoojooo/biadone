import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Pet settings status indicators")
struct PetSettingsStatusIndicatorTests {
    @Test("The same status palette is used by dots, badges, and the legend")
    func statusPalette() {
        #expect(PetSettingsStatusTone.confirmed.color == Color.green)
        #expect(PetSettingsStatusTone.actionNeeded.color == Color.orange)
        #expect(PetSettingsStatusTone.error.color == Color.red)
        #expect(PetSettingsStatusTone.neutral.color == Color.secondary)
    }

    @Test("Status badges and legend render in light and dark at normal and narrow widths")
    @MainActor
    func rendersStatusIndicators() throws {
        for dark in [false, true] {
            for width in [240.0, 396.0] {
                let content = VStack(alignment: .leading, spacing: 12) {
                    PetSettingsStatusBadge(tone: .confirmed, title: "서비스 연결됨")
                    PetSettingsStatusBadge(tone: .confirmed, title: "Plugin 설치 완료")
                    PetSettingsStatusBadge(tone: .actionNeeded, title: "설정 적용 필요")
                    PetSettingsStatusBadge(tone: .error, title: "연결 오류")
                    PetSettingsStatusBadge(tone: .neutral, title: "Hook 신뢰 · Codex에서 확인")
                    PetSettingsStatusBadge(tone: .neutral, title: "선택 사항 · 꺼짐")
                    PetSettingsStatusLegend()
                }
                .padding(16)
                .frame(width: width, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .environment(\.colorScheme, dark ? .dark : .light)
                .background(dark ? Color.black : Color.white)

                let hosting = NSHostingView(rootView: content)
                hosting.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                let size = hosting.fittingSize
                // SwiftUI fitting sizes include subpixel floating-point residuals.
                #expect(abs(size.width - width) < 0.01)
                #expect(size.height > 180 && size.height < 360)
                hosting.frame = NSRect(origin: .zero, size: size)
                hosting.layoutSubtreeIfNeeded()
                let bitmap = try #require(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
                hosting.effectiveAppearance.performAsCurrentDrawingAppearance {
                    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                }
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)

                // Optional offscreen artifacts; never open a window or touch the installed app.
                if let directory = ProcessInfo.processInfo.environment["BLABEE_READINESS_RENDER_DIRECTORY"] {
                    let data = try #require(bitmap.representation(using: .png, properties: [:]))
                    let url = URL(fileURLWithPath: directory, isDirectory: true)
                        .appendingPathComponent("indicators-\(Int(width))-\(dark ? "dark" : "light").png")
                    try data.write(to: url)
                }
            }
        }
    }
}
