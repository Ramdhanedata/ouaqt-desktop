import { describe, expect, it } from "vitest";
import { dayFileName, jpegPdf } from "../web/day-pdf";

/* A reader finds everything through the table at the end, so its offsets are what must be right. */
describe("the end of the day's PDF", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const file = jpegPdf(jpeg, { width: 30, height: 40 }, { width: 595, height: 842 });
  const text = new TextDecoder("latin1").decode(file);

  it("is a PDF with one page of the picture's shape", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Count 1");
    expect(text).toContain("/MediaBox [0 0 595 842]");
    expect(text).toContain("/Width 30 /Height 40");
    expect(text).toContain("/Filter /DCTDecode /Length 7");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("says exactly where each object starts", () => {
    const table = text.slice(text.indexOf("xref\n"));
    const rows = table.split("\n").slice(2, 8);
    expect(rows[0]).toBe("0000000000 65535 f ");
    rows.slice(1).forEach((row, index) => {
      const offset = Number(row.slice(0, 10));
      expect(text.slice(offset, offset + 8), `object ${index + 1}`).toBe(`${index + 1} 0 obj\n`);
    });
    const start = Number(table.split("startxref\n")[1].split("\n")[0]);
    expect(text.slice(start, start + 4)).toBe("xref");
  });

  it("carries the picture untouched", () => {
    const at = text.indexOf("stream\n") + "stream\n".length;
    expect([...file.slice(at, at + jpeg.length)]).toEqual([...jpeg]);
  });

  it("names the file in any language, with nothing a phone would refuse", () => {
    expect(dayFileName("Fin de journée-2026-11-05")).toBe("Fin-de-journée-2026-11-05.pdf");
    expect(dayFileName("نهاية اليوم-2026-11-05")).toBe("نهاية-اليوم-2026-11-05.pdf");
    expect(dayFileName("///")).toBe("-.pdf");
  });
});
