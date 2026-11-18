/*
 * One stay, from arrival to the bill: what was booked, what was added, what
 * was paid, and the buttons to check in, check out and settle. See hotel.tsx.
 */

import { useCallback, useEffect, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type Folio, type Product, type Room, type Stay } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Confirm, Field, Notice, Panel, day, money, parseMoney, parseQuantity } from "../ui";
import { PaymentBox, paymentProblem } from "./payment";

export function StayPanel({
  stayId,
  title,
  rooms,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onChanged,
}: {
  stayId: string;
  title: string;
  rooms: Room[];
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Panel title={title} onClose={onClose} closeLabel={t.close}>
      <StayView stayId={stayId} rooms={rooms} configuration={configuration} t={t} tt={tt} readOnly={readOnly} onChanged={onChanged} />
    </Panel>
  );
}

/*
 * One stay, as the hotel app's room panel showed it: since when the room is
 * taken, the guest and the dates, the services asked for, the balance with
 * the bill to look over, and what to do next.
 */
export function StayView({
  stayId,
  rooms,
  configuration,
  t,
  tt,
  readOnly,
  onChanged,
}: {
  stayId: string;
  rooms: Room[];
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const language = configuration.language.app;
  const features = configuration.features.hotel;
  const [folio, setFolio] = useState<Folio | null>(null);
  const [extras, setExtras] = useState<Product[]>([]);
  const [what, setWhat] = useState("");
  const [price, setPrice] = useState("");
  const [count, setCount] = useState("1");
  const [advance, setAdvance] = useState("");
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [leaves, setLeaves] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [refund, setRefund] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    void machine.folio(stayId).then((answer) => {
      if (!answer.ok) return;
      setFolio(answer.value);
      setLeaves(answer.value.stay.leavesOn);
    });
  }, [stayId]);
  useEffect(() => {
    load();
    setPaying(false);
    setEditing(false);
    void machine.products().then(setExtras);
  }, [load]);

  if (!folio) return null;
  const stay: Stay = folio.stay;
  const services = folio.lines.filter((line) => line.kind === "service");
  const said = (answer: { ok: boolean; reason?: string }) => {
    setProblem(answer.ok ? null : answer.reason === "room taken" ? tt.roomTaken : answer.reason === "read_only" ? t.readOnly : t.notSaved);
    return answer.ok;
  };

  const addExtra = async (label: string, unitPrice: number, quantity = 1) => {
    said(await machine.addCharge({ stayId, label, unitPrice, quantity }));
    load();
  };

  return (
    <div>
      <div
        className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${
          stay.status === "in" ? "bg-accent text-accent-foreground" : stay.status === "reserved" ? "bg-warning-soft text-warning" : "bg-hover text-ink-2"
        }`}
      >
        <span className="text-lg font-semibold">
          {stay.status === "in"
            ? fill(tt.occupiedSince, { date: day(stay.checkedInAt ? stay.checkedInAt.slice(0, 10) : stay.arrivesOn, language) })
            : stay.status === "reserved"
              ? fill(tt.arrivalOn, { date: day(stay.arrivesOn, language) })
              : stay.status === "out"
                ? tt.stayOut
                : tt.stayCancelled}
        </span>
        <bdi className="text-base">{fill(tt.room, { n: stay.roomNumber })}</bdi>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-base">
        <Detail label={tt.guest} value={stay.guest} strong />
        <Detail label={tt.guestsCount} value={String(stay.adults)} />
        <Detail label={tt.arrivesOn} value={day(stay.arrivesOn, language)} />
        <Detail label={tt.leavesOn} value={day(stay.leavesOn, language)} />
        {stay.phone ? <Detail label={tt.phone} value={stay.phone} ltr /> : null}
        {stay.idDocument ? <Detail label={tt.idDocument} value={stay.idDocument} ltr /> : null}
      </dl>

      <section className="mt-5">
        <h3 className="text-lg font-semibold">{tt.servicesRequested}</h3>
        {services.length === 0 ? (
          <p className="mt-1 text-base text-ink-3">{tt.noServices}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {services.map((line, index) => (
              <span key={index} className="rounded-md bg-hover px-2 py-1 text-base">
                {line.label}
                {line.quantity !== 1 ? ` (×${line.quantity})` : ""}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border-2 border-line bg-raised p-4">
        <div>
          <div className="text-base text-ink-3">{tt.currentBalance}</div>
          <bdi className={`text-3xl font-bold ${folio.balance > 0 ? "text-danger" : "text-success"}`}>{money(Math.max(0, folio.balance), language)}</bdi>
          <div className="text-base text-ink-3">
            {t.total} <bdi>{money(folio.total, language)}</bdi>
            {folio.received > 0 ? <> · {fill(tt.received, { amount: money(folio.received, language) })}</> : null}
          </div>
        </div>
        <Button onClick={() => void machine.printFolio(stayId)}>{tt.printIt}</Button>
      </div>

      <details className="mt-3">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-base text-ink-2">{tt.folio}</summary>
        <ul className="mt-1">
          {folio.lines.map((line, index) => (
            <li key={index} className="flex justify-between gap-3 border-b border-line py-2 text-base">
              <span>
                {line.label}
                {line.kind === "service" && line.quantity !== 1 ? ` × ${line.quantity}` : ""}
              </span>
              <bdi>{money(line.total, language)}</bdi>
            </li>
          ))}
        </ul>
      </details>
      {problem ? (
        <div className="mt-3">
          <Notice kind="problem" text={problem} />
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {stay.status === "reserved" ? (
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" big disabled={readOnly} onClick={() => void machine.checkIn(stayId).then((answer) => said(answer) && onChanged())}>
              {tt.checkIn}
            </Button>
            <Button kind="quiet" disabled={readOnly} onClick={() => setCancelling(true)}>
              {tt.cancelStay}
            </Button>
          </div>
        ) : null}
        {stay.status === "in" ? (
          paying ? (
            <PaymentBox
              total={Math.max(0, folio.balance)}
              t={t}
              language={language}
              creditEnabled={configuration.common.credit.enabled}
              readOnly={readOnly}
              actionLabel={tt.pay}
              problem={problem}
              onPay={async (choice) => {
                const answer = await machine.checkOut(stayId, choice);
                if (!answer.ok) setProblem(paymentProblem(answer.reason, t));
                else onChanged();
              }}
            />
          ) : (
            <Button kind="primary" big wide disabled={readOnly} onClick={() => setPaying(true)}>
              {tt.checkOut}
            </Button>
          )
        ) : null}
        {stay.status === "in" || stay.status === "reserved" ? (
          editing ? (
            <div className="space-y-3 rounded-lg border-2 border-line p-3">
              <Field label={tt.newDeparture} value={leaves} onChange={setLeaves} kind="date" />
              <label className="block">
                <span className="text-base text-ink-2">{tt.moveRoom}</span>
                <select
                  value={moveTo}
                  onChange={(event) => setMoveTo(event.target.value)}
                  className="mt-1 block min-h-[48px] w-full rounded-lg border-2 border-line-strong px-3 text-base outline-none focus:border-ink"
                >
                  <option value="">{tt.sameRoom}</option>
                  {rooms
                    .filter((one) => one.id !== stay.roomId && one.state === "available")
                    .map((one) => (
                      <option key={one.id} value={one.id}>
                        {fill(tt.room, { n: one.number })}
                        {one.kind ? ` · ${one.kind}` : ""}
                      </option>
                    ))}
                </select>
              </label>
              <div className="flex gap-2">
                <Button onClick={() => setEditing(false)}>{t.cancel}</Button>
                <Button
                  kind="primary"
                  disabled={readOnly || (!moveTo && leaves === stay.leavesOn)}
                  onClick={() =>
                    void machine.editStay(stayId, { leavesOn: leaves, ...(moveTo ? { roomId: moveTo } : {}) }).then((answer) => {
                      if (!said(answer)) return;
                      setEditing(false);
                      setMoveTo("");
                      onChanged();
                    })
                  }
                >
                  {t.save}
                </Button>
              </div>
            </div>
          ) : (
            <Button wide disabled={readOnly} onClick={() => setEditing(true)}>
              {tt.editStay}
            </Button>
          )
        ) : null}
      </div>

      {stay.status === "in" && features?.extras !== false ? (
        <div className="mt-5 rounded-lg border-2 border-line p-3">
          <div className="mb-2 text-base font-semibold">{tt.addExtra}</div>
          {extras.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {extras.slice(0, 12).map((extra) => (
                <Button key={extra.id} disabled={readOnly} onClick={() => void addExtra(extra.name, extra.salePrice)}>
                  {extra.name} · <bdi>{money(extra.salePrice, language)}</bdi>
                </Button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[1fr_90px_130px_auto] max-md:grid-cols-2 items-end gap-2">
            <Field label={tt.extraWhat} value={what} onChange={setWhat} />
            <Field label={tt.quantityShort} value={count} onChange={setCount} kind="number" />
            <Field label={tt.extraPrice} value={price} onChange={setPrice} kind="amount" />
            <Button
              disabled={readOnly || parseMoney(price) === null}
              onClick={() => {
                void addExtra(what.trim() || tt.extraDefault, parseMoney(price) as number, parseQuantity(count) ?? 1);
                setWhat("");
                setPrice("");
                setCount("1");
              }}
            >
              {tt.addItem}
            </Button>
          </div>
        </div>
      ) : null}

      {features?.advances !== false && (stay.status === "in" || stay.status === "reserved") ? (
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <Field label={tt.takeAdvance} value={advance} onChange={setAdvance} kind="amount" />
          </div>
          <Button
            disabled={readOnly || !parseMoney(advance)}
            onClick={() => void machine.addAdvance(stayId, parseMoney(advance) as number, "cash").then((answer) => { said(answer); setAdvance(""); load(); })}
          >
            {t.payCash}
          </Button>
          <Button
            disabled={readOnly || !parseMoney(advance)}
            onClick={() => void machine.addAdvance(stayId, parseMoney(advance) as number, "mobile").then((answer) => { said(answer); setAdvance(""); load(); })}
          >
            {t.payMobile}
          </Button>
        </div>
      ) : null}

      {cancelling ? (
        <Confirm
          title={tt.cancelStay}
          body={folio.received > 0 ? tt.cancelStayBody : undefined}
          yes={tt.cancelStay}
          no={tt.back}
          onNo={() => setCancelling(false)}
          onYes={() => {
            setCancelling(false);
            void machine.cancelStay(stayId, refund).then((answer) => said(answer) && onChanged());
          }}
        >
          {folio.received > 0 ? (
            <Choices<"refund" | "keep">
              value={refund ? "refund" : "keep"}
              onChange={(value) => setRefund(value === "refund")}
              options={[
                { value: "refund", label: tt.refund },
                { value: "keep", label: tt.keep },
              ]}
            />
          ) : null}
        </Confirm>
      ) : null}
    </div>
  );
}

function Detail({ label, value, strong, ltr }: { label: string; value: string; strong?: boolean; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className={strong ? "text-lg font-semibold" : ""}>
        <bdi dir={ltr ? "ltr" : undefined}>{value}</bdi>
      </dd>
    </div>
  );
}
