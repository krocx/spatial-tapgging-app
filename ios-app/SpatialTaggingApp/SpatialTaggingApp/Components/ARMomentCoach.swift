// ARMomentCoach.swift — F1 (2026.4.46): in-session FTUE for AR OMS.
//
// The paged OnboardingSheet explains a mode BEFORE the camera is up; people
// forget it by the time a control matters. A "moment" is a single small card
// that appears over the live AR view the first time a control becomes
// relevant — first pin placed → "tap a pin to move it" — and never blocks
// the camera or the AR panels. One at a time; queued if another is showing.
//
// Memory is PER PERSON (employee ID), so a shared kiosk iPad still teaches
// the next technician. The ? icon opens GestureCheatSheet: every control of
// that screen with its glyph, plus "Replay tips" which re-arms the moments.
//
// Design philosophy: guided, exploratory, discoverable — the card teaches
// one thing, in one line, and gets out of the way.

import SwiftUI

// ── Moments ───────────────────────────────────────────────────────────────────

enum ARMoment: String, CaseIterable {
    // Place Steps in AR (author)
    case placeMovePin, placeModelGestures, placeAdjustSlots, placeTrainStep, placeDeclutter, placeSaveVsDone
    // Guide session (operator)
    case guideExpandPill, guidePanelButtons, guideOnePanel, guideValidation, guideHints, guideSignOff
    // Spatial Inspection author — the pulsing hand (ARTapCoach), remembered per person
    case inspectionPlaceTag

    enum Screen { case placeSteps, guideSession, inspectionAuthor }

    var screen: Screen {
        switch self {
        case .placeMovePin, .placeModelGestures, .placeAdjustSlots, .placeTrainStep, .placeDeclutter, .placeSaveVsDone:
            return .placeSteps
        case .inspectionPlaceTag:
            return .inspectionAuthor
        default:
            return .guideSession
        }
    }

    var icon: String {
        switch self {
        case .placeMovePin:       return "hand.tap.fill"
        case .placeModelGestures: return "hand.draw.fill"
        case .placeAdjustSlots:   return "cube.fill"
        case .placeTrainStep:     return "checkmark.seal.fill"
        case .placeDeclutter:     return "eye.fill"
        case .placeSaveVsDone:    return "tray.and.arrow.down.fill"
        case .guideExpandPill:    return "bubble.left.fill"
        case .guidePanelButtons:  return "checkmark.circle.fill"
        case .guideOnePanel:      return "eye.slash.fill"
        case .guideValidation:    return "scope"
        case .guideHints:         return "sparkles"
        case .guideSignOff:       return "signature"
        case .inspectionPlaceTag: return "hand.tap.fill"
        }
    }

    var title: String {
        switch self {
        case .placeMovePin:       return "Tap a pin to move it"
        case .placeModelGestures: return "Drag · pinch · twist"
        case .placeAdjustSlots:   return "Adjust any model later"
        case .placeTrainStep:     return "Train the step"
        case .placeDeclutter:     return "Declutter the view"
        case .placeSaveVsDone:    return "Save vs Done"
        case .guideExpandPill:    return "Tap the step pill to expand it"
        case .guidePanelButtons:  return "Complete · Skip · Evidence"
        case .guideOnePanel:      return "One panel at a time"
        case .guideValidation:    return "Line up with the ghost"
        case .guideHints:         return "Hints live here"
        case .guideSignOff:       return "Sign off"
        case .inspectionPlaceTag: return "Tap any surface to place a tag"
        }
    }

    var detail: String {
        switch self {
        case .placeMovePin:
            return "Tapping any placed pin makes that step active — your next tap on a surface re-places it."
        case .placeModelGestures:
            return "One finger drags the model, pinch scales it, twist rotates it. H/V flips drag to up-and-down."
        case .placeAdjustSlots:
            return "Tap ⬢1 ⬢2 ⬢3 under a step to position that model on its own — no need to re-drop the pin."
        case .placeTrainStep:
            return "Seal = cone sweep from several angles (most robust). Camera = one shot from where you stand."
        case .placeDeclutter:
            return "The eye hides every other step; the cube hides this step's models while you move its pin."
        case .placeSaveVsDone:
            return "Save keeps you here and uploads pins. Done saves, captures the reference and seals the map."
        case .guideExpandPill:
            return "The pill shows the title. Tap it for the full instruction, photo and audio; tap ⌄ to minimise."
        case .guidePanelButtons:
            return "✓ marks the step complete, ✕ skips it, 📷 attaches evidence. ••• has the rest."
        case .guideOnePanel:
            return "The eye toggle hides the other steps' panels so only the one you're on stays up."
        case .guideValidation:
            return "Match the ghost photo — it captures by itself when aligned. Capture anyway appears after 8 s."
        case .guideHints:
            return "The ✨ chip is an assist. Tap to read it; dismissed hints stay in the tray."
        case .guideSignOff:
            return "Your name is prefilled from the shift login. Review, then sign — the log carries the evidence."
        case .inspectionPlaceTag:
            return "Point at a flat surface and tap. A placement sheet opens for the label and type."
        }
    }
}

