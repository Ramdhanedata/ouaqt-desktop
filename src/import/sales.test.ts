import { describe, expect, it } from "vitest";
import { dateOrderOf, findSalesColumns, findSalesHeader, kindOf, parseSaleDate, parseSales, paymentOf, sheetFor } from "./sales";

describe("which kind of file", () => {
  it("knows a product list from a book of sales", () => {
    expect(kindOf([["Nom", "Prix", "Quantité"], ["Sucre", 45, 50], ["Lait", 180, 24]], "shop")).toBe("products");
    expect(kindOf([["Date", "Désignation", "Qté", "PU", "Montant"], ["03/11/2026", "Sucre", 2, 45, 90]], "shop")).toBe("sales");
    expect(kindOf([["التاريخ", "المبيعات"], ["2026-11-03", "12 500"]], "shop")).toBe("sales");
  });

  it("does not take a pharmacy's expiry dates for days of sale", () => {
    const rows = [["Désignation", "Prix", "Quantité", "Péremption", "Lot"], ["Doliprane", 120, 24, "12/2027", "A12"]];
    expect(findSalesColumns(rows[0]).date).toBeUndefined();
    expect(kindOf(rows, "pharmacy")).toBe("products");
  });

  it("reads a day's takings with no date as sales, the day to be asked", () => {
    const rows = [["Recette du jour"], [15000]];
    expect(kindOf(rows, "restaurant")).toBe("sales");
    const read = parseSales(rows, { pack: "restaurant" });
    expect(read.needsDay).toBe(true);
    expect(parseSales(rows, { pack: "restaurant", day: "2026-11-02" }).sales).toHaveLength(1);
  });

  it("finds the sheet that holds the sales behind a summary", () => {
    const sheets = {
      Résumé: [["Boutique Ali"], ["Novembre"]],
      Produits: [["Nom", "Prix"], ["Sucre", 45]],
      Ventes: [["Date", "Article", "Montant"], ["01/11/2026", "Sucre", 45], ["02/11/2026", "Lait", 180]],
    };
    expect(sheetFor(sheets, "sales", "shop")).toBe("Ventes");
    expect(sheetFor(sheets, "products", "shop")).toBe("Produits");
  });
});

describe("a book with its expenses beside it", () => {
  /* A shop's copybook as typed: the sales on one sheet, what went out on a longer one, with a note that says "المبلغ". */
  const sales = [["Date", "Article", "Montant"], [46327, "(dg)", 15000], [46328, "(BK)", 30000], [46329, "", 13000]];
  const expenses = [
    ["Date", "Désignation", "Sortie d'argent"],
    [46327, "أصبوح", 500],
    [46327, "تكسي (المبلغ غير واضح)", ""],
    [46328, "أصبوح", 500],
    [46328, "سكر وورقة", 5500],
    [46329, "أصبوح", 500],
  ];

  it("never takes a line of the book for its header", () => {
    expect(findSalesHeader(expenses).index).toBe(-1);
    expect(findSalesHeader([["Boutique Ali"], ["Date", "Montant"], [46327, 1500]]).index).toBe(1);
    expect(findSalesHeader([["Date", "Montant"], ["03/11/2026", "le total"]]).index).toBe(0);
  });

  it("opens the sales, not the longer sheet of expenses", () => {
    expect(sheetFor({ Ventes: sales, "Dépenses (pour info)": expenses }, "sales", "shop")).toBe("Ventes");
    expect(sheetFor({ "Dépenses (pour info)": expenses, Feuil1: sales }, "sales", "shop")).toBe("Feuil1");
  });

  it("between two sheets of sales, takes the one with more of them", () => {
    const longer = [...sales, [46330, "(190)", 12000], [46331, "", 3000]];
    expect(sheetFor({ Feuil1: sales, Feuil2: longer }, "sales", "shop")).toBe("Feuil2");
  });
});

describe("dates as owners write them", () => {
  it("reads typed dates, Excel's own and the month by name", () => {
    expect(parseSaleDate("03/11/2026")).toEqual({ day: "2026-11-03", time: null });
    expect(parseSaleDate("3-11-26")).toEqual({ day: "2026-11-03", time: null });
    expect(parseSaleDate("2026-11-03 14:30")).toEqual({ day: "2026-11-03", time: "14:30" });
    expect(parseSaleDate(46329)).toEqual({ day: "2026-11-03", time: null });
    expect(parseSaleDate(46329.5)).toEqual({ day: "2026-11-03", time: "12:00" });
    expect(parseSaleDate("mardi 3 novembre 2026")?.day).toBe("2026-11-03");
    expect(parseSaleDate("3 نوفمبر 2026")?.day).toBe("2026-11-03");
    expect(parseSaleDate("٠٣/١١/٢٠٢٦")?.day).toBe("2026-11-03");
    expect(parseSaleDate("31/02/2026")).toBeNull();
    expect(parseSaleDate("Doliprane")).toBeNull();
  });

  it("works out month first from the column, day first otherwise", () => {
    expect(dateOrderOf(["11/03/2026", "11/25/2026"])).toBe("mdy");
    expect(dateOrderOf(["03/11/2026", "25/11/2026"])).toBe("dmy");
    expect(dateOrderOf(["03/11/2026"])).toBe("dmy");
    expect(parseSaleDate("11/03/2026", "mdy")?.day).toBe("2026-11-03");
  });
});

