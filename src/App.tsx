import { useEffect, useState } from "react";
import { SaleScreen, sampleProducts, type Configuration } from "@app-ui/index";
import { copyFor } from "./i18n";

/*
 * D0's one screen: proof that the parts fit.
 *
 * It reads the configuration the builder produced, sets the language and the
 * direction from it, and renders the sale screen from app-ui unchanged. When
 * activation arrives in D2 the configuration comes from the network instead
 * of a file, and this screen is replaced by the real thing. What it is here
 * to show is that the shared screens, the database and the configuration all
 * work together in Electron.
 */

type ConfigurationResult =
  | { ok: true; configuration: Configuration }
  | { ok: false; reason: "missing" | "unreadable" | "invalid"; detail?: string };

type DatabaseState = { ready: boolean; tables: number; file?: string };

declare global {
  interface Window {
    ouaqt: {
      readConfiguration: () => Promise<ConfigurationResult>;
      databaseState: () => Promise<DatabaseState>;
    };
  }
}

export function App() {
  const [result, setResult] = useState<ConfigurationResult | null>(null);
  const [database, setDatabase] = useState<DatabaseState | null>(null);

  useEffect(() => {
    void window.ouaqt.readConfiguration().then(setResult);
    void window.ouaqt.databaseState().then(setDatabase);
  }, []);

  const configuration = result?.ok ? result.configuration : null;
  const language = configuration?.language.app ?? "fr";
  const copy = copyFor(language);

  /* The whole document turns, not only the screen: rule 13. */
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  if (!result) {
    return <Waiting>{copy.starting}</Waiting>;
  }

  if (!result.ok) {
    const missing = result.reason === "missing";
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-semibold">
          {missing ? copy.noConfiguration : copy.badConfiguration}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {missing ? copy.noConfigurationBody : copy.badConfigurationBody}
        </p>
        {database ? (
          <p className="mt-8 text-base text-muted-foreground">
            {copy.database}: {database.ready ? copy.ready : "-"} ({database.tables})
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <span className="text-lg font-semibold">
          {configuration!.business.nameLatin}
        </span>
        <span className="text-base text-muted-foreground">
          {copy.database}: {database?.ready ? copy.ready : "-"}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        <SaleScreen
          configuration={configuration!}
          products={sampleProducts(configuration!.pack)}
        />
      </div>
    </div>
  );
}

function Waiting({ children }: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-base text-muted-foreground">{children}</p>
    </div>
  );
}
