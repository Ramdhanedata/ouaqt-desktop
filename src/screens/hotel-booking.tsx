/* Booking a room: the form, and the panel that opens it from the board. See hotel.tsx. */

import { useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type Room } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Field, Notice, Panel, localDay, money, moneyText, parseMoney, parseQuantity } from "../ui";

/* A booking started from the board's button: the free rooms first, then the guest. */
export function NewBooking({
  rooms,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onDone,
}: {
  rooms: Room[];
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const language = configuration.language.app;
  const [room, setRoom] = useState<Room | null>(null);
  const free = rooms.filter((one) => one.state === "available");
  return (
    <Panel title={room ? `${tt.newBooking} · ${fill(tt.room, { n: room.number })}` : tt.newBooking} onClose={onClose} closeLabel={t.close}>
      {room ? (
        <BookingForm room={room} configuration={configuration} t={t} tt={tt} readOnly={readOnly} onDone={onDone} />
      ) : free.length === 0 ? (
        <p className="text-lg text-ink-3">{tt.noFreeRoom}</p>
      ) : (
        <>
          <p className="mb-3 text-base text-ink-2">{tt.chooseRoom}</p>
          <div className="grid grid-cols-2 gap-3">
            {free.map((one) => (
              <button
                key={one.id}
                type="button"
                onClick={() => setRoom(one)}
                className="flex min-h-[88px] flex-col justify-between rounded-xl border-2 border-line-strong bg-surface p-3 text-start hover:border-ink"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <bdi className="text-xl font-bold">{one.number}</bdi>
                  <span className="text-base text-ink-3">{one.kind ?? ""}</span>
                </span>
                <bdi className="text-base font-semibold">{money(one.rate, language)}</bdi>
              </button>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

export function BookingForm({
  room,
  configuration,
  t,
  tt,
  readOnly,
  onDone,
}: {
  room: Room;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onDone: () => void;
}) {
  const features = configuration.features.hotel;
  const [mode, setMode] = useState<"now" | "later">("now");
  const [guest, setGuest] = useState("");
  const [phone, setPhone] = useState("");
  const [document, setDocument] = useState("");
  const [nationality, setNationality] = useState("");
  const [adults, setAdults] = useState("1");
  const [arrives, setArrives] = useState(localDay());
  const [leaves, setLeaves] = useState(localDay(1));
  const [rate, setRate] = useState(moneyText(room.rate));
  const [advance, setAdvance] = useState("");
  const [how, setHow] = useState<"cash" | "mobile">("cash");
  const [problem, setProblem] = useState<string | null>(null);
  const rateMinor = rate.trim() ? parseMoney(rate) : 0;
  const advanceMinor = advance.trim() ? parseMoney(advance) : 0;
  const datesBad = !(leaves > (mode === "now" ? localDay() : arrives));
  const valid = rateMinor !== null && advanceMinor !== null && !datesBad;

  async function save() {
    if (!valid) return;
    const answer = await machine.bookStay({
      roomId: room.id,
      guest,
      phone,
      idDocument: document,
      nationality,
      adults: parseQuantity(adults) ?? 1,
      arrivesOn: mode === "now" ? localDay() : arrives,
      leavesOn: leaves,
      rate: rateMinor as number,
      advance: advanceMinor as number,
      advancePayment: how,
      checkInNow: mode === "now",
    });
    if (!answer.ok) {
      setProblem(answer.reason === "room taken" ? tt.roomTaken : answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onDone();
  }

  return (
    <div className="space-y-3">
      <Choices<"now" | "later">
        value={mode}
        onChange={setMode}
        options={[
          { value: "now", label: tt.arriveNow },
          { value: "later", label: tt.book },
        ]}
      />
      <Field label={tt.guest} value={guest} onChange={setGuest} autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Field label={tt.phone} value={phone} onChange={setPhone} ltr />
        <Field label={tt.adults} value={adults} onChange={setAdults} kind="number" />
        {features?.guestDocument !== false ? <Field label={tt.idDocument} value={document} onChange={setDocument} ltr /> : null}
        {features?.guestDocument !== false ? <Field label={tt.nationality} value={nationality} onChange={setNationality} /> : null}
        {mode === "later" ? <Field label={tt.arrivesOn} value={arrives} onChange={setArrives} kind="date" /> : null}
        <Field label={tt.leavesOn} value={leaves} onChange={setLeaves} kind="date" error={datesBad ? tt.leavesAfterArrival : null} />
        <Field label={tt.rate} value={rate} onChange={setRate} kind="amount" error={rateMinor === null ? t.badAmount : null} />
        {features?.advances !== false ? <Field label={tt.advance} value={advance} onChange={setAdvance} kind="amount" error={advanceMinor === null ? t.badAmount : null} /> : null}
      </div>
      {features?.advances !== false && advanceMinor ? (
        <Choices<"cash" | "mobile"> value={how} onChange={setHow} options={[{ value: "cash", label: t.payCash }, { value: "mobile", label: t.payMobile }]} />
      ) : null}
      {problem ? <Notice kind="problem" text={problem} /> : null}
      <Button kind="primary" big wide disabled={readOnly || !valid} onClick={() => void save()}>
        {mode === "now" ? tt.checkIn : tt.book}
      </Button>
    </div>
  );
}
