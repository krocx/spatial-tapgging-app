// OnboardingSheet.swift
// Dark-themed, swipeable FTUE walkthrough shown once per mode on first entry.
// Also reachable any time via the ? Help button in each mode.
//
// Usage:
//   .sheet(isPresented: $showOnboarding) {
//       OnboardingSheet(context: .author)
//   }

import SwiftUI

// ── Context descriptor ────────────────────────────────────────────────────────

enum OnboardingContext {
    case home, author, operatorMode

    var welcomeTitle: String {
        switch self {
        case .home:         return "Welcome to\nSpatial Tagging"
        case .author:       return "Author Mode"
        case .operatorMode: return "Operator Mode"
        }
    }

    var welcomeSubtitle: String {
        switch self {
        case .home:
            return "Your AR-powered cleanroom inspection system. Here's a quick overview to get you up and running."
        case .author:
            return "Build the inspection blueprint — place tags, train reference views, and share with your team."
        case .operatorMode:
            return "Run the inspection — scan the anchor, walk the path, and get real-time PASS/FAIL results."
        }
    }

    var welcomeIcon: String {
        switch self {
        case .home:         return "qrcode.viewfinder"
        case .author:       return "pencil.circle.fill"
        case .operatorMode: return "eye.circle.fill"
        }
    }

    var accentColor: Color {
        switch self {
        case .home:         return .cyan
        case .author:       return .blue
        case .operatorMode: return .green
        }
    }

    var steps: [OnboardingStep] {
        switch self {
        case .home:         return OnboardingContent.home
        case .author:       return OnboardingContent.author
        case .operatorMode: return OnboardingContent.operatorMode
        }
    }
}

// ── Step model ────────────────────────────────────────────────────────────────

struct OnboardingStep: Identifiable {
    let id = UUID()
    let icon:   String
    let title:  String
    let detail: String
}

// ── Content library ───────────────────────────────────────────────────────────

enum OnboardingContent {

    static let home: [OnboardingStep] = [
        OnboardingStep(
            icon:   "pencil.circle.fill",
            title:  "Author Mode",
            detail: "Authors create anchors, place inspection tags on surfaces, and train each check point. Do this once per asset before Operators arrive."),
        OnboardingStep(
            icon:   "eye.circle.fill",
            title:  "Operator Mode",
            detail: "Operators scan the anchor QR code and walk through the inspection. The app validates each tag automatically in real-time."),
        OnboardingStep(
            icon:   "gearshape.fill",
            title:  "First, Configure Settings",
            detail: "Tap ⚙️ Settings to enter your SIB server URL and API key. Both Author and Operator modes need a live connection to the server."),
    ]

    static let author: [OnboardingStep] = [
        OnboardingStep(
            icon:   "scope",
            title:  "Scan the Anchor QR",
            detail: "Point your camera at the anchor QR code to lock AR coordinates. Every tag you place will be anchored to this physical reference point."),
        OnboardingStep(
            icon:   "hand.tap.fill",
            title:  "Place Tags",
            detail: "Tap any flat surface to place a tag. Give it a label, a type, and an expected outcome — this becomes the pass/fail criteria at inspection time."),
        OnboardingStep(
            icon:   "camera.viewfinder",
            title:  "Train Each Tag",
            detail: "Walk to a tag and tap Train. Capture it from multiple angles — the app builds a visual reference it will compare against during every inspection."),
        OnboardingStep(
            icon:   "checkmark.circle.fill",
            title:  "Track Your Progress",
            detail: "Trained tags show a green checkmark. The progress bar at the bottom tells you how many tags are ready for inspection at a glance."),
        OnboardingStep(
            icon:   "qrcode",
            title:  "Share with the Team",
            detail: "Once all tags are trained, generate an encrypted QR code from the top bar. Share it with Operators — it contains the decryption key for this asset."),
    ]

    static let operatorMode: [OnboardingStep] = [
        OnboardingStep(
            icon:   "qrcode.viewfinder",
            title:  "Scan the Anchor QR",
            detail: "Point at the anchor QR code near the equipment. This locks the AR session — floating tag markers will appear in exactly the right locations."),
        OnboardingStep(
            icon:   "scope",
            title:  "Walk to Each Tag",
            detail: "Tag markers float in AR showing you where to look. Step into the alignment cone and hold steady — validation starts automatically."),
        OnboardingStep(
            icon:   "waveform.path.ecg",
            title:  "Watch the Live Status",
            detail: "As each tag validates you'll see live progress: capturing → connecting → comparing. No waiting, no guessing — you'll know the moment a result is in."),
        OnboardingStep(
            icon:   "checkmark.seal.fill",
            title:  "Review Results",
            detail: "Each tag shows PASS or FAIL with a confidence score. The summary panel at the bottom tracks overall status. Step away from a tag to see its last result."),
        OnboardingStep(
            icon:   "arrow.counterclockwise",
            title:  "Re-inspect if Needed",
            detail: "Tap 'Re-inspect Failed' to re-run only the failing tags — no need to repeat checks that already passed."),
    ]
}

