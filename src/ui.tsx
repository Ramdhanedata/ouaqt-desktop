import { useEffect, useRef, type ReactNode } from "react";
import type { AppLanguage } from "@app-ui/config";
import { formatDateTime, formatMoney } from "@app-ui/format";
import { icons } from "./icons";

/*
 * The few pieces every screen is built from.
 *
 * Black on white, large enough to hit with a thumb, nothing under 16px, and
 * one way to do each thing: one button, one field, one side panel. A cashier
 * who has learnt one screen has learnt them all.
 */

/*
 * An amount or a date dropped into an Arabic sentence is kept whole and left
 * to right with Unicode isolates. Without them "تحصيل 810,00 MRU" came out as
 * "MRU 810,00 تحصيل", with the currency on the wrong side of its number.
 */
function isolate(text: string, language: AppLanguage): string {
  return language === "ar" ? `\u2066${text}\u2069` : text;
}

export function money(minor: number, language: AppLanguage): string {
  return isolate(formatMoney(minor, language), language);
}

export function when(iso: string, language: AppLanguage): string {
  return isolate(formatDateTime(new Date(iso), language), language);
}

/** A day in this computer's own time zone, as the database writes dates (YYYY-MM-DD). */
export function localDay(offsetDays = 0, from = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The time of day alone, HH:MM, which reads the same in every language. */
export function clock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** A date as the batches write it (YYYY-MM-DD), shown the way the shop reads one. */
export function day(date: string | null, language: AppLanguage): string {
  if (!date) return "";
  const [year, month, dayOfMonth] = date.split("-");
  return isolate(language === "en" ? date : `${dayOfMonth}/${month}/${year}`, language);
}

/*
 * What a person types for an amount, into minor units. "150", "150,5",
 * "150.50" and "1 250" are all understood; anything else is null, and the
 * field says so rather than guessing.
 */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[\s  ]/g, "").replace(",", ".");
  if (!clean) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** The same amount back as text, for a field that is being edited. */
export function moneyText(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const whole = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100);
  return cents === 0 ? String(whole) : `${whole},${String(cents).padStart(2, "0")}`;
}

export function parseQuantity(text: string): number | null {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  if (!/^\d+(\.\d{0,3})?$/.test(clean)) return null;
  return Number(clean);
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  wide?: boolean;
  big?: boolean;
  title?: string;
};

export function Button({ children, onClick, kind = "secondary", disabled, type = "button", wide, big, title }: ButtonProps) {
  const base = `${big ? "min-h-[56px] text-lg" : "min-h-[48px] text-base"} rounded-lg px-4 font-medium disabled:opacity-30 ${wide ? "w-full" : ""}`;
  const look = {
    primary: "bg-ink text-on-ink active:bg-ink/80",
    secondary: "border-2 border-line-strong bg-surface text-ink active:bg-hover",
    quiet: "text-ink-2 underline-offset-4 hover:underline",
    danger: "border-2 border-ink bg-surface text-ink active:bg-hover",
  }[kind];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={`${base} ${look}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  kind = "text",
  autoFocus,
  ltr,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  kind?: "text" | "date" | "amount" | "number";
  autoFocus?: boolean;
  /** Numbers, codes and dates read left to right even on an Arabic screen. */
  ltr?: boolean;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className="text-base text-ink-2">{label}</span>
      <input
        type={kind === "date" ? "date" : "text"}
        inputMode={kind === "amount" || kind === "number" ? "decimal" : undefined}
        dir={ltr || kind !== "text" ? "ltr" : "auto"}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onEnter) onEnter();
        }}
        className={`mt-1 min-h-[48px] w-full rounded-lg border-2 px-3 text-base outline-none focus:border-ink ${
          error ? "border-ink" : "border-line-strong"
        } ${ltr || kind !== "text" ? "text-left" : ""}`}
      />
      {error ? <span className="mt-1 block text-base font-semibold">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-base text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center gap-3">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-6 w-6 accent-ink" />
      <span className="text-base">{label}</span>
    </label>
  );
}

/* A row of choices where exactly one is picked: periods, payment kinds, filters. */
export function Choices<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`min-h-[48px] rounded-lg px-4 text-base ${
            option.value === value ? "bg-ink font-semibold text-on-ink" : "border-2 border-line-strong bg-surface text-ink"
          }`}
        >
          {option.label}
          {option.count !== undefined ? <span className="ms-2 opacity-70">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  strong,
  onClick,
  active,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-lg border-2 p-4 text-start ${active ? "border-ink" : "border-line"} ${onClick ? "active:bg-hover" : ""}`}
    >
      <div className="text-base text-ink-3">{label}</div>
      <div className={`mt-1 text-2xl ${strong ? "font-bold" : "font-semibold"}`}>
        <bdi>{value}</bdi>
      </div>
      {note ? <div className="mt-1 text-base text-ink-3">{note}</div> : null}
    </Tag>
  );
}

export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[72px] shrink-0 items-center justify-between gap-4 border-b border-line px-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/*
 * A panel that slides over the end of the screen, for one product, one
 * customer or one sale. The list stays visible beside it, so the cashier
 * never loses his place.
 */
