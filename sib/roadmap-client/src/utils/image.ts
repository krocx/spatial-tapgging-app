// image.ts — client-side image preparation for whiteboard import.
// Downscales to a VLM-friendly size before upload: faster local inference,
// smaller payloads, and photos straight off a phone camera stay usable.

const MAX_DIM = 1280;

export async function fileToDownscaledBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not read that image file'));
      img.src = url;
    });

    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);

    // JPEG q0.85 — plenty for text/box recognition, keeps payloads small.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
