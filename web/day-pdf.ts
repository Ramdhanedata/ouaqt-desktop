import type { PrintedDay } from "../electron/print";

/*
 * The end of the day as a real PDF file, made on the phone or in the preview.
 *
 * The desktop has Chromium's printToPDF. A web page does not, and a PDF
 * library would have to be taught Arabic. A canvas already draws Arabic
 * properly, joined and right to left, in the app's own font. So the report is
 * drawn on a canvas, and the picture is placed on one page of a very small
 * PDF, written by hand below. Nothing leaves the phone.
 */

const PAGE_WIDTH = 595; // not-a-rule: A4 in points
const PAGE_HEIGHT = 842; // not-a-rule: A4 in points
const SCALE = 3; // not-a-rule: pixels per point, sharp enough to print
const MARGIN = 64;
const FONT = 'Cairo, "Geeza Pro", "Noto Naskh Arabic", "Segoe UI", Tahoma, Arial, sans-serif';
const INK = "#0a0a0a";
const SOFT = "#555555";
const HAIRLINE = "#d4d2ca";

type Shop = { name: string; nameArabic?: string; logo?: string };

/** A JPEG on one page of a PDF. The page takes the picture's shape, at the given width and height in points. */
export function jpegPdf(jpeg: Uint8Array, pixels: { width: number; height: number }, points: { width: number; height: number }): Uint8Array {
  const encoder = new TextEncoder();
  const content = encoder.encode(`q ${points.width} 0 0 ${points.height} 0 0 cm /Picture Do Q`);
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (number: number, body: string, stream?: Uint8Array) => {
    offsets[number] = length;
    write(`${number} 0 obj\n${body}\n`);
    if (stream) {
      write("stream\n");
      write(stream);
      write("\nendstream\n");
    }
    write("endobj\n");
  };

  write("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${points.width} ${points.height}] /Resources << /XObject << /Picture 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${pixels.width} /Height ${pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  object(5, `<< /Length ${content.length} >>`, content);

  const start = length;
  const count = offsets.length; // the unused object 0 counts too
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let number = 1; number < count; number += 1) write(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);

  const file = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}

/** Breaks a long name onto as many lines as it needs. */
function wrapped(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function picture(source: string | undefined): Promise<HTMLImageElement | null> {
  if (!source) return null;
  const image = new Image();
  image.src = source;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

/*
 * Draws the report top to bottom. Run once with no canvas to measure it, so a
 * long day gets a longer page instead of losing its last lines.
 */
function draw(context: CanvasRenderingContext2D, day: PrintedDay, shop: Shop, logo: HTMLImageElement | null, rtl: boolean, paint: boolean): number {
  const width = PAGE_WIDTH;
  const start = rtl ? width - MARGIN : MARGIN;
  const end = rtl ? MARGIN : width - MARGIN;
  let y = MARGIN;

  const text = (value: string, x: number, align: "left" | "right" | "center", size: number, bold: boolean, colour: string, leftToRight = !rtl) => {
    context.font = `${bold ? 700 : 400} ${size}px ${FONT}`;
    context.textAlign = align;
    context.textBaseline = "alphabetic";
    context.direction = leftToRight ? "ltr" : "rtl";
    context.fillStyle = colour;
    if (paint) context.fillText(value, x, y);
  };
  const rule = (colour: string) => {
    if (!paint) return;
    context.strokeStyle = colour;
    context.lineWidth = 0.75;
    context.beginPath();
    context.moveTo(MARGIN, y);
    context.lineTo(width - MARGIN, y);
    context.stroke();
  };
  const centre = width / 2;
  const startAlign = rtl ? "right" : "left";
  const endAlign = rtl ? "left" : "right";

  if (logo) {
    const height = Math.min(64, logo.naturalHeight);
    const across = (logo.naturalWidth / logo.naturalHeight) * height;
    if (paint) context.drawImage(logo, centre - across / 2, y, across, height);
    y += height + 22;
  }
  y += 8;
  text(rtl && shop.nameArabic ? shop.nameArabic : shop.name, centre, "center", 24, true, INK);
  y += 30;
  text(day.title, centre, "center", 18, true, INK);
  y += 24;
  text(day.date, centre, "center", 14, false, SOFT);
  y += 20;
  rule(INK);
  y += 34;
  text(day.totalLabel, centre, "center", 15, false, SOFT);
  y += 50;
  text(day.total, centre, "center", 44, true, INK, true);
  y += 26;
  rule(INK);

  for (const section of day.sections) {
    y += 14;
    if (section.heading) {
      y += 16;
      text(section.heading, start, startAlign, 16, true, INK);
      y += 10;
    }
    section.rows.forEach((row, index) => {
      /* The figure's width first: the label takes the rest of the line. */
      context.font = `700 15px ${FONT}`;
      const figure = context.measureText(row.value).width;
      context.font = `400 15px ${FONT}`;
      const lines = wrapped(context, row.label, width - 2 * MARGIN - figure - 24);
      y += 24;
      text(row.value, end, endAlign, 15, true, INK, !/\p{Script=Arabic}/u.test(row.value));
      lines.forEach((line, at) => {
        if (at > 0) y += 20;
        text(line, start, startAlign, 15, false, SOFT);
      });
      if (row.note) {
        y += 18;
        text(row.note, end, endAlign, 12, false, SOFT);
      }
      y += 11;
      if (index < section.rows.length - 1) rule(HAIRLINE);
    });
  }
  return y + MARGIN;
}

export async function dayPdf(day: PrintedDay, shop: Shop, language: string): Promise<Uint8Array> {
  const rtl = language === "ar";
  /* The canvas draws in whatever font is ready, so the app's own is asked for first. */
  await Promise.all(["400 15px Cairo", "700 15px Cairo"].map((font) => document.fonts.load(font, day.title).catch(() => null)));
  const logo = await picture(shop.logo);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas on this device");
  const height = Math.max(PAGE_HEIGHT, Math.ceil(draw(context, day, shop, logo, rtl, false)));
  canvas.width = PAGE_WIDTH * SCALE;
  canvas.height = height * SCALE;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(SCALE, SCALE);
  draw(context, day, shop, logo, rtl, true);

  const data = canvas.toDataURL("image/jpeg", 0.9); // not-a-rule: sharp text, a small file
  const binary = atob(data.slice(data.indexOf(",") + 1));
  const jpeg = Uint8Array.from(binary, (letter) => letter.charCodeAt(0));
  return jpegPdf(jpeg, { width: canvas.width, height: canvas.height }, { width: PAGE_WIDTH, height });
}

/*
 * Hands the file over. An iPhone saves through its share sheet (Save to
 * Files, WhatsApp); where that is not offered, an ordinary download.
 */
export async function giveFile(bytes: Uint8Array, name: string): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (iPhone && navigator.canShare) {
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (error) {
        /* He closed the sheet: that is his answer, not a failure. Anything else falls through to a download. */
        if ((error as Error).name === "AbortError") return;
      }
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000); // not-a-rule: long enough for the device to take the file
}

export const dayFileName = (fileName: unknown) => `${String(fileName).replace(/[^\p{L}\p{N}.-]+/gu, "-").slice(0, 80) || "journee"}.pdf`;
