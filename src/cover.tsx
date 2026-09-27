import { useEffect, useState } from "react";
import { insurancePayers, type InsurancePayer } from "@app-ui/config";
import { clampShare } from "@app-ui/money";
import { machine, type CoverShares } from "./bridge";
import { fill, type ScreensCopy } from "./i18n/screens";
import { Choices, Field, Notice } from "./ui";

/*
 * Health cover, for a pharmacy conventionnée with CNAM, CNASS or an insurer.
 *
 * Nothing here is drawn for a shop that did not say yes in the builder:
 * every caller asks coverPayers(configuration) first, and it is empty for
 * everybody else, so their till is the one it always was.
 */

export function fundName(payer: InsurancePayer, t: ScreensCopy): string {
  return payer === "cnam" ? t.fundCnam : payer === "cnass" ? t.fundCnass : t.fundOther;
}

/* What the cashier has picked for the sale on screen. The share stays text while he types it. */
export type CoverDraft = { payer: InsurancePayer | "none"; member: string; share: string };

export const NO_COVER: CoverDraft = { payer: "none", member: "", share: "" };

/** The share he typed, as a whole percent, or null while it is not one. */
export function draftShare(draft: CoverDraft): number | null {
  const clean = draft.share.trim();
  if (!/^\d{1,3}$/.test(clean)) return null;
  const value = Number(clean);
  return value <= 100 ? value : null; // not-a-rule: a percent
}

/*
 * Who pays: the customer alone, or a fund with him. The fund's buttons are
 * the ones the owner named in the builder, nothing more. Picking one asks for
 * the insured's number and starts the share where the manager set it.
 */
export function CoverChoice({
  t,
  payers,
  draft,
  usual,
  onChange,
}: {
  t: ScreensCopy;
  payers: InsurancePayer[];
  draft: CoverDraft;
  usual: CoverShares;
  onChange: (next: CoverDraft) => void;
}) {
  const shareBad = draft.payer !== "none" && draft.share.trim() !== "" && draftShare(draft) === null;
  return (
    <div className="space-y-2">
      <div className="text-base text-ink-2">{t.coverLabel}</div>
      <Choices<InsurancePayer | "none">
        value={draft.payer}
        onChange={(payer) =>
          onChange(
            payer === "none"
              ? NO_COVER
              : { payer, member: draft.member, share: usual[payer] !== undefined ? String(usual[payer]) : "" }
          )
        }
        /* Short names, so the four buttons sit on one row and the ticket above keeps its room. */
        options={[{ value: "none", label: t.coverNone }, ...payers.map((payer) => ({ value: payer, label: payer === "other" ? t.fundOtherShort : fundName(payer, t) }))]}
      />
      {draft.payer !== "none" ? (
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label={t.memberNumber} value={draft.member} onChange={(member) => onChange({ ...draft, member })} ltr autoFocus />
          <Field
            label={t.coverShare}
            value={draft.share}
            onChange={(share) => onChange({ ...draft, share })}
            kind="number"
            error={shareBad ? t.badQuantity : null}
          />
        </div>
      ) : null}
    </div>
  );
}

/*
 * The manager's side: the share each fund usually pays. Saved as he leaves
 * the field, one number per fund, on this computer.
 */
export function CoverSettings({ t, payers }: { t: ScreensCopy; payers: InsurancePayer[] }) {
  const [shares, setShares] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);

  useEffect(() => {
    void machine.coverShares().then((answer) => {
      if (!answer.ok) return;
      setShares(Object.fromEntries(insurancePayers.map((payer) => [payer, answer.value[payer] !== undefined ? String(answer.value[payer]) : ""])));
    });
  }, []);

  const save = (payer: InsurancePayer) => {
    const text = (shares[payer] ?? "").trim();
    const value = text === "" ? null : Number(text);
    if (value !== null && (!/^\d{1,3}$/.test(text) || value > 100)) { // not-a-rule: a percent
      setNote({ text: t.badQuantity, kind: "problem" });
      return;
    }
    void machine.setCoverShare(payer, value === null ? null : clampShare(value)).then((answer) =>
      setNote(answer.ok ? { text: t.saved, kind: "done" } : { text: t.notSaved, kind: "problem" })
    );
  };

  if (payers.length === 0) return null;
  return (
    <section>
      <h2 className="text-xl font-semibold">{t.coverSection}</h2>
      <p className="mt-1 text-base text-ink-3">{t.coverSectionNote}</p>
      <div className="mt-3 grid max-w-xl gap-3">
        {payers.map((payer) => (
          <div key={payer} onBlur={() => save(payer)}>
            <Field
              label={fill(t.usualShare, { fund: fundName(payer, t) })}
              value={shares[payer] ?? ""}
              onChange={(value) => setShares((current) => ({ ...current, [payer]: value }))}
              kind="number"
              onEnter={() => save(payer)}
            />
          </div>
        ))}
      </div>
      {note ? <div className="mt-3"><Notice kind={note.kind} text={note.text} /></div> : null}
    </section>
  );
}
