import { useCallback, useEffect, useMemo, useState } from "react";
import type { Configuration } from "@app-ui/config";
import { machine, type Product, type WashJob, type WashKind, type WashReport } from "../bridge";
import { fill, type ScreensCopy } from "../i18n/screens";
import type { TradesCopy } from "../i18n/trades";
import { Button, Choices, Confirm, DayFigures, Empty, Field, Notice, Panel, ScreenHeader, clock, day, localDay, money, parseMoney, parseQuantity } from "../ui";
import { PaymentBox, paymentProblem } from "./payment";

/*
 * A wash's day, on one board: what waits, what is being washed, what is ready
 * to be paid for and taken away. The next step of a job is one press on its
 * card, because the hands pressing it are wet.
 *
 * A shop says what it washes. A car wash never sees a sofa, and the other way
 * round; a shop that does both sees both on the same board.
 */

type Screen = { configuration: Configuration; t: ScreensCopy; tt: TradesCopy; readOnly: boolean };

const VEHICLES = ["car", "suv", "truck", "moto"] as const;
type Vehicle = (typeof VEHICLES)[number];

function vehicleWord(vehicle: string | null, tt: TradesCopy): string | null {
  const words: Record<Vehicle, string> = { car: tt.washVehicleCar, suv: tt.washVehicleSuv, truck: tt.washVehicleTruck, moto: tt.washVehicleMoto };
  return vehicle && vehicle in words ? words[vehicle as Vehicle] : vehicle;
}

function nameOf(item: { name: string; nameArabic: string | null }, language: string): string {
  return language === "ar" && item.nameArabic ? item.nameArabic : item.name;
}

/* A car is known by its plate; a piece left for days, by whoever is coming back for it. */
function titleOf(job: WashJob): string {
  return job.kind === "car" ? job.plate ?? "" : job.customer ?? "";
}

