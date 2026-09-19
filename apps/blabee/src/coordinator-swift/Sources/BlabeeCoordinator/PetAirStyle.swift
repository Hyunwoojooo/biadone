import SwiftUI

private struct PetAirForceOpaqueSurfacesKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Scoped rendering override for offscreen previews and tests. The system
    /// Reduce Transparency preference still applies independently in production.
    var petAirForceOpaqueSurfaces: Bool {
        get { self[PetAirForceOpaqueSurfacesKey.self] }
        set { self[PetAirForceOpaqueSurfacesKey.self] = newValue }
    }
}

/// Shared native surfaces for the Air design; layout and actions stay in the
/// existing Pet views so the visual treatment does not own any product state.
enum PetPanelVisualStyle {
    // Match the native System Settings window in the current macOS reference.
    static let cornerRadius: CGFloat = 26
    static let rimWidth: CGFloat = 1
    static let contentPadding: CGFloat = 22
    static let sectionRadius: CGFloat = 22
    static let rowRadius: CGFloat = 22
}

enum PetAirPalette {
    static func ink(for scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0xf2f3f2) : color(0x202c3b)
    }

    static func secondary(for scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0xd2d7da) : color(0x465363)
    }

    static func accent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0xd2ebf8) : color(0x356287)
    }

    static func panel(for scheme: ColorScheme) -> Color {
        scheme == .dark ? color(0x30363b) : color(0xdce2e7)
    }

    static func reading(for scheme: ColorScheme, emphasized: Bool) -> Color {
        if scheme == .dark {
            return color(emphasized ? 0x486270 : 0x464d53)
        }
        return color(emphasized ? 0xe4f4fd : 0xf4f7f9)
    }

    static func edge(for scheme: ColorScheme) -> Color {
        Color.white.opacity(scheme == .dark ? 0.39 : 0.85)
    }

    fileprivate static func color(_ hex: UInt32) -> Color {
        Color(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}

struct PetInsetSurfaceModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.petAirForceOpaqueSurfaces) private var forceOpaqueSurfaces
    @Environment(\.colorScheme) private var colorScheme

    let emphasized: Bool
    let cornerRadius: CGFloat

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    private var usesOpaqueSurface: Bool { reduceTransparency || forceOpaqueSurfaces }

    func body(content: Content) -> some View {
        content
            .background(
                PetAirPalette.reading(for: colorScheme, emphasized: emphasized)
                    .opacity(usesOpaqueSurface ? 1 : (colorScheme == .dark ? 0.79 : 0.61)),
                in: shape
            )
            .overlay(
                shape.strokeBorder(
                    usesOpaqueSurface
                        ? Color(nsColor: .separatorColor)
                        : PetAirPalette.edge(for: colorScheme),
                    lineWidth: 1
                )
            )
    }
}

extension View {
    func petInsetSurface(
        emphasized: Bool = false,
        cornerRadius: CGFloat = PetPanelVisualStyle.sectionRadius
    ) -> some View {
        modifier(PetInsetSurfaceModifier(
            emphasized: emphasized,
            cornerRadius: cornerRadius
        ))
    }

    @ViewBuilder
    func petCapsuleButtonBorder() -> some View {
        if #available(macOS 14.0, *) {
            buttonBorderShape(.capsule)
        } else {
            self
        }
    }

    @ViewBuilder
    func petCircleButtonBorder() -> some View {
        if #available(macOS 14.0, *) {
            buttonBorderShape(.circle)
        } else {
            self
        }
    }
}

