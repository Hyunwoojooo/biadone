import SwiftUI

/// Read-only content: opening a preview never submits or confirms a choice.
struct PetChoicePreviewView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @Environment(\.colorScheme) private var colorScheme
    let preview: PetChoicePreview

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "text.magnifyingglass")
                        .accessibilityHidden(true)
                    Text(PetL10n.text("Preview", korean: "미리보기"))
                    Text(PetL10n.text("Choice \(preview.choice.slot)", korean: "\(preview.choice.slot)번 선택지"))
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                }
                .font(.blabee(.callout, weight: .semibold))
                .foregroundStyle(PetAirPalette.accent(for: colorScheme))

                Text(PetL10n.text("Release \(preview.shortcutPreset.holdKeyName) to close", korean: "\(preview.shortcutPreset.holdKeyName) 키를 떼면 닫힙니다"))
                    .font(.blabee(size: 13))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            }

            Text(verbatim: preview.choice.displayTitle)
                .font(.blabee(size: 23, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            if let action = preview.choice.action {
                section(title: PetL10n.text("Task", korean: "할 일")) {
                    bodyText(action.objective)
                }
                if !action.constraints.isEmpty {
                    section(title: PetL10n.text("Constraints", korean: "지킬 조건")) {
                        textList(action.constraints)
                    }
                }
                section(title: PetL10n.text("Completion criteria", korean: "완료 기준")) {
                    textList(action.doneWhen)
                }
            }
        }
        .foregroundStyle(PetAirPalette.ink(for: colorScheme))
        .lineLimit(nil)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("choice-preview")
    }

    private func section<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: title)
                .font(.blabee(size: 13, weight: .semibold))
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .petInsetSurface()
    }

    private func bodyText(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.blabee(size: 16))
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func textList(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, text in
                HStack(alignment: .top, spacing: 10) {
                    Text("•")
                        .font(.blabee(size: 16))
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                        .accessibilityHidden(true)
                    bodyText(text)
                }
            }
        }
    }
}