export function Washes({ configuration, t, tt, readOnly }: Screen) {
  const language = configuration.language.app;
  const washes = configuration.features.wash?.washes ?? ["cars"];
  const both = washes.length > 1;
  const [jobs, setJobs] = useState<WashJob[]>([]);
  const [today, setToday] = useState<WashReport | null>(null);
  const [filter, setFilter] = useState<"all" | WashKind>("all");
  const [creating, setCreating] = useState<WashKind | null>(null);
  const [open, setOpen] = useState<{ job: WashJob; paying: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    void machine.washJobs().then((answer) => answer.ok && setJobs(answer.value));
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    void machine.washReport(from, to).then((answer) => answer.ok && setToday(answer.value));
  }, []);
  useEffect(reload, [reload]);

  const todayIso = localDay();
  const shown = jobs.filter((job) => filter === "all" || job.kind === filter);
  const columns = [
    { status: "waiting" as const, title: tt.washWaiting },
    { status: "washing" as const, title: tt.washWashing },
    { status: "ready" as const, title: tt.washReady },
  ];

  async function advance(job: WashJob) {
    if (job.status === "ready") {
      setOpen({ job, paying: true });
      return;
    }
    const answer = await machine.setWashStatus(job.id, job.status === "waiting" ? "washing" : "ready");
    if (!answer.ok) setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
    else setProblem(null);
    reload();
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={tt.washesTitle}>
        {today ? <DayFigures total={today.amount} count={today.jobs} totalLabel={tt.dayTotal} countLabel={tt.navWashes} language={language} /> : null}
        {washes.includes("cars") ? (
          <Button kind="primary" disabled={readOnly} onClick={() => setCreating("car")}>
            {tt.washNewCar}
          </Button>
        ) : null}
        {washes.includes("upholstery") ? (
          <Button kind={washes.includes("cars") ? "secondary" : "primary"} disabled={readOnly} onClick={() => setCreating("upholstery")}>
            {tt.washNewPiece}
          </Button>
        ) : null}
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        {problem ? <div className="mb-4"><Notice kind="problem" text={problem} /></div> : null}
        {both ? (
          <div className="mb-4 max-md:overflow-x-auto">
            <Choices<"all" | WashKind>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: tt.washAll, count: jobs.length },
                { value: "car", label: tt.washCars, count: jobs.filter((job) => job.kind === "car").length },
                { value: "upholstery", label: tt.washPieces, count: jobs.filter((job) => job.kind === "upholstery").length },
              ]}
            />
          </div>
        ) : null}

        {shown.length === 0 ? (
          <Empty title={tt.washEmpty} body={tt.washEmptyBody} />
        ) : (
          <div className="grid grid-cols-3 items-start gap-4 max-md:grid-cols-1">
            {columns.map((column) => {
              const here = shown.filter((job) => job.status === column.status);
              return (
                <section key={column.status}>
                  <h2 className="mb-2 flex items-center justify-between text-lg font-semibold">
                    <span>{column.title}</span>
                    <span className="text-base font-normal text-ink-3">{here.length}</span>
                  </h2>
                  <ul className="space-y-3">
                    {here.map((job) => (
                      <li key={job.id}>
                        <JobCard
                          job={job}
                          language={language}
                          tt={tt}
                          late={job.kind === "upholstery" && Boolean(job.dueOn) && job.status !== "ready" && (job.dueOn as string) <= todayIso}
                          readOnly={readOnly}
                          onOpen={() => setOpen({ job, paying: false })}
                          onNext={() => void advance(job)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {creating ? (
        <NewJob
          kind={creating}
          configuration={configuration}
          t={t}
          tt={tt}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            reload();
          }}
        />
      ) : null}
      {open ? (
        <JobPanel
          key={open.job.id}
          job={open.job}
          startPaying={open.paying}
          configuration={configuration}
          t={t}
          tt={tt}
          readOnly={readOnly}
          onClose={() => {
            setOpen(null);
            reload();
          }}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}

function JobCard({
  job,
  language,
  tt,
  late,
  readOnly,
  onOpen,
  onNext,
}: {
  job: WashJob;
  language: Configuration["language"]["app"];
  tt: TradesCopy;
  late: boolean;
  readOnly: boolean;
  onOpen: () => void;
  onNext: () => void;
}) {
  const next = job.status === "waiting" ? tt.washStart : job.status === "washing" ? tt.washFinish : tt.washPay;
  const details = [
    job.kind === "car" ? vehicleWord(job.vehicle, tt) : null,
    job.kind === "car" ? job.customer : null,
    job.dueOn ? fill(tt.washDueShort, { date: day(job.dueOn, language) }) : null,
    job.washer,
  ].filter(Boolean);
  return (
    <div className={`rounded-xl border-2 bg-surface ${late ? "border-warning" : "border-line"}`}>
      <button type="button" onClick={onOpen} className="block w-full p-3 text-start hover:bg-hover">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-lg font-semibold leading-snug">
            <bdi>{titleOf(job)}</bdi>
          </span>
          <bdi className="shrink-0 text-lg font-bold text-accent-strong">{money(job.total, language)}</bdi>
        </span>
        <span className="mt-1 block text-base leading-snug text-ink-2">
          {job.lines.map((line) => `${line.quantity} × ${nameOf(line, language)}`).join(", ")}
        </span>
        <span className="mt-1 flex flex-wrap justify-between gap-x-3 text-base text-ink-3">
          <span>{details.join(" · ")}</span>
          <span>{clock(job.receivedAt)}</span>
        </span>
      </button>
      {readOnly ? null : (
        <div className="border-t-2 border-line p-2">
          <Button wide kind={job.status === "ready" ? "primary" : "secondary"} onClick={onNext}>
            {next}
          </Button>
        </div>
      )}
    </div>
  );
}

/* The shop's services, each with how many: a press for a car, a figure for a carpet's square metres. */
function ServicePicker({
  products,
  quantities,
  onChange,
  language,
  t,
  tt,
}: {
  products: Product[];
  quantities: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  language: Configuration["language"]["app"];
  t: ScreensCopy;
  tt: TradesCopy;
}) {
  if (products.length === 0) return <Notice kind="problem" text={tt.washNoServices} />;
  const set = (id: string, value: string) => onChange({ ...quantities, [id]: value });
  const step = (id: string, by: number) => {
    const now = parseQuantity(quantities[id] ?? "") ?? 0;
    const next = Math.max(0, now + by);
    set(id, next > 0 ? String(next) : "");
  };
  return (
    <div className="rounded-lg border-2 border-line">
      <div className="border-b-2 border-line px-3 py-2 text-base font-semibold">{tt.washServices}</div>
      <ul>
        {products.map((product) => (
          <li key={product.id} className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0">
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-snug">{nameOf(product, language)}</span>
              <bdi className="block text-base text-ink-3">{money(product.salePrice, language)}</bdi>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={`${t.remove} ${product.name}`}
                onClick={() => step(product.id, -1)}
                className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-line-strong text-xl font-semibold active:bg-hover"
              >
                −
              </button>
              <input
                value={quantities[product.id] ?? ""}
                onChange={(event) => set(product.id, event.target.value)}
                inputMode="decimal"
                dir="ltr"
                aria-label={`${tt.quantityShort} ${product.name}`}
                className="h-11 w-14 rounded-lg border-2 border-line-strong text-center text-base outline-none focus:border-ink"
              />
              <button
                type="button"
                aria-label={`${tt.addItem} ${product.name}`}
                onClick={() => step(product.id, 1)}
                className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-line-strong text-xl font-semibold active:bg-hover"
              >
                +
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function chosenLines(products: Product[], quantities: Record<string, string>) {
  return products.flatMap((product) => {
    const quantity = parseQuantity(quantities[product.id] ?? "");
    return quantity && quantity > 0 ? [{ productId: product.id, quantity, unitPrice: product.salePrice }] : [];
  });
}

function useServices() {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    void machine.products().then(setProducts);
  }, []);
  return products;
}

/* Names already used, offered as a press, so one washer does not become three spellings in the reports. */
function WasherField({ value, onChange, tt }: { value: string; onChange: (next: string) => void; tt: TradesCopy }) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    void machine.washers().then((answer) => answer.ok && setNames(answer.value));
  }, []);
  return (
    <div>
      <Field label={tt.washWasher} value={value} onChange={onChange} />
      {names.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {names.map((name) => (
            <Button key={name} onClick={() => onChange(name)}>
              {name}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NewJob({
  kind,
  configuration,
  t,
  tt,
  onClose,
  onSaved,
}: {
  kind: WashKind;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const language = configuration.language.app;
  const features = configuration.features.wash;
  const products = useServices();
  const [plate, setPlate] = useState("");
  const [vehicle, setVehicle] = useState<Vehicle>("car");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [dueOn, setDueOn] = useState(localDay(2));
  const [washer, setWasher] = useState("");
  const [note, setNote] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [deposit, setDeposit] = useState("");
  const [how, setHow] = useState<"cash" | "mobile">("cash");
  const [problem, setProblem] = useState<string | null>(null);

  const lines = useMemo(() => chosenLines(products, quantities), [products, quantities]);
  const total = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0);
  const depositMinor = deposit.trim() ? parseMoney(deposit) : 0;
  const named = kind === "car" ? plate.trim() : customer.trim();
  const ready = Boolean(named) && lines.length > 0 && depositMinor !== null && depositMinor <= total;

  async function save() {
    if (!ready) return;
    const answer = await machine.createWashJob({
      kind,
      plate: kind === "car" ? plate : null,
      vehicle: kind === "car" ? vehicle : null,
      customer,
      phone,
      dueOn: kind === "upholstery" ? dueOn : null,
      washer,
      note,
      lines,
      deposit: depositMinor ?? 0,
      depositPayment: how,
    });
    if (!answer.ok) {
      setProblem(answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    onSaved();
  }

  return (
    <Panel
      title={kind === "car" ? tt.washNewCar : tt.washNewPiece}
      onClose={onClose}
      closeLabel={t.close}
      footer={
        <div className="flex items-center justify-between gap-2">
          <bdi className="text-xl font-bold">{money(total, language)}</bdi>
          <Button kind="primary" disabled={!ready} onClick={() => void save()}>
            {t.save}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {kind === "car" ? (
          <>
            <Field label={tt.washPlate} value={plate} onChange={setPlate} ltr />
            <div>
              <div className="mb-1 text-base text-ink-2">{tt.washVehicle}</div>
              <div className="max-md:overflow-x-auto">
                <Choices<Vehicle>
                  value={vehicle}
                  onChange={setVehicle}
                  options={VEHICLES.map((one) => ({ value: one, label: vehicleWord(one, tt) as string }))}
                />
              </div>
            </div>
          </>
        ) : null}
        <Field label={kind === "car" ? tt.washCustomerOptional : tt.customer} value={customer} onChange={setCustomer} />
        <Field label={tt.phone} value={phone} onChange={setPhone} ltr />
        {kind === "upholstery" ? <Field label={tt.washDue} value={dueOn} onChange={setDueOn} kind="date" /> : null}
        <ServicePicker products={products} quantities={quantities} onChange={setQuantities} language={language} t={t} tt={tt} />
        {features?.washers !== false ? <WasherField value={washer} onChange={setWasher} tt={tt} /> : null}
        <Field label={tt.washNote} value={note} onChange={setNote} />
        {kind === "upholstery" && features?.deposit !== false ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={tt.deposit} value={deposit} onChange={setDeposit} kind="amount" error={depositMinor === null ? t.badAmount : null} />
            <div>
              <div className="mb-1 text-base text-ink-2">{t.paymentHow}</div>
              <Choices<"cash" | "mobile">
                value={how}
                onChange={setHow}
                options={[
                  { value: "cash", label: t.payCash },
                  { value: "mobile", label: t.payMobile },
                ]}
              />
            </div>
          </div>
        ) : null}
        {problem ? <Notice kind="problem" text={problem} /> : null}
      </div>
    </Panel>
  );
}

function JobPanel({
  job: first,
  startPaying,
  configuration,
  t,
  tt,
  readOnly,
  onClose,
  onChanged,
}: {
  job: WashJob;
  startPaying: boolean;
  configuration: Configuration;
  t: ScreensCopy;
  tt: TradesCopy;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const language = configuration.language.app;
  const features = configuration.features.wash;
  const products = useServices();
  const [job, setJob] = useState(first);
  const [paying, setPaying] = useState(startPaying);
  const [paidSale, setPaidSale] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [refund, setRefund] = useState(true);
  const [washer, setWasher] = useState(first.washer ?? "");
  const [editing, setEditing] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const due = Math.max(0, job.total - job.received);

  const refresh = useCallback(async () => {
    const answer = await machine.washJob(job.id);
    if (answer.ok && answer.value) setJob(answer.value);
    onChanged();
  }, [job.id, onChanged]);

  const failed = (reason: string) => setProblem(reason === "read_only" ? t.readOnly : t.notSaved);

  async function setStatus(status: "waiting" | "washing" | "ready") {
    const answer = await machine.setWashStatus(job.id, status);
    if (!answer.ok) failed(answer.reason);
    else void refresh();
  }

  async function saveWasher() {
    const answer = await machine.changeWashJob(job.id, { washer });
    if (!answer.ok) failed(answer.reason);
    else void refresh();
  }

  async function saveServices() {
    const lines = chosenLines(products, quantities);
    if (lines.length === 0) return;
    const answer = await machine.changeWashJob(job.id, { lines });
    if (!answer.ok) {
      setProblem(answer.reason.includes("advance") ? tt.washAdvanceTooBig : answer.reason === "read_only" ? t.readOnly : t.notSaved);
      return;
    }
    setEditing(false);
    setProblem(null);
    void refresh();
  }

  if (paidSale) {
    return (
      <Panel title={fill(tt.washNumber, { n: job.number })} onClose={onClose} closeLabel={t.close}>
        <Notice kind="done" text={tt.washPaid} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button kind="primary" onClick={() => void machine.printReceipt(paidSale)}>
            {tt.washReceipt}
          </Button>
          <Button onClick={onClose}>{t.close}</Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={`${fill(tt.washNumber, { n: job.number })} · ${titleOf(job)}`} onClose={onClose} closeLabel={t.close}>
      <dl className="space-y-1 text-base">
        {job.kind === "car" && job.vehicle ? <Detail label={tt.washVehicle} value={vehicleWord(job.vehicle, tt) as string} /> : null}
        {job.kind === "car" && job.customer ? <Detail label={tt.customer} value={job.customer} /> : null}
        {job.phone ? <Detail label={tt.phone} value={job.phone} ltr /> : null}
        {job.dueOn ? <Detail label={tt.washDue} value={day(job.dueOn, language)} /> : null}
        {job.note ? <Detail label={tt.washNote} value={job.note} /> : null}
      </dl>

      {readOnly ? null : (
        <div className="mt-4 max-md:overflow-x-auto">
          <Choices<"waiting" | "washing" | "ready">
            value={job.status === "paid" || job.status === "cancelled" ? "ready" : job.status}
            onChange={(status) => void setStatus(status)}
            options={[
              { value: "waiting", label: tt.washWaiting },
              { value: "washing", label: tt.washWashing },
              { value: "ready", label: tt.washReady },
            ]}
          />
        </div>
      )}

      {editing ? (
        <div className="mt-4 space-y-3">
          <ServicePicker products={products} quantities={quantities} onChange={setQuantities} language={language} t={t} tt={tt} />
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" disabled={chosenLines(products, quantities).length === 0} onClick={() => void saveServices()}>
              {t.save}
            </Button>
            <Button onClick={() => setEditing(false)}>{tt.back}</Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-4">
            {job.lines.map((line, index) => (
              <li key={`${line.productId}-${index}`} className="flex justify-between gap-3 border-b border-line py-2 text-base">
                <span>
                  {line.quantity} × {nameOf(line, language)}
                </span>
                <bdi className="shrink-0">{money(Math.round(line.quantity * line.unitPrice), language)}</bdi>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between text-xl font-bold">
            <span>{t.total}</span>
            <bdi>{money(job.total, language)}</bdi>
          </div>
          {job.received > 0 ? <p className="mt-1 text-base">{fill(tt.depositPaid, { amount: money(job.received, language) })}</p> : null}
          <p className="mt-1 text-lg font-semibold">{fill(tt.toCollect, { amount: money(due, language) })}</p>
        </>
      )}

      {features?.washers !== false && !readOnly ? (
        <div className="mt-4">
          <WasherField value={washer} onChange={setWasher} tt={tt} />
          {washer.trim() !== (job.washer ?? "") ? (
            <div className="mt-2">
              <Button onClick={() => void saveWasher()}>{t.save}</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {!readOnly && !editing ? (
          <Button
            onClick={() => {
              setQuantities(Object.fromEntries(job.lines.map((line) => [line.productId, String(line.quantity)])));
              setEditing(true);
            }}
          >
            {tt.washChangeServices}
          </Button>
        ) : null}
        <Button onClick={() => void machine.printWashJob(job.id)}>{tt.printIt}</Button>
        <Button kind="quiet" disabled={readOnly} onClick={() => setCancelling(true)}>
          {t.cancel}
        </Button>
      </div>

      {problem ? <div className="mt-3"><Notice kind="problem" text={problem} /></div> : null}

      <div className="mt-6">
        {paying ? (
          <PaymentBox
            total={due}
            t={t}
            language={language}
            creditEnabled={configuration.common.credit.enabled}
            readOnly={readOnly}
            actionLabel={tt.pay}
            problem={problem}
            onPay={async (choice) => {
              const answer = await machine.payWashJob(job.id, choice);
              if (!answer.ok) {
                setProblem(paymentProblem(answer.reason, t));
                return;
              }
              setPaidSale(answer.value.id);
              onChanged();
            }}
          />
        ) : (
          <Button kind="primary" big wide disabled={readOnly} onClick={() => setPaying(true)}>
            {tt.washPay}
          </Button>
        )}
      </div>

      {cancelling ? (
        <Confirm
          title={t.cancel}
          body={job.received > 0 ? tt.cancelPreorderBody : undefined}
          yes={t.cancel}
          no={tt.back}
          onNo={() => setCancelling(false)}
          onYes={() => {
            setCancelling(false);
            void machine.cancelWashJob(job.id, refund).then((answer) => {
              if (!answer.ok) failed(answer.reason);
              else {
                onChanged();
                onClose();
              }
            });
          }}
        >
          {job.received > 0 ? (
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
    </Panel>
  );
}

function Detail({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-end font-semibold">{ltr ? <bdi dir="ltr">{value}</bdi> : value}</dd>
    </div>
  );
}
