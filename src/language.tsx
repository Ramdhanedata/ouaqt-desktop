import type { UiLanguage } from "./bridge";

/*
 * The first thing the app ever shows: which language to speak.
 *
 * Three choices, each written in its own language, and nothing else on the
 * screen. No "next" and no skip: the choice takes one tap, and everything
 * after it depends on the answer. The computer's own language is not used
 * to decide for him, because the machine behind a counter is often set to a
 * language nobody in the shop reads.
 */

const CHOICES: { value: UiLanguage; label: string; dir: "rtl" | "ltr" }[] = [
  { value: "ar", label: "العربية", dir: "rtl" },
  { value: "fr", label: "Français", dir: "ltr" },
  { value: "en", label: "English", dir: "ltr" },
];

export function LanguageChoice({ onChoose }: { onChoose: (language: UiLanguage) => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-sm flex-col gap-4">
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            lang={choice.value}
            dir={choice.dir}
            onClick={() => onChoose(choice.value)}
            className={`min-h-[96px] rounded-xl border-2 border-line-strong bg-surface px-6 text-3xl font-semibold text-ink hover:bg-hover focus:border-ink focus:outline-none ${
              choice.value === "ar" ? "font-arabic" : ""
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
