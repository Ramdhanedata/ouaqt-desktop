import { useCallback, useEffect, useMemo, useState } from "react";
import { SaleScreen, type Configuration, type ReceiptLine } from "@app-ui/index";
import { machine, type ConfigurationResult, type Product } from "./bridge";
import { copyFor } from "./i18n";
import { Shell, sectionsFor, type Section } from "./shell";

/*
 * The app, arranged around one shop's configuration.
 *
 * Nothing here knows which trade it is serving. The configuration decides the
 * language and the direction, which sections exist down the side, and what
 * the till is called. Two pharmacies run this same window with different
 * answers behind them, and so does a bakery.
 */

export function App() {
  const [result, setResult] = useState<ConfigurationResult | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [section, setSection] = useState<Section>("sale");
  const [note, setNote] = useState<{ text: string; kind: "done" | "failed" } | null>(null);

  /*
   * A sale that went through says so and then gets out of the way. One that
   * did not stays until somebody reads it.
   */
  useEffect(() => {
    if (note?.kind !== "done") return;
    const timer = setTimeout(() => setNote(null), 4000); // not-a-rule: how long a confirmation lingers
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    void machine.readConfiguration().then(setResult);
    void machine.products().then(setProducts);
  }, []);

  const configuration = result?.ok ? result.configuration : null;
  const language = configuration?.language.app ?? "fr";
  const copy = copyFor(language);

  /* The whole document turns, not only the screen: rule 13. */
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  /*
   * Selling, for real. The ticket stays on screen unless the sale reached the
   * disk, which is why this returns the answer rather than assuming it.
   */
  const charge = useCallback(
    async (lines: ReceiptLine[]): Promise<boolean> => {
      const answer = await machine.recordSale({
        payment: "cash",
        lines: lines.map((line) => ({
          productId: line.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });

      if (!answer.ok) {
        setNote({ text: copy.saleFailed, kind: "failed" });
        return false;
      }

      setNote({ text: copy.saleKept, kind: "done" });
      void machine.products().then(setProducts);
      return true;
    },
    [copy]
  );

  const forScreen = useMemo(
    () =>
      (products ?? []).map((product) => ({
        id: product.id,
        name: {
          fr: product.name,
          ar: product.nameArabic || product.name,
          en: product.name,
        },
        price: product.salePrice,
        inStock: product.onHand,
      })),
    [products]
  );

  if (!result) return <Starting label={copy.starting} />;

  if (!result.ok) {
    const missing = result.reason === "missing";
    return (
      <Message
        title={missing ? copy.noConfiguration : copy.badConfiguration}
        body={missing ? copy.noConfigurationBody : copy.badConfigurationBody}
      />
    );
  }

  return (
    <Shell
      configuration={result.configuration}
      copy={copy}
      section={section}
      onSection={setSection}
      note={note}
      onDismissNote={() => setNote(null)}
    >
      {section === "sale" ? (
        forScreen.length === 0 ? (
          <Message title={copy.noProducts} body={copy.noProductsBody} />
        ) : (
          <SaleScreen
            configuration={result.configuration}
            products={forScreen}
            onCharge={charge}
          />
        )
      ) : (
        <Message title={copy.notBuilt} body={copy.notBuiltBody} />
      )}
    </Shell>
  );
}

function Starting({ label }: { label: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <p className="text-lg text-black/60">{label}</p>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-white p-8">
      <div className="max-w-md">
        <h2 className="text-2xl font-semibold text-black">{title}</h2>
        <p className="mt-3 text-lg leading-relaxed text-black/70">{body}</p>
      </div>
    </div>
  );
}

export type { Configuration };