// ── Sheet view ────────────────────────────────────────────────────────────────

struct OnboardingSheet: View {

    let context: OnboardingContext

    @Environment(\.dismiss) private var dismiss
    @State private var currentPage = 0

    /// Total pages = welcome (0) + content steps
    private var pageCount: Int { context.steps.count + 1 }

    var body: some View {
        ZStack {
            // Dark background — matches the app's AR chrome
            LinearGradient(
                colors: [Color(white: 0.06), Color(white: 0.10)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {

                // ── Top chrome: version label + Skip ──────────────────────
                HStack(alignment: .center) {
                    Text("v\(AppVersion.current)")
                        .font(.caption2.monospacedDigit())
                        .foregroundColor(.white.opacity(0.22))
                    Spacer()
                    if currentPage < pageCount - 1 {
                        Button("Skip") { dismiss() }
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.40))
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 4)

                // ── Swipeable pages ───────────────────────────────────────
                TabView(selection: $currentPage) {

                    // Welcome page (always first)
                    OnboardingWelcomePage(context: context)
                        .tag(0)

                    // Content step pages
                    ForEach(Array(context.steps.enumerated()), id: \.element.id) { i, step in
                        OnboardingStepPage(
                            step:   step,
                            accent: context.accentColor,
                            index:  i + 1,
                            total:  context.steps.count
                        )
                        .tag(i + 1)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .always))

                // ── Primary action button ─────────────────────────────────
                Button {
                    if currentPage < pageCount - 1 {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                            currentPage += 1
                        }
                    } else {
                        dismiss()
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text(currentPage < pageCount - 1 ? "Next" : "Get Started")
                            .font(.headline)
                        Image(systemName: currentPage < pageCount - 1
                              ? "chevron.right"
                              : "checkmark")
                            .font(.subheadline.bold())
                    }
                    .foregroundColor(
                        context.accentColor == .cyan ? Color.black : Color.white
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(context.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
                .animation(.easeInOut(duration: 0.15), value: currentPage)
            }
        }
    }
}

// ── Welcome page ──────────────────────────────────────────────────────────────

private struct OnboardingWelcomePage: View {
    let context: OnboardingContext

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Large icon in accent circle
            ZStack {
                Circle()
                    .fill(context.accentColor.opacity(0.14))
                    .frame(width: 116, height: 116)
                Circle()
                    .strokeBorder(context.accentColor.opacity(0.25), lineWidth: 1.5)
                    .frame(width: 116, height: 116)
                Image(systemName: context.welcomeIcon)
                    .font(.system(size: 52, weight: .semibold))
                    .foregroundStyle(context.accentColor)
            }
            .padding(.bottom, 32)

            // Title
            Text(context.welcomeTitle)
                .font(.largeTitle.bold())
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.bottom, 14)

            // Subtitle
            Text(context.welcomeSubtitle)
                .font(.body)
                .foregroundColor(.white.opacity(0.55))
                .multilineTextAlignment(.center)
                .lineSpacing(5)
                .padding(.horizontal, 12)

            Spacer()
            Spacer()
        }
        .padding(.horizontal, 32)
    }
}

// ── Step page ─────────────────────────────────────────────────────────────────

private struct OnboardingStepPage: View {
    let step:   OnboardingStep
    let accent: Color
    let index:  Int
    let total:  Int

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Icon in accent circle
            ZStack {
                Circle()
                    .fill(accent.opacity(0.14))
                    .frame(width: 96, height: 96)
                Circle()
                    .strokeBorder(accent.opacity(0.25), lineWidth: 1.5)
                    .frame(width: 96, height: 96)
                Image(systemName: step.icon)
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(accent)
            }
            .padding(.bottom, 28)

            // Step badge
            Text("Step \(index) of \(total)")
                .font(.caption.bold())
                .foregroundColor(accent)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(accent.opacity(0.12), in: Capsule())
                .padding(.bottom, 16)

            // Title
            Text(step.title)
                .font(.title2.bold())
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.bottom, 12)

            // Detail
            Text(step.detail)
                .font(.body)
                .foregroundColor(.white.opacity(0.55))
                .multilineTextAlignment(.center)
                .lineSpacing(5)
                .padding(.horizontal, 12)

            Spacer()
            Spacer()
        }
        .padding(.horizontal, 32)
    }
}
