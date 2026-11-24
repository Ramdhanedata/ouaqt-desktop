import { createPortal } from "react-dom";
import type { Configuration } from "@app-ui/config";
import type { ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { icons } from "../icons";
import { Button, DayFigures } from "../ui";
import { useHeaderSlot } from "../shell";
import { EndOfDayButton } from "./end-of-day";

/*
 * The top of every till: the screen's name, the day so far, the day's
 * sales and the end of the day. The restaurant's counter had it first; the
 * shop, the pharmacy, the bakery and the others now have the very same bar,
 * so an owner who knows one till knows them all.
 *
 * On a computer, these sit in the window's own top bar, beside the shop's
 * mark. On a phone, two short lines: the day's figures
 * across the width, then the two buttons sharing it, instead of three rows
 * of boxes pushing the products down. The screen's name is already lit in
 * the bar at the bottom, so it is not said twice up here.
 */
export function TillHeader({
  title,
  total,
  count,
  countLabel,
  onHistory,
  configuration,
  t,
  tt,
}: {
  title: string;
  total: number;
  count: number;
  countLabel: string;
  onHistory: () => void;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
}) {
  const language = configuration.language.app;
  const slot = useHeaderSlot();

  /* On a computer, the figures and the two day buttons go up into the window's top bar. */
  if (slot) {
    return (
      <>
        <h1 className="sr-only">{title}</h1>
        {createPortal(
          <>
            <DayFigures total={total} count={count} totalLabel={tt.dayTotal} countLabel={countLabel} language={language} />
            <Button kind="sand" onClick={onHistory}>
              <span className="flex items-center justify-center gap-2">
                <icons.reports size={20} />
                {tt.history}
              </span>
            </Button>
            <EndOfDayButton configuration={configuration} t={t} tt={tt} />
          </>,
          slot
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-[72px] shrink-0 items-center justify-between gap-4 border-b border-line px-6 max-md:flex-col max-md:items-stretch max-md:gap-2 max-md:px-4 max-md:py-3">
      <h1 className="text-2xl font-semibold max-md:sr-only">{title}</h1>
      <div className="flex items-center gap-2 max-md:flex-col max-md:items-stretch">
        <div className="max-md:[&>div>div]:flex-1">
          <DayFigures total={total} count={count} totalLabel={tt.dayTotal} countLabel={countLabel} language={language} />
        </div>
        <div className="flex items-center gap-2 max-md:[&>*]:flex-1 max-md:[&>div>button]:w-full max-md:[&>div>button>span]:justify-center">
          <div>
            <Button kind="sand" onClick={onHistory}>
              <span className="flex items-center justify-center gap-2">
                <icons.reports size={20} />
                {tt.history}
              </span>
            </Button>
          </div>
          <div>
            <EndOfDayButton configuration={configuration} t={t} tt={tt} />
          </div>
        </div>
      </div>
    </div>
  );
}
