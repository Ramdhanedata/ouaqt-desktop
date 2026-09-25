import { useEffect, type ReactNode } from "react";
import { icons } from "./icons";

/*
 * A window over the screen, closed by its cross, by Escape or by a click
 * outside it. The counter's history and end of day open in one, and so does
 * a receipt on any screen.
 */

export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-6" onMouseDown={onClose}>
      <div
        className={`flex max-h-full w-full flex-col rounded-xl bg-surface shadow-2xl ${wide ? "max-w-3xl" : "max-w-md"}`}
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-[64px] shrink-0 items-center justify-between gap-4 border-b border-line px-6">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button type="button" aria-label="×" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-hover">
            <icons.close />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="shrink-0 border-t border-line px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}