describe("the rows of a sales book", () => {
  const book = [
    ["Boutique Ali — ventes de novembre"],
    [],
    ["Date", "N° ticket", "Désignation", "Qté", "P.U.", "Montant", "Paiement"],
    ["03/11/2026", "1", "Sucre 1 kg", 2, 45, 90, "Espèces"],
    ["", "1", "Lait en poudre", 1, "180", "180", "Espèces"],
    ["", "2", "Thé", 3, 50, "", "Bankily"],
    ["TOTAL", "", "", "", "", 420, ""],
    ["04/11/2026", "3", "Sucre 1 kg", 1, 45, "45 MRU", "Crédit"],
    ["04/11/2026", "4", "Riz", 1, "1 200,50", "", ""],
  ];

  it("groups a ticket's lines, carries the date down and skips the totals", () => {
    const read = parseSales(book, { pack: "shop", currency: "new" });
    expect(read.problems).toEqual([]);
    expect(read.totalRows).toBe(1);
    expect(read.sales).toHaveLength(4);
    const [first, second, third, fourth] = read.sales;
    expect(first.day).toBe("2026-11-03");
    expect(first.lines.map((line) => line.total)).toEqual([9000, 18000]);
    expect(second).toMatchObject({ day: "2026-11-03", payment: "mobile", mobileApp: "Bankily" });
    expect(second.lines[0]).toMatchObject({ quantity: 3, unitPrice: 5000, total: 15000 });
    expect(third).toMatchObject({ day: "2026-11-04", payment: "credit" });
    expect(fourth.lines[0].total).toBe(120050);
    expect(read.total).toBe(9000 + 18000 + 15000 + 4500 + 120050);
    expect(read.firstDay).toBe("2026-11-03");
    expect(read.lastDay).toBe("2026-11-04");
  });

  it("gives the same fingerprints when the same file is read again", () => {
    const once = parseSales(book, { pack: "shop", currency: "new" }).sales.map((sale) => sale.key);
    const twice = parseSales(book, { pack: "shop", currency: "new" }).sales.map((sale) => sale.key);
    expect(twice).toEqual(once);
    expect(new Set(once).size).toBe(once.length);
  });

  it("keeps two identical sales of the same day apart", () => {
    const rows = [["Date", "Article", "Montant"], ["03/11/2026", "Pain", 20], ["03/11/2026", "Pain", 20]];
    const keys = parseSales(rows, { pack: "bakery", currency: "new" }).sales.map((sale) => sale.key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("says which rows it could not read and keeps the rest", () => {
    const rows = [["Date", "Article", "Montant"], ["hier", "Pain", 20], ["03/11/2026", "Pain", "vingt"], ["03/11/2026", "Lait", -5], ["03/11/2026", "Eau", 50]];
    const read = parseSales(rows, { pack: "shop", currency: "new" });
    expect(read.problems.map((problem) => problem.code)).toEqual(["bad_date", "bad_amount", "negative_amount"]);
    expect(read.sales).toHaveLength(1);
  });

  it("reads a book of days in Arabic", () => {
    const rows = [["التاريخ", "المبيعات", "طريقة الدفع"], ["01/11/2026", "15 000", "نقدا"], ["02/11/2026", "12 500", "بنكيلي"]];
    const read = parseSales(rows, { pack: "restaurant", currency: "new" });
    expect(read.sales.map((sale) => sale.day)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(read.sales[1].payment).toBe("mobile");
    expect(read.total).toBe(2_750_000);
    /* A day's takings is big by nature: no question about old ouguiyas unless the file says so. */
    expect(parseSales(rows, { pack: "restaurant" }).currency.ask).toBe(false);
    expect(parseSales([["Date", "Recette (UM)"], ["01/11/2026", 150000]], { pack: "restaurant" }).currency.ask).toBe(true);
  });
});

describe("how it was paid", () => {
  it("knows cash, credit and the payment applications", () => {
    expect(paymentOf("Espèces").payment).toBe("cash");
    expect(paymentOf("").payment).toBe("cash");
    expect(paymentOf("à crédit").payment).toBe("credit");
    expect(paymentOf("Masrvi")).toEqual({ payment: "mobile", mobileApp: "Masrvi" });
    expect(paymentOf("Mobile")).toEqual({ payment: "mobile", mobileApp: null });
  });
});
