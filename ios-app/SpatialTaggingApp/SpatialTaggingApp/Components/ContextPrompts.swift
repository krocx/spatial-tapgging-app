//
//  ContextPrompts.swift
//  SpatialTaggingApp
//
//  A (2026.4.46): each product asks for the context IT needs at its own door,
//  instead of the kiosk asking everyone for one thing at sign-in.
//
//    Chambers (Spatial Inspection + AR OMS)  operator → Production #
//                                            author   → chamber configuration
//    Gemba Audit                              Project ID at walk start (GembaWalkSheets)
//    iLOTO                                    Test bay # (the raceway the panel sits in)
//
//  Every prompt is prefilled from the last value (local memory) so a returning
//  user confirms with one tap; the kiosk keeps identity only.
//

import SwiftUI

/// One-field context prompt (Production #, Test bay #). Dark kiosk styling so
/// it reads as part of the start flow, not a settings form.
struct ContextPromptSheet: View {
    let title:    String
    let label:    String
    let icon:     String
    let hint:     String
    let cta:      String
    @Binding var value: String
    let onDone:   () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(colors: [Color(white: 0.07), Color(white: 0.12)], startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                VStack(spacing: 22) {
                    Image(systemName: icon)
                        .font(.system(size: 44))
                        .foregroundStyle(LinearGradient(colors: [.blue, .cyan], startPoint: .top, endPoint: .bottom))
                        .padding(.top, 28)
                    VStack(spacing: 6) {
                        Text(title).font(.title2.bold()).foregroundColor(.white)
                        Text(hint).font(.subheadline).foregroundColor(.white.opacity(0.6))
                            .multilineTextAlignment(.center)
                    }
                    HStack(spacing: 10) {
                        Image(systemName: "number.square").foregroundColor(.white.opacity(0.5))
                        TextField("", text: $draft, prompt: Text(label).foregroundColor(.white.opacity(0.35)))
                            .foregroundColor(.white)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.characters)
                            .focused($focused)
                            .submitLabel(.go)
                            .onSubmit(commit)
                    }
                    .padding(14)
                    .background(Color.white.opacity(0.08))
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.15)))
                    .frame(maxWidth: 420)

                    if !value.isEmpty && draft.trimmingCharacters(in: .whitespaces) == value {
                        Label("Same as last time", systemImage: "clock.arrow.circlepath")
                            .font(.caption).foregroundColor(.white.opacity(0.5))
                    }

                    Button(action: commit) {
                        Text(cta).font(.headline)
                            .frame(maxWidth: 420).padding(.vertical, 14)
                            .background(draft.trimmingCharacters(in: .whitespaces).isEmpty ? Color.gray.opacity(0.4) : Color.blue)
                            .foregroundColor(.white).cornerRadius(14)
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    Spacer()
                }
                .padding(.horizontal, 24)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundColor(.white.opacity(0.7))
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .onAppear { draft = value; focused = value.isEmpty }
    }

    private func commit() {
        let v = draft.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        value = v
        dismiss()
        onDone()
    }
}

/// Chamber configuration picker for authors (moved out of the kiosk, C2 logic
/// unchanged): list + inline "New configuration".
struct ChamberConfigPickerSheet: View {
    @EnvironmentObject private var settings: AppSettings
    @Environment(\.dismiss) private var dismiss
    let onPicked: () -> Void

