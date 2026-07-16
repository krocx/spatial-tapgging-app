// ModelPreviewView.swift
//
// A non-AR sheet that lets authors preview a 3D model (USDZ only) in a
// SceneKit scene. Used to verify that the browser-side GLB→USDZ conversion
// produced a valid file before assigning the model to a guide step.
//
// iOS only supports USDZ via SCNScene(url:). The ModelIO→SceneKit GLB bridge
// was removed in iOS 26. The portal browser converts GLB→USDZ automatically.
//
// Usage:
//   .sheet(item: $previewModel) { model in
//       ModelPreviewView(model: model)
//   }

import SwiftUI
import SceneKit

// MARK: - SCNView wrapper

/// UIViewRepresentable that hosts a SceneKit scene for model preview.
/// `allowsCameraControl` enables pinch-to-zoom and drag-to-rotate out of the box.
private struct SCNPreviewContainer: UIViewRepresentable {

    let scene: SCNScene

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene               = scene
        view.allowsCameraControl = true
        view.autoenablesDefaultLighting = true
        view.backgroundColor    = UIColor.systemBackground
        view.antialiasingMode   = .multisampling4X

        // Camera positioned far enough back to see most models.
        let camNode      = SCNNode()
        camNode.camera   = SCNCamera()
        camNode.position = SCNVector3(0, 0.5, 2.0)
        scene.rootNode.addChildNode(camNode)

        return view
    }

    func updateUIView(_ uiView: SCNView, context: Context) { }
}

// MARK: - ModelPreviewView

struct ModelPreviewView: View {

    let model: Model3D

    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    // Internal state
    private enum LoadState {
        case idle, loading, loaded(SCNScene, String), failed(String)
    }
    @State private var loadState: LoadState = .idle

    var body: some View {
        NavigationView {
            ZStack {
                switch loadState {

                case .idle, .loading:
                    VStack(spacing: 16) {
                        ProgressView()
                            .scaleEffect(1.4)
                        Text("Loading model…")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                case .loaded(let scene, let formatLabel):
                    ZStack(alignment: .bottomTrailing) {
                        SCNPreviewContainer(scene: scene)
                            .ignoresSafeArea(edges: .bottom)
                        Text(formatLabel)
                            .font(.caption2.bold())
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(12)
                    }

                case .failed(let msg):
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(.orange)
                        Text("Preview failed")
                            .font(.headline)
                        Text(msg)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                }
            }
            .navigationTitle(model.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .onAppear {
            Task { await loadModel() }
        }
    }

    // MARK: - Loading

    private func loadModel() async {
        await MainActor.run { loadState = .loading }

        // iOS only renders USDZ via SCNScene(url:) — the ModelIO→SceneKit GLB bridge
        // was removed in iOS 26. If hasUSDZ is false, the portal browser conversion
        // hasn't completed yet; show a clear message rather than a confusing error.
        guard model.hasUSDZ else {
            await MainActor.run {
                loadState = .failed(
                    "USDZ not yet available.\n" +
                    "Open the portal and upload (or re-upload) this model " +
                    "to trigger browser-side conversion."
                )
            }
            return
        }

        let client = SIBClient(settings: settings)
        let data   = try? await client.downloadModelUSDZ(id: model.id)

        guard let data else {
            await MainActor.run {
                loadState = .failed("Could not download the USDZ file.\nCheck your network connection.")
            }
            return
        }

        // Write to a temp file so SCNScene can load it by URL.
        let cacheDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ar-oms-preview", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let fileURL = cacheDir.appendingPathComponent("\(model.id)-preview.usdz")

        guard (try? data.write(to: fileURL)) != nil else {
            await MainActor.run {
                loadState = .failed("Could not write the model to disk.")
            }
            return
        }

        // Parse on a background thread — SCNScene init can be slow for large models.
        let scene: SCNScene? = await Task.detached(priority: .utility) {
            guard let sc = try? SCNScene(url: fileURL, options: [
                SCNSceneSource.LoadingOption.checkConsistency: false,
                SCNSceneSource.LoadingOption.flattenScene: false,
            ]) else { return nil }

            // Centre + normalise the model so it always fits in view regardless of
            // the real-world scale saved on the server.
            let children = sc.rootNode.childNodes
            guard !children.isEmpty else { return nil }

            let wrapper   = SCNNode()
            wrapper.name  = "preview_root"
            children.forEach { wrapper.addChildNode($0.clone()) }

            // Fit to a 1-unit bounding box.
            let bb    = wrapper.boundingBox   // local coords (unaffected by wrapper.scale)
            let size  = SCNVector3(bb.max.x - bb.min.x,
                                   bb.max.y - bb.min.y,
                                   bb.max.z - bb.min.z)
            let maxDim = max(size.x, size.y, size.z)
            let s: Float = maxDim > 0 ? (1.0 / maxDim) : 1.0
            wrapper.scale = SCNVector3(s, s, s)

            // Centre on origin.
            // world_pos = wrapper.position + local_center * s
            // We want world_pos = 0, so wrapper.position = -local_center * s
            let cx = (bb.min.x + bb.max.x) / 2
            let cy = (bb.min.y + bb.max.y) / 2
            let cz = (bb.min.z + bb.max.z) / 2
            wrapper.position = SCNVector3(-cx * s, -cy * s, -cz * s)

            let root = SCNScene()
            root.rootNode.addChildNode(wrapper)
            return root
        }.value

        await MainActor.run {
            if let scene {
                loadState = .loaded(scene, "USDZ")
            } else {
                loadState = .failed(
                    "SceneKit could not parse the USDZ file.\n" +
                    "The browser conversion may have produced an invalid file."
                )
            }
        }
    }
}