struct PetPanelSurfaceModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.petAirForceOpaqueSurfaces) private var forceOpaqueSurfaces
    @Environment(\.colorScheme) private var colorScheme

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: PetPanelVisualStyle.cornerRadius, style: .continuous)
    }

    private var rimGradient: LinearGradient {
        LinearGradient(
            colors: [
                PetAirPalette.edge(for: colorScheme),
                Color.white.opacity(colorScheme == .dark ? 0.18 : 0.56),
                Color.white.opacity(colorScheme == .dark ? 0.30 : 0.76),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// Edge light is decorative and static; no timer, material sampling or
    /// animation runs while Blabee is waiting for work.
    private var edgeLight: some View {
        GeometryReader { geometry in
            ZStack {
                RadialGradient(
                    colors: [PetAirPalette.color(0x86d6ff).opacity(colorScheme == .dark ? 0.20 : 0.38), .clear],
                    center: .bottomLeading,
                    startRadius: 0,
                    endRadius: geometry.size.width * 0.8
                )
                RadialGradient(
                    colors: [PetAirPalette.color(0xfff1c0).opacity(colorScheme == .dark ? 0.16 : 0.42), .clear],
                    center: .bottomTrailing,
                    startRadius: 0,
                    endRadius: geometry.size.width * 0.8
                )
            }
            .mask(
                LinearGradient(
                    stops: [.init(color: .clear, location: 0.52), .init(color: .white, location: 1)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        .clipShape(shape)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceTransparency || forceOpaqueSurfaces {
            content
                .background(PetAirPalette.panel(for: colorScheme), in: shape)
                .overlay(shape.strokeBorder(Color(nsColor: .separatorColor), lineWidth: 1))
        } else {
            glassOrFallback(content)
        }
    }

    @ViewBuilder
    private func glassOrFallback<Surface: View>(_ content: Surface) -> some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            content
                .background(edgeLight)
                .glassEffect(.regular, in: shape)
                .overlay(shape.strokeBorder(rimGradient, lineWidth: PetPanelVisualStyle.rimWidth))
        } else {
            fallbackSurface(content)
        }
        #else
        fallbackSurface(content)
        #endif
    }

    private func fallbackSurface<Surface: View>(_ content: Surface) -> some View {
        content
            .background {
                shape
                    .fill(.regularMaterial)
                    .overlay(shape.fill(PetAirPalette.panel(for: colorScheme).opacity(0.46)))
                    .overlay(edgeLight)
            }
            .overlay(shape.strokeBorder(rimGradient, lineWidth: PetPanelVisualStyle.rimWidth))
    }
}

struct PetAirButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled

    var emphasized = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .padding(.horizontal, 13)
            .padding(.vertical, 8)
            .foregroundStyle(PetAirPalette.ink(for: colorScheme))
            .petInsetSurface(emphasized: emphasized || configuration.isPressed, cornerRadius: 999)
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Capsule())
    }
}

/// The small solid bee in the Air demo's header, drawn in a 32-point canvas.
struct PetAirBeeMark: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 13.1, y: 16.1))
        path.addCurve(to: CGPoint(x: 5.3, y: 3.2), control1: CGPoint(x: 6.1, y: 15.5), control2: CGPoint(x: 2.6, y: 6.3))
        path.addCurve(to: CGPoint(x: 13.1, y: 16.1), control1: CGPoint(x: 8.4, y: -0.2), control2: CGPoint(x: 15.1, y: 8.9))
        path.closeSubpath()
        path.move(to: CGPoint(x: 15, y: 16.1))
        path.addCurve(to: CGPoint(x: 26.3, y: 8.1), control1: CGPoint(x: 16.2, y: 9.9), control2: CGPoint(x: 23.8, y: 5.4))
        path.addCurve(to: CGPoint(x: 15, y: 16.1), control1: CGPoint(x: 29, y: 11.4), control2: CGPoint(x: 21.7, y: 17.1))
        path.closeSubpath()
        path.move(to: CGPoint(x: 12, y: 18))
        path.addLine(to: CGPoint(x: 20, y: 18))
        path.addQuadCurve(to: CGPoint(x: 21.1, y: 20.7), control: CGPoint(x: 21, y: 19))
        path.addLine(to: CGPoint(x: 10.9, y: 20.7))
        path.addQuadCurve(to: CGPoint(x: 12, y: 18), control: CGPoint(x: 11, y: 19))
        path.closeSubpath()
        path.addRect(CGRect(x: 10.7, y: 22.2, width: 10.6, height: 2.2))
        path.move(to: CGPoint(x: 11.2, y: 25.9))
        path.addLine(to: CGPoint(x: 20.8, y: 25.9))
        path.addCurve(to: CGPoint(x: 16, y: 29.4), control1: CGPoint(x: 20, y: 28.5), control2: CGPoint(x: 18.4, y: 29.4))
        path.addCurve(to: CGPoint(x: 11.2, y: 25.9), control1: CGPoint(x: 13.6, y: 29.4), control2: CGPoint(x: 12, y: 28.5))
        path.closeSubpath()
        let side = min(rect.width, rect.height)
        return path.applying(CGAffineTransform(scaleX: side / 32, y: side / 32))
            .applying(CGAffineTransform(translationX: rect.midX - side / 2, y: rect.midY - side / 2))
    }
}

