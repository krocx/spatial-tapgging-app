// AuthorModeView.swift — Phase 3
// Full-screen AR Author mode: tap on any detected surface to place a tag.
//
// Phase 3 entry contract:
//   • appState.activeAnchor and appState.activeTags are pre-loaded by AnchorHubView.
//   • appState.anchorNormalisedTransform is already set by QRScanGateView.
//   • appState.anchorEncryptionKey is already set by QRScanGateView.
//
// No QR scanning happens inside Author mode — the session origin was locked at entry.
//
// Screen mapping (wireframe v2):
//   Screen 6  — AR placement (this view, normal state)
//   Screen 7  — AddTagSheet (Train now / Save & train later)
//   Screen 8  — Tag list sheet (compact dark sheet, Train → navigates)
//   Screen 9  — Tag navigation in AR (pulsing target, distance pill, Start training)

import SwiftUI
import ARKit
import SceneKit
import simd
import Combine

struct AuthorModeView: View {

    /// Tag Groups: when set, new tags placed in this session are assigned to this Inspection Set.
    /// Nil = session is not group-scoped (legacy flat flow or Loc-Tag walk).
    var groupId: String? = nil

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var appState:  AppState
    @EnvironmentObject private var tour:      GuidedTourManager

    @StateObject private var arManager = ARSessionManager()

    // ── Tap-to-place ──────────────────────────────────────────────────────────
    // #62: placement is presented via .sheet(item:) instead of a separate
    // Bool + optional position pair. With two independent @State vars, the
    // sheet's content closure could occasionally be built from a stale
    // pre-update snapshot the first time it ever presented in this view's
    // lifecycle (handleTap is invoked from a UIKit gesture callback outside
    // SwiftUI's normal render cycle) — AddTagSheet would receive
    // placement == nil and show "No surface detected" even though a valid
    // raycast hit had just been captured. Closing and tapping again worked
    // because the second presentation no longer raced. Driving the sheet
    // off a single Identifiable item makes that nil-placement state
    // unrepresentable: the sheet can only appear already holding real data.
    private struct PendingPlacement: Identifiable {
        let id = UUID()
        let position: SIBVector3
    }
    @State private var pendingPlacement: PendingPlacement? = nil
    private var pendingPosition: SIBVector3? { pendingPlacement?.position }
    @State private var pendingNode:     SCNNode?    = nil
    @State private var tagSaved         = false

    // ── Sheets / covers ───────────────────────────────────────────────────────
    @State private var showTagList     = false
    @State private var captureTag:     Tag? = nil
    @State private var editTag:        Tag? = nil
    @State private var showQRGenerator = false
    @State private var showHelpSheet   = false   // kept for legacy; use showOnboarding
    @State private var showOnboarding  = false

    // ── Contextual in-AR hint ─────────────────────────────────────────────────
    /// Animated tap hint (ARTapCoach). F1b (2026.4.46): shown on an empty
    /// anchor, and otherwise once per person (employee ID) — so a returning
    /// anchor still teaches a new author. Dismissed on first tap or after 8 s.
    @State private var showTapHint = true
    private var tapHintSeen: Bool {
        ARMomentStore.seen(.inspectionPlaceTag, employeeId: settings.employeeId)
    }

    // ── Tag navigation (Screen 9) ──────────────────────────────────────────────
    /// Non-nil while the author is walking toward a specific tag to train.
    @State private var navigatingToTag:  Tag?   = nil
    @State private var distanceToTagM:   Float? = nil

    // ── G3: network error toast ────────────────────────────────────────────────
    @State private var networkErrorMsg: String? = nil

    // ── Info toast (non-error, explanatory) ──────────────────────────────────
    // Used e.g. to explain the silent "Train" → re-anchor redirect (#70) so it
    // reads as expected behavior rather than the app appearing broken.
    @State private var infoMsg: String? = nil

    // ── AR marker registry ────────────────────────────────────────────────────
    @State private var persistedNodes: [String: SCNNode] = [:]
    // G3 (2026.4.46): focus mode — show only the tag being worked on (the one
    // just placed, being trained, or navigated to). Default ON, per person.
    @State private var focusCurrentOnly: Bool = FocusPref.load(screen: "inspectionAuthor")
    @State private var focusTagId: String? = nil
    // G2: delete every tag of this anchor at once
    @State private var showDeleteAllConfirm = false

    // ── Re-anchor flow ────────────────────────────────────────────────────────
    /// Non-nil when the author has asked to re-place a position-wiped tag.
    /// The next tap in AR will restore anchor_rel_x/y/z for this tag.
    @State private var reanchorTag: Tag? = nil
    // When true, the next reanchor tap (from navigateToTag's auto-redirect)
    // should immediately start training once the position is restored, so
    // tapping "Train →" on an unpositioned tag never silently trains it
    // with zero position data.
    @State private var pendingTrainAfterReanchor = false
    // Guards against showing the auto-reanchor banner more than once per
    // appearance — the user can dismiss it and we shouldn't re-show
    // immediately on the next anchor refinement tick.
    @State private var autoReanchorPromptShown = false

    // ── 3D focus ring (iOS Measure App-style surface-tracking crosshair) ──────
    @State private var focusRing: ARFocusRing? = nil
    // Tour: baseline tag count recorded at first appear; advance only when a NEW tag is added
    @State private var tourBaselineTagCount: Int = -1
    private let crosshairTicker = Timer.publish(every: 0.10, on: .main, in: .common).autoconnect()

    // ── P5: presence (colleagues in front of this chamber) ───────────────────
    // Poses are shared in the QR FRAME (tags are QR-relative): mine is
    // inverse(anchorPose) × camera; theirs render as anchorPose × pose. Works
    // across two physical units of the same chamber type when the object is
    // the origin (the QR frame is then derived from the chamber's shape).
    @State private var presence:       PresenceService? = nil
    @State private var presenceLayer:  PresenceLayer?   = nil
    @State private var presenceBag:    Set<AnyCancellable> = []
    @State private var presenceOthers: [PresenceEntry] = []
    @State private var presenceLinked  = false
    @State private var presenceToast:  (text: String, color: UIColor)? = nil
    @State private var presenceFocus   = PresenceFocusBox()

    // ── Body ──────────────────────────────────────────────────────────────────

