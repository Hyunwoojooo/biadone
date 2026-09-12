import SwiftUI

extension PetSettingsStatusTone {
    var color: Color {
        switch self {
        case .confirmed: .green
        case .actionNeeded: .orange
        case .error: .red
        case .neutral: .secondary
        }
    }
}

/// Always pair the decorative dot with a visible status label or description.
struct PetSettingsStatusDot: View {
    let tone: PetSettingsStatusTone

    var body: some View {
        Circle()
            .fill(tone.color)
            .overlay(Circle().strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5))
            .frame(width: 9, height: 9)
            .accessibilityHidden(true)
    }
}

struct PetSettingsStatusBadge: View {
    let tone: PetSettingsStatusTone
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            PetSettingsStatusDot(tone: tone)
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(tone.color.opacity(0.10), in: Capsule())
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

struct PetSettingsStatusLegend: View {
    private var items: some View {
        Group {
            item(.confirmed)
            item(.actionNeeded)
            item(.error)
            item(.neutral)
        }
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { items }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
                items
            }
        }
        .accessibilityIdentifier("connection-status-legend")
    }

    private func item(_ tone: PetSettingsStatusTone) -> some View {
        HStack(spacing: 5) {
            PetSettingsStatusDot(tone: tone)
            Text(tone.label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize()
        }
        .accessibilityElement(children: .combine)
    }
}