// ── Memory (per employee) ─────────────────────────────────────────────────────

enum ARMomentStore {
    private static func key(_ m: ARMoment, employeeId: String) -> String {
        let who = employeeId.trimmingCharacters(in: .whitespaces).isEmpty ? "device" : employeeId
        return "ftue.moment.\(m.rawValue).\(who)"
    }
    static func seen(_ m: ARMoment, employeeId: String) -> Bool {
        UserDefaults.standard.bool(forKey: key(m, employeeId: employeeId))
    }
    static func markSeen(_ m: ARMoment, employeeId: String) {
        UserDefaults.standard.set(true, forKey: key(m, employeeId: employeeId))
    }
    /// "Replay tips": forget every moment of one screen for this person.
    static func reset(screen: ARMoment.Screen, employeeId: String) {
        for m in ARMoment.allCases where m.screen == screen {
            UserDefaults.standard.removeObject(forKey: key(m, employeeId: employeeId))
        }
    }
}

// ── Coach (state + card) ──────────────────────────────────────────────────────

/// Owns the queue. Views call `show(.x)` at the trigger point; the coach
/// drops moments already seen and shows the rest one at a time.
@MainActor
final class ARMomentCoach: ObservableObject {
    @Published private(set) var current: ARMoment? = nil
    private var queue: [ARMoment] = []
    private let employeeId: () -> String

    init(employeeId: @escaping () -> String) { self.employeeId = employeeId }

    func show(_ m: ARMoment) {
        guard !ARMomentStore.seen(m, employeeId: employeeId()),
              current != m, !queue.contains(m) else { return }
        if current == nil { withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { current = m } }
        else { queue.append(m) }
    }

    func dismiss() {
        if let c = current { ARMomentStore.markSeen(c, employeeId: employeeId()) }
        withAnimation(.easeIn(duration: 0.2)) { current = nil }
        guard !queue.isEmpty else { return }
        let next = queue.removeFirst()
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { current = next }
        }
    }

    func replay(screen: ARMoment.Screen) {
        ARMomentStore.reset(screen: screen, employeeId: employeeId())
        queue.removeAll()
        current = nil
    }
}

/// The card. Bottom-centre, above the screen's own bottom UI (`bottomInset`).
struct ARMomentCard: View {
    @ObservedObject var coach: ARMomentCoach
    var bottomInset: CGFloat = 140
    var accent: Color = .indigo

    var body: some View {
        VStack {
            Spacer()
            if let m = coach.current {
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle().fill(accent.opacity(0.22)).frame(width: 40, height: 40)
                        Image(systemName: m.icon).font(.system(size: 18, weight: .semibold)).foregroundStyle(accent)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(m.title).font(.subheadline.bold()).foregroundStyle(.white)
                        Text(m.detail).font(.caption).foregroundStyle(.white.opacity(0.78))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 4)
                    Button { coach.dismiss() } label: {
                        Text("Got it").font(.caption.bold())
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(accent, in: Capsule()).foregroundStyle(.white)
                    }
                }
                .padding(14)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(accent.opacity(0.45), lineWidth: 1))
                .padding(.horizontal, 16)
                .padding(.bottom, bottomInset)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .accessibilityElement(children: .combine)
            }
        }
        .allowsHitTesting(coach.current != nil)
    }
}

// ── Cheat-sheet (the ? sheet) ─────────────────────────────────────────────────

/// Every control of one screen, with its glyph, plus Replay tips. The paged
/// OnboardingSheet stays reachable as "Overview" so nothing in the flow moves.
struct GestureCheatSheet: View {
    let screen: ARMoment.Screen
    let coach: ARMomentCoach
    var onOverview: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss

    private var moments: [ARMoment] { ARMoment.allCases.filter { $0.screen == screen } }
    private var title: String { screen == .placeSteps ? "Place Steps — controls" : "Guide session — controls" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(Array(moments.enumerated()), id: \.element) { i, m in
                        HelpStepCard(step: HelpStep(icon: m.icon, title: m.title, detail: m.detail), index: i + 1)
                    }
                    Button {
                        coach.replay(screen: screen)
                        dismiss()
                    } label: {
                        Label("Replay tips in this session", systemImage: "arrow.counterclockwise")
                            .font(.subheadline.bold())
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 6)
                    if let onOverview {
                        Button { dismiss(); onOverview() } label: {
                            Label("Show the overview again", systemImage: "book")
                                .font(.subheadline)
                                .frame(maxWidth: .infinity).padding(.vertical, 10)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
