/* What the hotel's screens share: the name, colour and badge of a room's state, and the filters over a long board. See hotel.tsx. */

import { type Room } from "../bridge";
import type { TradesCopy } from "../i18n/trades";

/* Up to this many rooms the board fits one screen, and filters by type or floor only add clutter. */
export const FILTERS_FROM = 12; // not-a-rule: a board that is read at a glance

export const STATE_BAR: Record<Room["state"], string> = {
  available: "border-s-success",
  occupied: "border-s-accent",
  reserved: "border-s-warning",
  cleaning: "border-s-line-strong",
  maintenance: "border-s-danger",
  out_of_service: "border-s-ink-3",
};

const STATE_BADGE: Record<Room["state"], string> = {
  available: "bg-success-soft text-success",
  occupied: "bg-accent text-accent-foreground",
  reserved: "bg-warning-soft text-warning",
  cleaning: "bg-hover text-ink-2",
  maintenance: "bg-danger-soft text-danger",
  out_of_service: "bg-selected text-ink-3",
};

export function stateLabel(state: Room["state"], tt: TradesCopy): string {
  return {
    available: tt.stateAvailable,
    occupied: tt.stateOccupied,
    reserved: tt.stateReserved,
    cleaning: tt.stateCleaning,
    maintenance: tt.stateMaintenance,
    out_of_service: tt.stateOut,
  }[state];
}

export function StateBadge({ state, tt }: { state: Room["state"]; tt: TradesCopy }) {
  return <span className={`inline-block rounded-md px-2 py-0.5 text-base font-semibold ${STATE_BADGE[state]}`}>{stateLabel(state, tt)}</span>;
}

export function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-[48px] rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
