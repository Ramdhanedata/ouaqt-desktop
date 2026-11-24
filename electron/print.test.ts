import { describe, expect, it, vi } from "vitest";

/* print.ts opens windows to print; these tests only read reports, so Electron is not needed. */
vi.mock("electron", () => ({ BrowserWindow: class {}, app: {} }));

const { isPrintedDay, printableDay } = await import("./print");

const day = {
  title: "نهاية اليوم",
  date: "الثلاثاء، 24 نوفمبر 2026",
  totalLabel: "الإيراد الإجمالي",
  total: "1 150,00 MRU",
  sections: [
    { rows: [{ label: "عدد الطلبات", value: "2" }, { label: "العنصر الأكثر طلبا", value: null, note: "1 مرة" }] },
    { heading: "تفاصيل المدفوعات", rows: [{ label: "نقدا", value: "1 000,00 MRU" }, { label: undefined, value: 150 }] },
  ],
};

describe("a report on its way to the printer, the PDF or WhatsApp", () => {
  it("is refused by the strict check when one line has no name, as on the phone", () => {
    expect(isPrintedDay(day)).toBe(false);
  });

  it("is still printed: the missing name becomes empty text and the figure becomes text", () => {
    const printable = printableDay(day);
    expect(printable).not.toBeNull();
    expect(isPrintedDay(printable)).toBe(true);
    expect(printable!.sections[0].rows[1]).toEqual({ label: "العنصر الأكثر طلبا", value: "", note: "1 مرة" });
    expect(printable!.sections[1].rows[1]).toEqual({ label: "", value: "150" });
    expect(printable!.sections[1].heading).toBe("تفاصيل المدفوعات");
  });

  it("leaves a whole report as it was", () => {
    const whole = { ...day, sections: [{ rows: [{ label: "Ventes", value: "2" }] }] };
    expect(printableDay(whole)).toEqual(whole);
  });

  it("still says no to what is not a report", () => {
    expect(printableDay(null)).toBeNull();
    expect(printableDay("day")).toBeNull();
    expect(printableDay({ title: "x" })).toBeNull();
  });
});