export function Panel({
  title,
  onClose,
  closeLabel,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-scrim" onMouseDown={onClose}>
      <div
        className="flex h-full w-[560px] max-w-full flex-col bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="flex min-h-[72px] shrink-0 items-center justify-between gap-4 border-b border-line px-6">
          <h2 className="text-xl font-semibold">{title}</h2>
          <Button kind="secondary" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="shrink-0 border-t border-line px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

/* A question that needs an answer before anything is written. */
export function Confirm({
  title,
  body,
  yes,
  no,
  onYes,
  onNo,
  children,
}: {
  title: string;
  body?: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6">
      <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl" role="alertdialog" aria-label={title}>
        <h2 className="text-xl font-semibold">{title}</h2>
        {body ? <p className="mt-3 text-base leading-relaxed text-ink-2">{body}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onNo}>{no}</Button>
          <Button kind="primary" onClick={onYes}>
            {yes}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Notice({ text, kind = "info" }: { text: string; kind?: "info" | "problem" | "done" }) {
  return (
    <div
      role={kind === "problem" ? "alert" : "status"}
      className={`rounded-lg p-4 text-base leading-relaxed text-ink ${
        kind === "problem"
          ? "border-2 border-danger bg-danger-soft font-semibold"
          : kind === "done"
            ? "border-2 border-success bg-success-soft"
            : "bg-hover"
      }`}
    >
      {text}
    </div>
  );
}

/*
 * Something on the shelf that needs attention: out of stock, low, expired,
 * expiring. Its own colour and a mark, so it never reads like the price
 * beside it, and stays readable in dark mode where it matters most.
 */
/*
 * Takings day by day, as bars: today's in the brand's gold, the others in
 * the line colour, each day named under its bar when there are few enough
 * to name. Drawn left to right in every language, as a time line is.
 */
export function DayChart({
  days,
  language,
  todayLabel,
  height = 180,
}: {
  days: { day: string; net: number }[];
  language: AppLanguage;
  todayLabel: string;
  height?: number;
}) {
  const peak = Math.max(1, ...days.map((one) => one.net));
  const named = days.length <= 10; // not-a-rule: past ten bars, day names no longer fit under them
  const weekday = new Intl.DateTimeFormat(language === "ar" ? "ar" : language === "en" ? "en-GB" : "fr-FR", { weekday: "short" });
  return (
    <div className="flex items-end gap-2 rounded-lg border-2 border-line bg-surface p-4" dir="ltr" style={{ height }}>
      {days.map((one, index) => {
        const last = index === days.length - 1;
        const [year, month, dayOfMonth] = one.day.split("-").map(Number);
        return (
          <div key={one.day} className="flex h-full min-w-0 flex-1 flex-col items-center gap-2" title={`${day(one.day, language)} · ${money(one.net, language)}`}>
            <div className="flex min-h-0 w-full flex-1 items-end">
              <div
                className={`w-full rounded-t-md ${last ? "bg-accent" : "bg-line-strong"}`}
                style={{ height: `${Math.max(one.net > 0 ? 3 : 1, (one.net / peak) * 100)}%` }}
              />
            </div>
            {named ? (
              <span className={`w-full truncate text-center text-base ${last ? "font-bold text-ink" : "text-ink-3"}`}>
                {last ? todayLabel : weekday.format(new Date(year, month - 1, dayOfMonth))}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/*
 * The day so far, beside a till's title: what came in and how many sales.
 * The same box on every till, so a cashier who moves from the restaurant's
 * to the bakery's reads it in the same place.
 */
export function DayFigures({
  total,
  count,
  totalLabel,
  countLabel,
  language,
}: {
  total: number;
  count: number;
  totalLabel: string;
  countLabel: string;
  language: AppLanguage;
}) {
  return (
    <div className="flex shrink-0 divide-x divide-line rounded-lg border-2 border-line bg-surface rtl:divide-x-reverse">
      <div className="px-4 py-1 text-end">
        <div className="whitespace-nowrap text-base text-ink-3">{totalLabel}</div>
        <div className="whitespace-nowrap text-lg font-bold">
          <bdi>{money(total, language)}</bdi>
        </div>
      </div>
      <div className="px-4 py-1 text-end">
        <div className="whitespace-nowrap text-base text-ink-3">{countLabel}</div>
        <div className="text-lg font-bold">
          <bdi>{count}</bdi>
        </div>
      </div>
    </div>
  );
}

export function Flag({ kind, children }: { kind: "danger" | "warning"; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${kind === "danger" ? "text-danger" : "text-warning"}`}>
      <icons.warning size={16} className="shrink-0" />
      {children}
    </span>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="text-xl font-semibold">{title}</div>
      {body ? <div className="mt-2 max-w-md text-base leading-relaxed text-ink-3">{body}</div> : null}
    </div>
  );
}

/** Focus a field when it appears, and again whenever `again` changes. */
export function useFocus<T extends HTMLElement>(again?: unknown) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [again]);
  return ref;
}
