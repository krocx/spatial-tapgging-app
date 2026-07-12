// CameraPickerView.swift
// UIViewControllerRepresentable wrapper around UIImagePickerController (camera only).
// Falls back to the photo library on the Simulator where camera is unavailable.
// Used by LocTagFormSheet and LocTagOperatorSheet.

import SwiftUI

struct CameraPickerView: UIViewControllerRepresentable {

    let onImageCaptured: (UIImage) -> Void

    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker           = UIImagePickerController()
        picker.sourceType    = UIImagePickerController.isSourceTypeAvailable(.camera)
            ? .camera
            : .photoLibrary       // Simulator fallback
        picker.cameraCaptureMode = .photo
        picker.delegate      = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPickerView
        init(_ parent: CameraPickerView) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            let image = (info[.editedImage] ?? info[.originalImage]) as? UIImage
            picker.dismiss(animated: true) {
                if let img = image { self.parent.onImageCaptured(img) }
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true)
        }
    }
}
