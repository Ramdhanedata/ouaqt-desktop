/*
 * A payment's screenshot made ready to send: whatever the phone or computer
 * holds (PNG, JPEG, HEIC where the browser can open it), drawn again as a
 * JPEG small enough for the website, which takes up to 2 MB of JPEG only.
 * The writing on it stays sharp: a long side of 1600 pixels reads well.
 */
const LONGEST = 1600; // not-a-rule: pixels on the long side, enough to read a receipt
const LIMIT = 1_900_000; // not-a-rule: under the website's 2 MB

export async function screenshotJpeg(file: File): Promise<Uint8Array | null> {
  try {
    const picture = await createImageBitmap(file);
    const scale = Math.min(1, LONGEST / Math.max(picture.width, picture.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(picture.width * scale));
    canvas.height = Math.max(1, Math.round(picture.height * scale));
    const pen = canvas.getContext("2d");
    if (!pen) return null;
    pen.fillStyle = "#fff";
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.drawImage(picture, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.75, 0.6, 0.45]) {
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", quality));
      if (blob && blob.size <= LIMIT) return new Uint8Array(await blob.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}