    var body: some View {
        ZStack(alignment: .top) {

            // Full-screen AR camera
            ARContainerView(arManager: arManager, onTap: handleTap)
                .ignoresSafeArea()
                .onAppear {
                    // Always (re)create the focus ring — it may have been cleaned up.
                    if focusRing == nil {
                        focusRing = ARFocusRing(sceneView: arManager.sceneView)
                    }

                    // ── Returning from training fullScreenCover ────────────────
                    // When captureTag was set, onDisappear kept the session alive
                    // and did NOT clear activeARSession.  persistedNodes is already
                    // populated and the session is still running — nothing to do.
                    guard persistedNodes.isEmpty else {
                        arManager.disableQRScanning()
                        return
                    }

                    // ── True first appearance ──────────────────────────────────
                    // Tour: record how many tags already exist so placeTag only
                    // advances when a GENUINELY new tag is added in this session.
                    if tourBaselineTagCount < 0 {
                        tourBaselineTagCount = appState.activeTags.count
                    }
                    if let existingSession = appState.activeARSession {
                        // QRScanGateView kept its ARSession alive; link to it so
                        // we skip world-frame reset and keep the live ARImageAnchor.
                        arManager.linkToExistingSession(existingSession, mapOrigin: appState.sealedMapOrigin,
                                                objectCalibration: appState.objectCalibration)
                        arManager.disableQRScanning()
                    } else {
                        // Fallback: no shared session (legacy / direct launch).
                        arManager.startSession()
                        arManager.lockedAnchorTransform = appState.anchorNormalisedTransform
                        arManager.disableQRScanning()
                    }
                    // Place markers immediately; repositionPersistedNodes() will
                    // smooth-correct them once the live ARImageAnchor fires (~150 ms).
                    showExistingMarkers()
                    Task { await autoAnchorUnpositionedTags() }
                    autoPromptForBrokenTags()
                    startPresence()
                    // Prefer the SIB-stored key (canonical); fall back to Keychain / generate.
                    if let anchor = appState.activeAnchor, appState.anchorEncryptionKey == nil {
                        if let storedB64 = anchor.encryptionKey,
                           let key = AnchorEncryption.key(fromBase64: storedB64) {
                            appState.anchorEncryptionKey = key
                        } else {
                            appState.anchorEncryptionKey = AnchorEncryption.getOrCreateKey(for: anchor.id)
                        }
                    }
                }
                .onDisappear {
                    focusRing?.cleanup()
                    focusRing = nil
                    // captureTag != nil → training fullScreenCover is appearing.
                    // Keep the session alive: ConeCaptureView reuses parentArManager's
                    // session (svHolder.sceneView.session = parentArManager.sceneView.session),
                    // and onAppear skips re-setup when persistedNodes is non-empty.
                    guard captureTag == nil else { return }
                    // True navigation away from Author mode — release the session.
                    stopPresence()
                    arManager.pauseSession()
                    appState.activeARSession = nil
                }
                // ── Live anchor refinement ────────────────────────────────────
                // Fires each time processImageAnchors pushes a new normalised
                // transform from the continuously-tracked ARImageAnchor.
                // Keep AppState in sync and reposition all tag nodes.
                .onChange(of: arManager.lockedAnchorTransform) { newTransform in
                    guard let t = newTransform else { return }
                    appState.anchorNormalisedTransform = t
                    presenceLayer?.worldFromShared = t
                    presenceLayer?.update(presenceOthers)
                    // Retry marker placement now that the anchor is ready — tags
                    // that only had anchor_rel_x/y/z (no legacy pos_x/y/z) are
                    // skipped by showExistingMarkers() until toWorldSpace() can
                    // resolve, which requires this transform. Without this retry,
                    // a tag could silently never get a marker for the rest of
                    // the session purely due to anchor-detection timing.
                    showExistingMarkers()
                    repositionPersistedNodes()
                    Task {
                        await autoAnchorUnpositionedTags()
                        autoPromptForBrokenTags()
                    }
                }
                // #69: a phone call / Control Center / app-switch interruption
                // freezes the camera feed without tearing down the session.
                // Surface it so a tap-to-place or training capture made right
                // after tracking resumes isn't silently trusted against a
                // possibly stale anchor pose.
                .onChange(of: arManager.isInterrupted) { interrupted in
                    if interrupted {
                        infoMsg = "Session interrupted — placement paused."
                    } else {
                        infoMsg = "Tracking resumed — re-check tag positions before training."
                        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                            if infoMsg?.hasPrefix("Tracking resumed") == true { infoMsg = nil }
                        }
                    }
                }

            // Top bar (Screen 6)
            topBar

            // Network error toast
            if let errMsg = networkErrorMsg {
                VStack {
                    Spacer().frame(height: 100)
                    HStack(spacing: 10) {
                        Image(systemName: "wifi.exclamationmark").foregroundStyle(.white)
                        Text(errMsg).font(.caption.bold()).foregroundStyle(.white).lineLimit(2)
                        Spacer()
                        Button { networkErrorMsg = nil } label: {
                            Image(systemName: "xmark").font(.caption).foregroundStyle(.white.opacity(0.7))
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 16)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.easeInOut(duration: 0.3), value: networkErrorMsg != nil)
            }

            // Info toast — explanatory, non-error (e.g. #70 redirect notice)
            if let msg = infoMsg {
                VStack {
                    Spacer().frame(height: 100)
                    HStack(spacing: 10) {
                        Image(systemName: "info.circle").foregroundStyle(.white)
                        Text(msg).font(.caption.bold()).foregroundStyle(.white).lineLimit(2)
                        Spacer()
                        Button { infoMsg = nil } label: {
                            Image(systemName: "xmark").font(.caption).foregroundStyle(.white.opacity(0.7))
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color.blue.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 16)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.easeInOut(duration: 0.3), value: infoMsg != nil)
            }

            // Note: 3D focus ring (ARFocusRing) is rendered directly in the AR
            // scene — no 2D overlay needed here.

            // ── Re-anchor banner ──────────────────────────────────────────────
            // Shown while the author needs to tap the tag's physical location
            // to restore position data that was wiped by a server metadata replace.
            if let tag = reanchorTag {
                VStack {
                    HStack(spacing: 10) {
                        Image(systemName: "mappin.and.ellipse")
                            .font(.subheadline).foregroundStyle(.orange)
                        Text("Tap where \"\(tag.label)\" is to restore its position")
                            .font(.caption.bold()).foregroundStyle(.white).lineLimit(2)
                        Spacer()
                        Button {
                            reanchorTag = nil
                            pendingTrainAfterReanchor = false
                        } label: {
                            Image(systemName: "xmark")
                                .font(.caption).foregroundStyle(.white.opacity(0.6))
                        }
                        // Explicitly re-enabled: the banner's own .allowsHitTesting(false)
                        // (added so AR taps pass through to place/re-anchor) was also
                        // disabling this dismiss button, making it unreachable. (#68)
                        .allowsHitTesting(true)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color.orange.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 16)
                    .padding(.top, 100)
                    .allowsHitTesting(true)
                    Spacer()
                        .allowsHitTesting(false)
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.easeInOut(duration: 0.3), value: reanchorTag?.id)
            }

            // Bottom panel — switches between placement and navigation mode
            VStack {
                Spacer()
                if navigatingToTag != nil {
                    navigationBottomPanel
                } else {
                    placementBottomPanel
                }
            }

            // ── Tap hint — appears on first entry when anchor has no tags yet ──
            if showTapHint && (appState.activeTags.isEmpty || !tapHintSeen) && navigatingToTag == nil {
                ARTapCoach(accent: .white) {
                    ARMomentStore.markSeen(.inspectionPlaceTag, employeeId: settings.employeeId)
                    withAnimation(.easeOut(duration: 0.3)) { showTapHint = false }
                }
                .transition(.opacity.combined(with: .scale(scale: 0.94)))
                .animation(.easeInOut(duration: 0.35), value: showTapHint)
            }
        }
        .onReceive(crosshairTicker) { _ in
            updateCrosshair()
            if navigatingToTag != nil { updateDistanceToNavigatingTag() }
        }

        // ── Placement sheet (Screen 7) ─────────────────────────────────────────
        // #62: .sheet(item:) — see PendingPlacement declaration for why.
        .sheet(item: $pendingPlacement, onDismiss: {
            if !tagSaved {
                pendingNode?.removeFromParentNode()
                pendingNode = nil
            }
            tagSaved = false
        }) { placement in
            if let anchor = appState.activeAnchor {
                AddTagSheet(
                    anchor: anchor,
                    placement: placement.position,
                    onSaveAndTrain: { newTag in
                        tagSaved = true
                        if let node = pendingNode { upgradeMarker(node, forTagId: newTag.id, trained: false) }
                        pendingNode = nil
                        appState.activeTags.append(newTag)
                        appState.saveLastAuthorSession()
                        pendingPlacement = nil
                        // Delay so the sheet finishes dismissing before the cover appears
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            captureTag = newTag
                        }
                    },
                    onSaveAndDefer: { newTag in
                        tagSaved = true
                        if let node = pendingNode { upgradeMarker(node, forTagId: newTag.id, trained: false) }
                        pendingNode = nil
                        appState.activeTags.append(newTag)
                        appState.saveLastAuthorSession()
                        pendingPlacement = nil
                    },
                    groupId: groupId
                )
                .environmentObject(settings)
                .environmentObject(appState)
            }
        }

        // ── Tag list sheet (Screen 8) ──────────────────────────────────────────
        .sheet(isPresented: $showTagList) {
            tagListSheet
                .environmentObject(settings)
                .environmentObject(appState)
        }

        // ── Edit tag sheet ─────────────────────────────────────────────────────
        .sheet(item: $editTag) { tag in
            EditTagSheet(
                tag: tag,
                onSaved: { updatedTag in
                    if let idx = appState.activeTags.firstIndex(where: { $0.id == updatedTag.id }) {
                        appState.activeTags[idx] = updatedTag
                    }
                    editTag = nil
                },
                onRetrain: {
                    editTag = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        captureTag = tag
                    }
                }
            )
            .environmentObject(settings)
            .environmentObject(appState)
        }

