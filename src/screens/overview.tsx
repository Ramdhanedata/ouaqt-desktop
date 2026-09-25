import { useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { formatQuantity } from "@app-ui/format";
import { machine, type SaleSummary, type Summary } from "../bridge";
import { ReceiptView } from "../receipt";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Empty, ScreenHeader, Stat, money, when } from "../ui";
import { periodOf } from "./reports";

/*
 * The pharmacy's overview, as the owner's own pharmacy app opened on it:
 * the takings, the number of sales and the items that went out, for the day,
 * the week or the month, and every transaction under them with what it was.
 * Each one opens its receipt, to see, download or print.
 */

type Range = "today" | "week" | "month";

export function SalesOverview({ configuration, t, tt }: { configuration: Configuration; t: ScreensCopy; tt: TradesCopy }) {
  const language = configuration.language.app;
  const [range, setRange] = useState<Range>("today");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [receipt, setReceipt] = useState<string | null>(null);
  const period = useMemo(() => periodOf(range), [range]);

  useEffect(() => {
    void machine.reportSummary(period).then((answer) => answer.ok && setSummary(answer.value));
    void machine.salesBetween(period.from, period.to).then((answer) => answer.ok && setSales(answer.value));
  }, [period]);

  const kind = (sale: SaleSummary) =>
    sale.reversesNumber !== null ? fill(t.reversalTag, { number: sale.reversesNumber }) : sale.status === "voided" ? t.voidedTag : tt.saleKind;
  const paidBy = (sale: SaleSummary) =>
    sale.payment === "mobile" ? sale.mobileApp || t.payMobile : sale.payment === "credit" ? sale.customerName ?? t.payCredit : t.payCash;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.overviewTitle}>
        <Choices<Range>
          value={range}
          onChange={setRange}
          options={[
            { value: "today", label: tt.rangeDay },
            { value: "week", label: tt.rangeWeek },
            { value: "month", label: tt.rangeMonth },
          ]}
        />
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-3 gap-3">
          <Stat label={tt.netRevenue} value={money(summary?.net ?? 0, language)} strong />
          <Stat label={tt.transactions} value={String(summary?.count ?? 0)} note={summary && summary.count > 0 ? `${t.average} : ${money(summary.average, language)}` : undefined} />
          <Stat label={tt.itemsSold} value={formatQuantity(summary?.itemsSold ?? 0, language)} />
        </div>

        <section className="mt-6 rounded-xl border-2 border-line bg-surface">
          <h2 className="border-b border-line px-5 py-4 text-xl font-semibold">{tt.transactionsTitle}</h2>
          {sales.length === 0 ? (
            <Empty title={tt.noTransactions} />
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr className="border-b-2 border-line text-ink-3">
                  <th className="px-5 py-2 text-start font-normal">{t.colTime}</th>
                  <th className="px-3 py-2 text-start font-normal">{tt.transactionKind}</th>
                  <th className="px-3 py-2 text-start font-normal">{tt.transactionWhat}</th>
                  <th className="px-3 py-2 text-start font-normal">{t.colPayment}</th>
                  <th className="px-3 py-2 text-end font-normal">{t.colAmount}</th>
                  <th className="px-5 py-2 text-end font-normal">
                    <span className="sr-only">{t.receipt}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} onClick={() => setReceipt(sale.id)} className="cursor-pointer border-b border-line hover:bg-hover">
                    <td className="px-5 py-3 align-top text-ink-2">
                      <bdi>{when(sale.occurredAt, language)}</bdi>
                    </td>
                    <td className={`px-3 py-3 align-top font-semibold ${sale.reversesNumber !== null || sale.status === "voided" ? "text-danger" : ""}`}>
                      {kind(sale)} <bdi className="font-normal text-ink-3">n° {sale.number}</bdi>
                    </td>
                    <td className="max-w-[320px] px-3 py-3 align-top text-ink-2">
                      <span className="line-clamp-2">{sale.itemNames}</span>
                    </td>
                    <td className="px-3 py-3 align-top">{paidBy(sale)}</td>
                    <td className={`px-3 py-3 text-end align-top font-semibold ${sale.status === "voided" ? "text-ink-3 line-through" : ""}`}>
                      <bdi>{money(sale.total, language)}</bdi>
                    </td>
                    <td className="px-5 py-1.5 text-end align-top">
                      <Button onClick={() => setReceipt(sale.id)}>{t.receipt}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {receipt ? <ReceiptView saleId={receipt} t={t} onClose={() => setReceipt(null)} /> : null}
    </div>
  );
}