struct PetAirWaitingArtwork: View {
    @Environment(\.colorScheme) private var colorScheme

    // Same 53-dot pattern as ui-demos/air-v1/components.js.
    private static let beeRows = [
        "0000100010000", "0000010100000", "0000001000000", "0111001001110",
        "1000111110001", "1001111111001", "0110111110110", "0001011101000",
        "0000111110000", "0000100010000", "0000011100000", "0000001000000",
    ]

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 130
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            for index in 0..<60 {
                let hour = index.isMultiple(of: 5)
                let angle = CGFloat(index) * .pi / 30 - .pi / 2
                let outer: CGFloat = (hour ? 58 : 55) * scale
                let inner: CGFloat = (hour ? 51 : 52) * scale
                var tick = Path()
                tick.move(to: CGPoint(x: center.x + cos(angle) * outer, y: center.y + sin(angle) * outer))
                tick.addLine(to: CGPoint(x: center.x + cos(angle) * inner, y: center.y + sin(angle) * inner))
                context.stroke(
                    tick,
                    with: .color((index == 8 ? PetAirPalette.accent(for: colorScheme) : PetAirPalette.secondary(for: colorScheme)).opacity(0.7)),
                    lineWidth: (index == 8 ? 1.8 : 1) * scale
                )
            }
            // The web artwork is 57 points tall inside a 145-point dial.
            let dotScale = scale * (57.0 / 72.0) * (130.0 / 145.0)
            for (rowIndex, row) in Self.beeRows.enumerated() {
                for (column, dot) in row.enumerated() where dot == "1" {
                    let radius = 1.65 * dotScale
                    let x = center.x + (CGFloat(column * 6 + 3) - 39) * dotScale
                    let y = center.y + (CGFloat(rowIndex * 6 + 3) - 36) * dotScale
                    context.fill(
                        Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)),
                        with: .color(PetAirPalette.ink(for: colorScheme))
                    )
                }
            }
        }
        .frame(width: 145, height: 145)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

/// A compact, static count of the available choices, matching the demo meter.
struct PetAirChoiceCount: View {
    @Environment(\.colorScheme) private var colorScheme
    let count: Int

    private static let digits: [Character: [String]] = [
        "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
        "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
        "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
        "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
        "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    ]

    var body: some View {
        HStack(spacing: 15) {
            Canvas { context, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                context.stroke(
                    Path(ellipseIn: CGRect(x: center.x - 34, y: center.y - 34, width: 68, height: 68)),
                    with: .color(PetAirPalette.secondary(for: colorScheme).opacity(0.53)),
                    style: StrokeStyle(lineWidth: 1, dash: [1, 2.2])
                )
                let value = count < 10 ? "0\(count)" : String(count)
                let scale: CGFloat = 34 / 42
                let totalWidth = CGFloat(value.count * 36 - 6) * scale
                for (digitIndex, digit) in value.enumerated() {
                    for (rowIndex, row) in (Self.digits[digit] ?? []).enumerated() {
                        for (column, dot) in row.enumerated() where dot == "1" {
                            let radius = 1.65 * scale
                            let x = center.x - totalWidth / 2 + CGFloat(digitIndex * 36 + column * 6 + 3) * scale
                            let y = center.y - 17 + CGFloat(rowIndex * 6 + 3) * scale
                            context.fill(
                                Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)),
                                with: .color(PetAirPalette.ink(for: colorScheme))
                            )
                        }
                    }
                }
            }
            .frame(width: 83, height: 78)
            VStack(alignment: .leading, spacing: 3) {
                Text("개의 다음 선택")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PetAirPalette.ink(for: colorScheme))
                Text("지금 필요한 작업부터")
                    .font(.system(size: 12))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 82)
        .petInsetSurface(cornerRadius: 24)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count)개의 다음 선택")
    }
}
