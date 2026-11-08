export function isHeicFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return type === "image/heic" || type === "image/heif"
    || name.endsWith(".heic") || name.endsWith(".heif");
}

async function decodeHeic(file) {
  const module = await import("libheif-js/wasm-bundle");
  const libheif = module.default || module;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
  try {
    if (!images?.length) throw new Error("heic");
    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();
    if (!width || !height || width * height > 40_000_000) throw new Error("heic");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("heic");
    const imageData = context.createImageData(width, height);
    await new Promise((resolve, reject) => {
      image.display(imageData, (data) => {
        if (data) resolve();
        else reject(new Error("heic"));
      });
    });
    context.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    for (const image of images || []) image.free?.();
  }
}

async function loadPhotoBitmap(file) {
  let source = file;
  if (isHeicFile(file)) {
    try {
      source = await decodeHeic(file);
    } catch (error) {
      console.error("HEIC se nepodařilo převést", error);
      throw new Error("heic");
    }
  }
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(source);
    } catch {}
  }
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Image decode timed out")), 10_000);
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Image decode failed"));
      };
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function preparePhotoBlob(file) {
  const bitmap = await loadPhotoBitmap(file);
  const max = 2000;
  const width = Number(bitmap.width) || 0;
  const height = Number(bitmap.height) || 0;
  if (!width || !height) throw new Error("Invalid image");
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (typeof bitmap.close === "function") bitmap.close();
  const type = canvas.toDataURL("image/webp").startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error("Canvas export failed");
  return blob;
}