        // ── QR generator ──────────────────────────────────────────────────────
        .sheet(isPresented: $showQRGenerator) {
            if let anchor = appState.activeAnchor {
                // Rule: once a QR is generated it must be identical every time.
                // Priority: SIB-stored key (canonical base64 string set at anchor
                // creation) → in-memory session key → Keychain / generate.
                // Single `let` with ?? chaining is valid inside @ViewBuilder.
                let keyB64 = anchor.encryptionKey
                    ?? AnchorEncryption.base64(for:
                        appState.anchorEncryptionKey
                        ?? AnchorEncryption.getOrCreateKey(for: anchor.id))
                QRGeneratorView(
                    anchor:        anchor,
                    encryptionKey: keyB64,
                    qrSizeCm:      anchor.qrSizeCm ?? 10.0
                )
            }
        }

        // ── Help / FTUE ───────────────────────────────────────────────────────
        // Auto-show is handled by AnchorDirectoryView (fires when mode is selected).
        // This sheet is kept so the ? button inside AR always works too.
        .sheet(isPresented: $showOnboarding) {
            OnboardingSheet(context: .author)
        }

        // ── Training cover — routes by TagCaptureMode ──────────────────────────
        .onChange(of: captureTag?.id) { id in
            if let id { focusTagId = id; applyTagVisibility() }   // G3: training → current
        }
        .confirmationDialog("Delete all \(appState.activeTags.count) tag\(appState.activeTags.count == 1 ? "" : "s")?",
                            isPresented: $showDeleteAllConfirm, titleVisibility: .visible) {
            Button("Delete all tags", role: .destructive) { showTagList = false; deleteAllTags() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Removes every tag and its training from this anchor. The world map and QR stay. This cannot be undone.")
        }
        .fullScreenCover(item: $captureTag) { tag in
            if let anchor = appState.activeAnchor {
                let onTrained: (String) -> Void = { tagId in
                    appState.trainedTagIds.insert(tagId)
                    appState.saveLastAuthorSession()
                    if let node = persistedNodes[tagId] {
                        upgradeMarker(node, forTagId: tagId, trained: true)
                    }
                    // Tour: after first successful training, advance past trainTag
                    tour.advancePast(.trainTag)
                }
                switch tag.type.captureMode {
                case .honeycomb:
                    HoneycombCaptureView(tag: tag, anchor: anchor,
                                         parentArManager: arManager, onTrained: onTrained)
                        .environmentObject(settings).environmentObject(appState)
                        .environmentObject(tour)
                case .cone:
                    ConeCaptureView(tag: tag, anchor: anchor,
                                    parentArManager: arManager, onTrained: onTrained)
                        .environmentObject(settings).environmentObject(appState)
                        .environmentObject(tour)
                case .ocr:
                    OCRCaptureView(tag: tag, anchor: anchor,
                                   parentArManager: arManager, onTrained: onTrained)
                        .environmentObject(settings).environmentObject(appState)
                        .environmentObject(tour)
                }
            }
        }
        // ── R1: chamber moved? pill / re-align toast + Undo / manual finder ────
        .overlay {
            ObjectTrackOverlay(arManager: arManager, topInset: 100, bottomInset: 200)
                .allowsHitTesting(arManager.objectTrackState != .idle)
        }
        // ── P5: presence overlays ──────────────────────────────────────────────
        .overlay(alignment: .topTrailing) {
            if !presenceOthers.isEmpty {
                PresenceRosterChip(others: presenceOthers, connected: presenceLinked)
                    .padding(.top, 64).padding(.trailing, 12)
            }
        }
        .overlay { if !presenceOthers.isEmpty { PresenceEdgeArrows(others: presenceOthers, sceneView: arManager.sceneView) } }
        .overlay(alignment: .top) {
            if let t = presenceToast { PresenceToast(text: t.text, color: t.color).padding(.top, 104) }
        }
        .animation(.easeInOut(duration: 0.25), value: presenceToast?.text)
        .onChange(of: focusTagId) { id in presenceFocus.stepId = id }
        // ── Tour banners (Author steps) ────────────────────────────────────────
        .overlay {
            let authorStep = tour.currentStep
            if tour.isActive && (authorStep == .placeTag || authorStep == .trainTag) {
                CoachMarkOverlay(
                    step:       authorStep,
                    targetRect: nil,
                    ownerName:  tour.ownerName,
                    onNext:     { tour.advance() },
                    onSkip:     { tour.skip() }
                )
                .ignoresSafeArea()
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: authorStep)
            }
        }
        // Tour: advance from placeTag → trainTag when a NEW tag is placed in this session.
        // Compare against tourBaselineTagCount (set at first appear) to avoid spuriously
        // advancing when returning to an anchor that already had tags.
        .onChange(of: appState.activeTags.count) { count in
            let baseline = tourBaselineTagCount >= 0 ? tourBaselineTagCount : 0
            if count > baseline { tour.advancePast(.placeTag) }
        }
    }

    // ── Top bar (Screen 6) ────────────────────────────────────────────────────

    private var topBar: some View {
        HStack(alignment: .center) {
            // Done — exits session, saves state
            Button("Done") {
                appState.saveLastAuthorSession()
                arManager.pauseSession()
                appState.reset()
                appState.mode = .none
            }
            .font(.body)
            .foregroundStyle(.white.opacity(0.85))

            Spacer()

            // Anchor asset ID
            if let anchor = appState.activeAnchor {
                Text(anchor.assetId)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer()

            // G3: eye — only the current tag (default) vs all tags
            Button {
                focusCurrentOnly.toggle()
                FocusPref.save(screen: "inspectionAuthor", value: focusCurrentOnly)
                applyTagVisibility()
            } label: {
                Image(systemName: focusCurrentOnly ? "eye.slash.fill" : "eye.fill")
                    .font(.body)
                    .foregroundStyle(focusCurrentOnly ? .yellow : .white.opacity(0.85))
            }
            .accessibilityLabel(focusCurrentOnly ? "Show all tags" : "Show only the current tag")
            .padding(.trailing, 12)

            // Tag list
            Button("Tag list") { showTagList = true }
                .font(.body)
                .foregroundStyle(.blue)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .padding(.top, 4)
        .background(.ultraThinMaterial.opacity(0.85))
    }

    // ── Placement bottom panel (Screen 6) ─────────────────────────────────────

    private var placementBottomPanel: some View {
        VStack(spacing: 8) {
            // Origin + tag count status line
            if !appState.activeTags.isEmpty {
                HStack(spacing: 6) {
                    Circle().fill(.green).frame(width: 7, height: 7)
                    Text("Origin locked · \(appState.activeTags.count) tag\(appState.activeTags.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.65))
                    Spacer()
                    // Training progress
                    let trained = appState.trainedTagIds.count
                    let total   = appState.activeTags.count
                    if trained < total {
                        Text("\(trained)/\(total) trained")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.4))
                    } else {
                        Label("All trained", systemImage: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                }
                .padding(.horizontal, 4)
            }

            // Instruction + FAB
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "hand.tap.fill")
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.9))
                    Text("Tap a surface to place a tag")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                    Spacer()
                }
                .padding(.vertical, 12)
                .padding(.horizontal, 14)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                // FAB — places a tag using the focus ring's cached surface hit
                // (more precise than a fresh centre-screen raycast)
                Button {
                    if let hitT = focusRing?.lastHitTransform {
                        let col = hitT.columns.3
                        placePendingMarker(
                            worldPos: simd_float3(col.x, col.y, col.z),
                            sibPos:   SIBVector3(x: Double(col.x),
                                                  y: Double(col.y),
                                                  z: Double(col.z))
                        )
                    } else {
                        // Fallback: re-raycast from screen centre
                        let sv = arManager.sceneView
                        handleTap(at: CGPoint(x: sv.bounds.midX, y: sv.bounds.midY))
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.title3.bold())
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .background(.blue, in: Circle())
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 40)
    }

    // ── Navigation bottom panel (Screen 9) ────────────────────────────────────

    @ViewBuilder
    private var navigationBottomPanel: some View {
        if let tag = navigatingToTag {
            VStack(spacing: 10) {
                // Tag identity + distance
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(tag.type.color.opacity(0.18))
                            .frame(width: 38, height: 38)
                        Image(systemName: tag.type.iconName)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(tag.type.color)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tag.label)
                            .font(.headline)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Text("Walk to the highlighted tag")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    Spacer()
                    if let d = distanceToTagM {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(String(format: "%.1f m", d))
                                .font(.headline.monospacedDigit())
                                .foregroundStyle(d < 1.5 ? .green : .orange)
                            if d < 1.5 {
                                Text("close enough")
                                    .font(.system(size: 9, weight: .medium))
                                    .foregroundStyle(.green)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)

                // "Start training" button
                Button {
                    let target = tag
                    clearNavigationHighlight()
                    navigatingToTag  = nil
                    distanceToTagM   = nil
                    captureTag       = target
                } label: {
                    Label("Start training", systemImage: "play.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(.blue)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
                .padding(.horizontal, 16)

                // Back to tag list
                Button {
                    clearNavigationHighlight()
                    navigatingToTag = nil
                    distanceToTagM  = nil
                    showTagList     = true
                } label: {
                    Text("‹ Tag list")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.4))
                }
                .padding(.bottom, 4)
            }
            .padding(.top, 14)
            .padding(.bottom, 34)
            .background(.ultraThinMaterial)
        }
    }

    // ── Tag list sheet (Screen 8) ──────────────────────────────────────────────

    private var tagListSheet: some View {
        VStack(spacing: 0) {
            // Drag handle
            Capsule()
                .fill(.white.opacity(0.18))
                .frame(width: 38, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 14)

            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tags — \(appState.activeAnchor?.assetId ?? "")")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                    let trained = appState.trainedTagIds.count
                    let total   = appState.activeTags.count
                    Text("\(trained) of \(total) trained")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                HStack(spacing: 14) {
                    // G2: delete every tag of this anchor
                    if !appState.activeTags.isEmpty {
                        Button { showDeleteAllConfirm = true } label: {
                            Image(systemName: "trash")
                                .font(.subheadline)
                                .foregroundStyle(.red.opacity(0.8))
                        }
                        .accessibilityLabel("Delete all tags")
                    }
                    Button { showQRGenerator = true; showTagList = false } label: {
                        Image(systemName: "qrcode")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    Button {
                        // F1b: ? also replays the tap coach after the sheet closes.
                        ARMomentStore.reset(screen: .inspectionAuthor, employeeId: settings.employeeId)
                        showTapHint = true
                        showOnboarding = true; showTagList = false
                    } label: {
                        Image(systemName: "questionmark.circle")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    Button { showTagList = false } label: {
                        Image(systemName: "xmark")
                            .font(.caption.bold())
                            .foregroundStyle(.white.opacity(0.45))
                            .padding(6)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            Divider().background(.white.opacity(0.08))

            if appState.activeTags.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "tag.slash")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No tags yet")
                        .foregroundStyle(.secondary)
                    Text("Tap a surface in AR to place your first tag.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            } else {
                List {
                    ForEach(appState.activeTags) { tag in
                        tagListRow(tag)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                            // Swipe: edit
                            .swipeActions(edge: .leading) {
                                Button {
                                    showTagList = false
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                                        editTag = tag
                                    }
                                } label: { Label("Edit", systemImage: "pencil") }
                                .tint(.blue)
                            }
                            // Swipe: delete
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    deleteTag(tag)
                                } label: { Label("Delete", systemImage: "trash") }
                            }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }

            // Hint
            Text("Tap Train to navigate to that tag in AR")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.28))
                .padding(.vertical, 10)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
        .presentationBackground(Color(red: 0.067, green: 0.067, blue: 0.11))
    }

    // ── Tag list row ──────────────────────────────────────────────────────────

    private func tagListRow(_ tag: Tag) -> some View {
        let isTrained    = appState.trainedTagIds.contains(tag.id)
        let hasPosition  = persistedNodes[tag.id] != nil
        return HStack(spacing: 12) {
            // Type icon
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(tag.type.color.opacity(0.14))
                    .frame(width: 32, height: 32)
                Image(systemName: tag.type.iconName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tag.type.color)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(tag.label)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text(tag.type.displayName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    // Warn when training data is present but position was wiped
                    if isTrained && !hasPosition {
                        Text("· No position")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }

            Spacer()

            if isTrained && !hasPosition {
                // Trained but position wiped — offer re-placement
                Button {
                    showTagList = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        reanchorTag = tag
                    }
                } label: {
                    Text("Re-place")
                        .font(.caption.bold())
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.orange.opacity(0.14), in: Capsule())
                }
                .buttonStyle(.plain)
            } else if isTrained {
                Label("Trained", systemImage: "checkmark.circle.fill")
                    .font(.caption.bold())
                    .foregroundStyle(.green)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.green.opacity(0.10), in: Capsule())
            } else {
                Button {
                    showTagList = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) {
                        navigateToTag(tag)
                    }
                } label: {
                    Text("Train →")
                        .font(.caption.bold())
                        .foregroundStyle(.blue)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.blue.opacity(0.14), in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
    }

    // ── Tap handler ───────────────────────────────────────────────────────────

    private func handleTap(at screenPoint: CGPoint) {
        // Dismiss tap hint on first interaction regardless of outcome
        if showTapHint {
            ARMomentStore.markSeen(.inspectionPlaceTag, employeeId: settings.employeeId)
            withAnimation(.easeOut(duration: 0.3)) { showTapHint = false }
        }
        guard pendingPlacement == nil else { return }
        let sv = arManager.sceneView

        // Resolve world position via modern raycast (preferred) or legacy hitTest.
        let worldPos: simd_float3?
        if let query  = sv.raycastQuery(from: screenPoint, allowing: .estimatedPlane, alignment: .any),
           let result = sv.session.raycast(query).first {
            let c = result.worldTransform.columns.3
            worldPos = simd_float3(c.x, c.y, c.z)
        } else if let hit = sv.hitTest(screenPoint,
                     types: [.existingPlaneUsingExtent, .estimatedHorizontalPlane, .featurePoint]).first {
            let c = hit.worldTransform.columns.3
            worldPos = simd_float3(c.x, c.y, c.z)
        } else {
            worldPos = nil
        }

        guard let wp = worldPos else { return }

        // ── Re-anchor path ────────────────────────────────────────────────────
        // Active when the author tapped "Re-place" for a position-wiped tag.
        if let tag = reanchorTag {
            reanchorTag = nil
            restoreTagPosition(tag, at: wp)
            if pendingTrainAfterReanchor {
                pendingTrainAfterReanchor = false
                // Give restoreTagPosition's marker/UI update a beat before
                // launching the training fullScreenCover.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    captureTag = tag
                }
            }
            return
        }

        // ── Normal placement path ─────────────────────────────────────────────
        placePendingMarker(
            worldPos: wp,
            sibPos:   SIBVector3(x: Double(wp.x), y: Double(wp.y), z: Double(wp.z))
        )
    }

    /// Restores anchor_rel_x/y/z for a tag whose position was wiped by a
    /// server metadata replace.  Sends a full UpdateTagRequest (seeded from
    /// tag.metadata) so training data is never lost in the process.
    private func restoreTagPosition(_ tag: Tag, at worldPos: simd_float3) {
        guard let rel = appState.toAnchorRelative(worldPos) else {
            print("[Author] restoreTagPosition: anchorNormalisedTransform nil — cannot restore")
            return
        }
        // Add the node immediately for visual feedback.
        let trained   = appState.trainedTagIds.contains(tag.id)
        let typeColor = UIColor(tag.type.color)
        let node      = makeTagMarker(color: typeColor, trained: trained)
        node.simdPosition = worldPos
        arManager.sceneView.scene.rootNode.addChildNode(node)
        persistedNodes[tag.id] = node
        focusTagId = tag.id; applyTagVisibility()   // G3

        // Patch position keys onto the existing metadata (preserves training data).
        var meta = tag.metadata
        meta["pos_x"]        = AnyCodable(Double(worldPos.x))
        meta["pos_y"]        = AnyCodable(Double(worldPos.y))
        meta["pos_z"]        = AnyCodable(Double(worldPos.z))
        meta["anchor_rel_x"] = AnyCodable(Double(rel.x))
        meta["anchor_rel_y"] = AnyCodable(Double(rel.y))
        meta["anchor_rel_z"] = AnyCodable(Double(rel.z))

        let req    = UpdateTagRequest(label: nil, expectedOutcome: nil,
                                      checkDescription: nil, order: nil, metadata: meta)
        let client = SIBClient(settings: settings)
        Task {
            do {
                let updated = try await client.updateTag(id: tag.id, req: req)
                await MainActor.run {
                    if let idx = appState.activeTags.firstIndex(where: { $0.id == tag.id }) {
                        appState.activeTags[idx] = updated
                    }
                    print("[Author] ✓ Restored position for '\(tag.label)'")
                }
            } catch {
                await MainActor.run {
                    networkErrorMsg = "Could not restore position: \(friendlyMessage(for: error))"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { networkErrorMsg = nil }
                }
            }
        }
    }

    private func placePendingMarker(worldPos: simd_float3, sibPos: SIBVector3) {
        pendingNode?.removeFromParentNode()
        let node = makePendingMarker()
        node.simdPosition = worldPos
        arManager.sceneView.scene.rootNode.addChildNode(node)
        pendingNode      = node
        tagSaved         = false
        pendingPlacement = PendingPlacement(position: sibPos)
    }

    // ── Tag navigation (Screen 9) ─────────────────────────────────────────────

    /// Starts navigation mode toward a tag. If the tag has no AR marker yet
    /// (no recoverable position at all), route through the same automatic
    /// "tap to restore position" flow used by the re-anchor banner instead
    /// of silently starting training with zero position data — that silent
    /// path was the root cause of tags that train successfully but never
    /// appear anywhere afterward.
    private func navigateToTag(_ tag: Tag) {
        if persistedNodes[tag.id] != nil {
            navigatingToTag = tag
            focusTagId = tag.id; applyTagVisibility()   // G3
            highlightTagForNavigation(tag)
        } else {
            pendingTrainAfterReanchor = true
            reanchorTag = tag
            // #70: explain the redirect so it doesn't read as the app
            // silently ignoring the "Train" tap or appearing broken.
            infoMsg = "\"\(tag.label)\" lost its position — tap its location to restore it, then training will start automatically."
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                if infoMsg?.hasPrefix("\"\(tag.label)\"") == true { infoMsg = nil }
            }
        }
    }

    private func highlightTagForNavigation(_ target: Tag) {
        for (tagId, node) in persistedNodes {
            node.removeAllActions()
            if tagId == target.id {
                node.opacity = 1.0
                node.runAction(.repeatForever(.sequence([
                    .fadeOpacity(to: 0.35, duration: 0.5),
                    .fadeOpacity(to: 1.00, duration: 0.5),
                ])))
            } else {
                node.runAction(.fadeOpacity(to: 0.15, duration: 0.3))
            }
        }
    }

    private func clearNavigationHighlight() {
        for (_, node) in persistedNodes {
            node.removeAllActions()
            node.runAction(.fadeOpacity(to: 1.0, duration: 0.2))
        }
    }

    private func updateDistanceToNavigatingTag() {
        guard let tag   = navigatingToTag,
              let node  = persistedNodes[tag.id],
              let frame = arManager.sceneView.session.currentFrame else {
            distanceToTagM = nil
            return
        }
        let tagPos = node.simdWorldPosition
        let cam    = frame.camera.transform
        let camPos = simd_float3(cam.columns.3.x, cam.columns.3.y, cam.columns.3.z)
        distanceToTagM = simd_length(tagPos - camPos)
    }

    // ── P5: presence ─────────────────────────────────────────────────────────

    private func startPresence() {
        guard presence == nil, let anchor = appState.activeAnchor else { return }
        let svc = PresenceService(client: SIBClient(settings: settings), settings: settings,
                                  anchorId: anchor.id, surface: "author", guideId: nil)
        let mgr = arManager
        svc.poseProvider = {
            guard let cam = mgr.sceneView.session.currentFrame?.camera.transform,
                  let origin = mgr.lockedAnchorTransform else { return nil }
            return simd_inverse(origin) * cam          // QR frame
        }
        let focus = presenceFocus
        focus.stepId = focusTagId
        svc.focusProvider = { focus.stepId }
        svc.accepts = { $0.surface == "author" || $0.surface == "operator" }   // QR-frame surfaces only
        let layer = PresenceLayer(sceneView: arManager.sceneView)
        layer.worldFromShared = arManager.lockedAnchorTransform ?? matrix_identity_float4x4
        svc.$others.receive(on: RunLoop.main).sink { list in
            presenceOthers = list
            layer.worldFromShared = mgr.lockedAnchorTransform ?? layer.worldFromShared
            layer.update(list)
        }.store(in: &presenceBag)
        svc.$isConnected.receive(on: RunLoop.main).sink { presenceLinked = $0 }.store(in: &presenceBag)
        svc.$event.receive(on: RunLoop.main).compactMap { $0 }.sink { ev in
            switch ev {
            case .joined(let e):
                showPresenceToast("\(e.name) joined\(e.site.map { " from \($0)" } ?? "")",
                                  color: PresencePalette.color(role: e.role, userId: e.userId))
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case .left(_, let name):
                showPresenceToast("\(name) left", color: .darkGray)
            case .tagsChanged(let ids):
                Task { await applyRemoteTagEdits(ids) }
            case .stepsChanged, .coachHint:
                break
            }
            svc.event = nil
        }.store(in: &presenceBag)
        presence = svc; presenceLayer = layer
        svc.start()
    }

    private func stopPresence() {
        presence?.stop(); presence = nil
        presenceBag.removeAll()
        presenceLayer?.removeAll(); presenceLayer = nil
        presenceOthers = []
    }

    private func showPresenceToast(_ text: String, color: UIColor) {
        withAnimation { presenceToast = (text, color) }
        Task {
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            if presenceToast?.text == text { withAnimation { presenceToast = nil } }
        }
    }

    /// Edit echo: the anchor feed named tags that changed (M2 `member:<id>`).
    /// Re-fetch, then add / move / remove markers for tags I didn't touch,
    /// with a pulse and "Name · just now".
    @MainActor
    private func applyRemoteTagEdits(_ ids: [String]) async {
        guard let anchor = appState.activeAnchor,
              let fresh = try? await SIBClient(settings: settings).fetchTags(anchorId: anchor.id) else { return }
        let who   = presenceOthers.first
        let name  = who?.name ?? "A colleague"
        let color = who.map { PresencePalette.color(role: $0.role, userId: $0.userId) } ?? .systemPurple
        let freshById = Dictionary(uniqueKeysWithValues: fresh.map { ($0.id, $0) })
        for id in ids {
            if let t = freshById[id] {
                if let idx = appState.activeTags.firstIndex(where: { $0.id == id }) {
                    // Skip my own in-flight edits: identical metadata means nothing new.
                    guard appState.activeTags[idx].updatedAt != t.updatedAt else { continue }
                    appState.activeTags[idx] = t
                    persistedNodes[id]?.removeFromParentNode(); persistedNodes[id] = nil
                } else {
                    appState.activeTags.append(t)
                }
                showExistingMarkers()
                if let node = persistedNodes[id] {
                    PresenceLayer.pulse(node, color: color)
                    presenceLayer?.announceEdit(at: node.simdPosition, name: name, color: color)
                }
            } else if let idx = appState.activeTags.firstIndex(where: { $0.id == id }) {
                appState.activeTags.remove(at: idx)
                persistedNodes[id]?.removeFromParentNode(); persistedNodes[id] = nil
                if focusTagId == id { focusTagId = nil }
            }
        }
        applyTagVisibility()
    }

    // ── Existing tag markers ──────────────────────────────────────────────────

    private func showExistingMarkers() {
        for tag in appState.activeTags {
            // Idempotent — safe to call again on every anchor refinement tick
            // without creating duplicate marker nodes.
            guard persistedNodes[tag.id] == nil else { continue }
            let worldPos: simd_float3
            if let rx = metaDouble(tag.metadata["anchor_rel_x"]),
               let ry = metaDouble(tag.metadata["anchor_rel_y"]),
               let rz = metaDouble(tag.metadata["anchor_rel_z"]),
               let wp = appState.toWorldSpace(simd_float3(Float(rx), Float(ry), Float(rz))) {
                worldPos = wp
            } else if let x = metaDouble(tag.metadata["pos_x"]),
                      let y = metaDouble(tag.metadata["pos_y"]),
                      let z = metaDouble(tag.metadata["pos_z"]) {
                worldPos = simd_float3(Float(x), Float(y), Float(z))
            } else {
                continue
            }
            let trained   = appState.trainedTagIds.contains(tag.id)
            let typeColor = UIColor(tag.type.color)
            let node      = makeTagMarker(color: typeColor, trained: trained)
            node.simdPosition = worldPos
            arManager.sceneView.scene.rootNode.addChildNode(node)
            persistedNodes[tag.id] = node
        }
        applyTagVisibility()   // G3
    }

    /// G3: focus mode — with a current tag, every other marker is hidden;
    /// with none (fresh session), everything shows so the author can pick.
    private func applyTagVisibility() {
        let hideOthers = focusCurrentOnly && focusTagId != nil
        for (id, node) in persistedNodes { node.isHidden = hideOthers && id != focusTagId }
    }

    /// G2: delete every tag (server bulk route) and clear the scene.
    private func deleteAllTags() {
        guard let anchor = appState.activeAnchor else { return }
        for node in persistedNodes.values { node.removeFromParentNode() }
        persistedNodes.removeAll()
        appState.activeTags.removeAll()
        appState.trainedTagIds.removeAll()
        focusTagId = nil
        navigatingToTag = nil
        showTapHint = true
        Task {
            do { try await SIBClient(settings: settings).deleteAllTags(anchorId: anchor.id) }
            catch {
                await MainActor.run {
                    networkErrorMsg = "Could not delete tags: \(friendlyMessage(for: error))"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { networkErrorMsg = nil }
                }
            }
        }
    }

    /// Smoothly reposition all persisted tag nodes when the anchor transform is
    /// refined by the live ARImageAnchor.  Called from onChange(lockedAnchorTransform).
    private func repositionPersistedNodes() {
        guard let anchorTransform = arManager.lockedAnchorTransform else { return }
        for tag in appState.activeTags {
            guard let node = persistedNodes[tag.id],
                  let rx = metaDouble(tag.metadata["anchor_rel_x"]),
                  let ry = metaDouble(tag.metadata["anchor_rel_y"]),
                  let rz = metaDouble(tag.metadata["anchor_rel_z"])
            else { continue }
            let worldPos = ARCoordinateFrame.toWorldSpace(
                anchorRelativePos: simd_float3(Float(rx), Float(ry), Float(rz)),
                anchorTransform: anchorTransform
            )
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.15   // subtle, not jarring
            node.simdPosition = worldPos
            SCNTransaction.commit()
        }
    }

    private func upgradeMarker(_ node: SCNNode, forTagId tagId: String, trained: Bool) {
        node.removeAllActions()
        node.opacity = 1
        let tag       = appState.activeTags.first { $0.id == tagId }
        let typeColor = tag.map { UIColor($0.type.color) } ?? .systemBlue
        node.childNodes.forEach { $0.removeFromParentNode() }
        let upgraded = makeTagMarker(color: typeColor, trained: trained)
        upgraded.childNodes.forEach { child in
            child.removeFromParentNode()
            node.addChildNode(child)
        }
        persistedNodes[tagId] = node
        focusTagId = tagId; applyTagVisibility()   // G3: the tag just placed is current
    }

    // ── Auto-anchor legacy tags ───────────────────────────────────────────────

    private func autoAnchorUnpositionedTags() async {
        guard appState.anchorNormalisedTransform != nil else { return }
        let client  = SIBClient(settings: settings)
        var upgraded = 0
        for tag in appState.activeTags {
            guard tag.metadata["anchor_rel_x"] == nil else { continue }
            guard let x = metaDouble(tag.metadata["pos_x"]),
                  let y = metaDouble(tag.metadata["pos_y"]),
                  let z = metaDouble(tag.metadata["pos_z"]) else { continue }
            guard let rel = appState.toAnchorRelative(simd_float3(Float(x), Float(y), Float(z))) else { continue }
            // Seed from full existing metadata so training data (feature_prints,
            // cone quaternion, etc.) is never lost if the server does a replace
            // rather than a deep-merge on PATCH.
            var meta = tag.metadata
            meta["anchor_rel_x"] = AnyCodable(Double(rel.x))
            meta["anchor_rel_y"] = AnyCodable(Double(rel.y))
            meta["anchor_rel_z"] = AnyCodable(Double(rel.z))
            let req = UpdateTagRequest(
                label: nil, expectedOutcome: nil, checkDescription: nil, order: nil,
                metadata: meta
            )
            do {
                let updated = try await client.updateTag(id: tag.id, req: req)
                if let idx = appState.activeTags.firstIndex(where: { $0.id == tag.id }) {
                    appState.activeTags[idx] = updated
                }
                upgraded += 1
            } catch {
                print("[Author] autoAnchor PATCH failed for \(tag.id): \(error.localizedDescription)")
            }
        }
        if upgraded > 0 { print("[Author] ✓ Auto-anchored \(upgraded) tag(s) to QR coordinate frame") }
    }

    /// Automatically surfaces the "tap to restore position" banner for any
    /// tag that genuinely has zero recoverable position data, without the
    /// author needing to open the tag list and find it manually.
    ///
    /// By the time this runs, showExistingMarkers() + autoAnchorUnpositionedTags()
    /// have already placed markers for every tag that has anchor_rel_x/y/z or
    /// legacy pos_x/y/z. Any tag still missing from persistedNodes truly has no
    /// position metadata at all — most likely created before the AddTagSheet
    /// placement-required fix — and is the one case that still needs a single
    /// physical tap (we cannot invent a position that was never captured).
    @MainActor
    private func autoPromptForBrokenTags() {
        guard reanchorTag == nil, !autoReanchorPromptShown else { return }
        guard let broken = appState.activeTags.first(where: { tag in
            persistedNodes[tag.id] == nil &&
            tag.metadata["anchor_rel_x"] == nil &&
            tag.metadata["pos_x"] == nil
        }) else { return }
        autoReanchorPromptShown = true
        print("[Author] '\(broken.label)' has no position metadata — auto-prompting for re-anchor")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            reanchorTag = broken
        }
    }

    // ── Delete a tag ──────────────────────────────────────────────────────────

    private func deleteTag(_ tag: Tag) {
        persistedNodes[tag.id]?.removeFromParentNode()
        persistedNodes.removeValue(forKey: tag.id)
        appState.activeTags.removeAll { $0.id == tag.id }
        appState.trainedTagIds.remove(tag.id)
        let client = SIBClient(settings: settings)
        Task {
            do { try await client.deleteTag(id: tag.id) }
            catch {
                print("[Author] deleteTag failed: \(error.localizedDescription)")
                await MainActor.run {
                    networkErrorMsg = "Could not delete tag: \(friendlyMessage(for: error))"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { networkErrorMsg = nil }
                }
            }
        }
    }

    // ── Focus ring update ─────────────────────────────────────────────────────
    // Delegates all raycasting and positioning to ARFocusRing.update().
    // Paused while the placement sheet is open (user can't place while editing).

    private func updateCrosshair() {
        guard pendingPlacement == nil else { return }
        focusRing?.update(sceneView: arManager.sceneView)
    }

    // ── AR marker geometry ────────────────────────────────────────────────────

    private func makePendingMarker() -> SCNNode {
        let node = makeTagMarker(color: .systemPurple, trained: false, pending: true)
        node.runAction(.repeatForever(.sequence([
            .fadeOpacity(to: 0.35, duration: 0.45),
            .fadeOpacity(to: 1.00, duration: 0.45),
        ])))
        return node
    }

    private func makeTagMarker(color: UIColor, trained: Bool, pending: Bool = false) -> SCNNode {
        let root = SCNNode()

        let ring         = SCNTorus()
        ring.ringRadius  = 0.013
        ring.pipeRadius  = 0.004
        let ringMat = SCNMaterial()
        ringMat.diffuse.contents  = color
        ringMat.emission.contents = color.withAlphaComponent(trained ? 0.60 : 0.30)
        ringMat.lightingModel     = .constant
        ring.firstMaterial        = ringMat
        let ringNode = SCNNode(geometry: ring)
        ringNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
        root.addChildNode(ringNode)

        let dot    = SCNSphere(radius: 0.006)
        let dotMat = SCNMaterial()
        dotMat.diffuse.contents  = trained ? UIColor.systemGreen : color
        dotMat.emission.contents = (trained ? UIColor.systemGreen : color).withAlphaComponent(0.7)
        dotMat.lightingModel     = .constant
        dot.firstMaterial        = dotMat
        root.addChildNode(SCNNode(geometry: dot))

        if trained {
            let check  = SCNSphere(radius: 0.009)
            let cMat   = SCNMaterial()
            cMat.diffuse.contents  = UIColor.systemGreen
            cMat.emission.contents = UIColor.systemGreen.withAlphaComponent(0.6)
            cMat.lightingModel     = .constant
            check.firstMaterial    = cMat
            let cNode = SCNNode(geometry: check)
            cNode.position = SCNVector3(0.014, 0.014, 0)
            root.addChildNode(cNode)
        }
        return root
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func metaDouble(_ any: AnyCodable?) -> Double? {
        guard let any else { return nil }
        if let d = any.value as? Double { return d }
        if let i = any.value as? Int    { return Double(i) }
        return nil
    }
}

