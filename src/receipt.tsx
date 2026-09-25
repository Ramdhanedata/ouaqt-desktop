import { useEffect, useRef, useState } from "react";
import { machine } from "./bridge";
import { Dialog } from "./dialog";
import { fill, type ScreensCopy } from "./i18n/screens";
import { Button, Notice } from "./ui";

/*
 * A sale's receipt, from any screen of any trade: the one the printer gets,
 * shown on screen, then downloaded as a PDF or printed.
 *
 * What is shown is the printed page itself, drawn by the same code as the
 * printer and the PDF, so the three can never disagree: a pharmacy's lot, a
 * restaurant's parts paid by app, a customer's account, all as they print.
 */
export function ReceiptView({ saleId, t, onClose }: { saleId: string; t: ScreensCopy; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [note, setNote] = useState<{ text: string; kind: "done" | "problem" } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    void machine.receiptHtml(saleId).then((answer) => answer.ok && setHtml(answer.value));
  }, [saleId]);

  /* The page decides its own width (58 mm, 80 mm or A4); the frame takes it. */
  const fit = () => {
    const view = frame.current?.contentWindow;
    const body = frame.current?.contentDocument?.body;
    if (!view || !body) return;
    /* The page's own box, not the frame's: a short receipt should not trail white paper. */
    const box = body.getBoundingClientRect();
    const below = parseFloat(view.getComputedStyle(body).marginBottom) || 0;
    setSize({ width: Math.ceil(box.width), height: Math.ceil(box.bottom + below) });
  };

  const download = () =>
    void machine.receiptPdf(saleId).then((answer) => {
      if (!answer.ok) setNote({ text: t.notSaved, kind: "problem" });
      else if (answer.value) setNote({ text: fill(t.receiptSaved, { file: answer.value.split(/[\\/]/).pop() ?? "" }), kind: "done" });
    });

  const print = () =>
    void machine.printReceipt(saleId).then((printed) => setNote(printed.ok ? { text: t.printed, kind: "done" } : { text: t.notPrinted, kind: "problem" }));

  return (
    <Dialog
      title={t.receipt}
      onClose={onClose}
      wide={(size?.width ?? 0) > 420} // not-a-rule: wider than a till roll, so an A4 page
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={download}>{t.downloadReceipt}</Button>
          <Button onClick={print}>{t.printNow}</Button>
          <Button kind="primary" onClick={onClose}>
            {t.close}
          </Button>
        </div>
      }
    >
      {note ? (
        <div className="mb-4">
          <Notice kind={note.kind} text={note.text} />
        </div>
      ) : null}
      {html ? (
        <div className="flex justify-center overflow-x-auto rounded-lg bg-hover p-4">
          {/* No scripts in the page: allow-same-origin only lets the frame be measured. */}
          <iframe
            ref={frame}
            title={t.receipt}
            srcDoc={html}
            sandbox="allow-same-origin"
            onLoad={fit}
            className="shrink-0 rounded bg-white shadow-md"
            style={{ width: size?.width ?? 320, height: size?.height ?? 480, border: 0 }}
          />
        </div>
      ) : null}
    </Dialog>
  );
}
