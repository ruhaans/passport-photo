const endpoint = `${(import.meta.env.VITE_BACKGROUND_REMOVAL_API_URL ?? "").replace(/\/$/, "")}/api/background/remove`;

export class BackgroundRemovalApiService {
  async removeBackground(image: File): Promise<Blob> {
    const formData = new FormData();
    formData.append("file", image, image.name);

    const response = await fetch(endpoint, { method: "POST", body: formData });
    if (!response.ok) {
      throw new Error(
        `Background removal request failed (${response.status}).`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("image/png")) {
      throw new Error("Background removal returned an unexpected response.");
    }

    return response.blob();
  }
}

// The editor depends only on this API contract, not on rembg itself.
export const backgroundRemovalService = new BackgroundRemovalApiService();

export async function compositeTransparentPngOnWhite(
  transparentPng: Blob,
): Promise<Blob> {
  const sourceUrl = URL.createObjectURL(transparentPng);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error("Unable to read the processed image."));
      element.src = sourceUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to composite the processed image.");

    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Unable to create the processed image."));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