    @State private var configs: [ChamberConfig] = []
    @State private var loading = false
    @State private var selectedId = ""
    @State private var showNew = false
    @State private var newCode = ""
    @State private var newName = ""
    @State private var errorText: String? = nil

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(colors: [Color(white: 0.07), Color(white: 0.12)], startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                VStack(spacing: 18) {
                    Image(systemName: "building.2.crop.circle")
                        .font(.system(size: 44))
                        .foregroundStyle(LinearGradient(colors: [.blue, .cyan], startPoint: .top, endPoint: .bottom))
                        .padding(.top, 20)
                    VStack(spacing: 6) {
                        Text("Which chamber configuration?").font(.title2.bold()).foregroundColor(.white)
                        Text("You author against a configuration; its chambers share the guides you write.")
                            .font(.subheadline).foregroundColor(.white.opacity(0.6)).multilineTextAlignment(.center)
                    }
                    Group {
                        if loading && configs.isEmpty {
                            HStack { ProgressView().tint(.white); Text("Loading configurations…") }
                                .font(.footnote).foregroundColor(.white.opacity(0.6))
                        } else if configs.isEmpty && !showNew {
                            Text("No chamber configurations yet - add the first one below.")
                                .font(.footnote).foregroundColor(.white.opacity(0.6))
                        } else {
                            ScrollView {
                                VStack(spacing: 6) {
                                    ForEach(configs) { c in
                                        Button { selectedId = c.id } label: {
                                            HStack(spacing: 10) {
                                                Image(systemName: selectedId == c.id ? "checkmark.circle.fill" : "circle")
                                                    .foregroundColor(selectedId == c.id ? .cyan : .white.opacity(0.4))
                                                VStack(alignment: .leading, spacing: 1) {
                                                    Text(c.code).font(.subheadline.bold()).foregroundColor(.white)
                                                    Text(c.name).font(.caption).foregroundColor(.white.opacity(0.65))
                                                }
                                                Spacer()
                                                if let n = c.chamberCount {
                                                    Text("\(n) chamber\(n == 1 ? "" : "s")").font(.caption2).foregroundColor(.white.opacity(0.4))
                                                }
                                            }
                                            .padding(.horizontal, 12).padding(.vertical, 10)
                                            .background(selectedId == c.id ? Color.cyan.opacity(0.15) : Color.white.opacity(0.06))
                                            .cornerRadius(10)
                                        }
                                    }
                                }
                            }
                            .frame(maxHeight: 300)
                        }
                    }
                    .frame(maxWidth: 420)

                    if showNew {
                        VStack(spacing: 8) {
                            HStack(spacing: 8) {
                                field("Code (e.g. PXP-A)", $newCode).frame(maxWidth: 150)
                                field("Name", $newName)
                            }
                            HStack {
                                Button("Cancel") { showNew = false }.font(.footnote).foregroundColor(.white.opacity(0.6))
                                Spacer()
                                Button("Add configuration") { Task { await create() } }
                                    .font(.footnote.bold()).foregroundColor(.cyan)
                                    .disabled(newCode.trimmingCharacters(in: .whitespaces).isEmpty || newName.trimmingCharacters(in: .whitespaces).isEmpty)
                            }
                        }
                        .frame(maxWidth: 420)
                    } else {
                        Button { showNew = true } label: {
                            Label("New configuration", systemImage: "plus.circle").font(.footnote).foregroundColor(.cyan)
                        }
                    }
                    if let errorText {
                        Text(errorText).font(.footnote).foregroundColor(.orange).multilineTextAlignment(.center)
                    }
                    Button {
                        guard let c = configs.first(where: { $0.id == selectedId }) else { return }
                        settings.chamberConfigId = c.id
                        settings.chamberConfigLabel = c.label
                        dismiss(); onPicked()
                    } label: {
                        Text("Start Authoring").font(.headline)
                            .frame(maxWidth: 420).padding(.vertical, 14)
                            .background(selectedId.isEmpty ? Color.gray.opacity(0.4) : Color.blue)
                            .foregroundColor(.white).cornerRadius(14)
                    }
                    .disabled(selectedId.isEmpty)
                    Spacer()
                }
                .padding(.horizontal, 24)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundColor(.white.opacity(0.7))
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task {
            selectedId = settings.chamberConfigId
            loading = true; defer { loading = false }
            if let list = try? await SIBClient(settings: settings).fetchChamberConfigs() {
                configs = list
                if selectedId.isEmpty, configs.count == 1 { selectedId = configs[0].id }
            }
        }
    }

    private func create() async {
        errorText = nil
        do {
            let c = try await SIBClient(settings: settings).createChamberConfig(
                code: newCode.trimmingCharacters(in: .whitespaces), name: newName.trimmingCharacters(in: .whitespaces))
            configs.append(c)
            configs.sort { $0.code.localizedCaseInsensitiveCompare($1.code) == .orderedAscending }
            selectedId = c.id; newCode = ""; newName = ""; showNew = false
        } catch { errorText = friendlyMessage(for: error) }
    }

    private func field(_ label: String, _ text: Binding<String>) -> some View {
        TextField("", text: text, prompt: Text(label).foregroundColor(.white.opacity(0.35)))
            .foregroundColor(.white).autocorrectionDisabled().textInputAutocapitalization(.characters)
            .padding(12).background(Color.white.opacity(0.08)).cornerRadius(10)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.15)))
    }
}
