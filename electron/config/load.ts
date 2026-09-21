import { readFileSync } from "node:fs";
import { configurationSchema, type Configuration } from "@app-ui/config";

/*
 * The configuration the builder produced, read from a file.
 *
 * It is validated against the same schema the website validates it with,
 * imported from app-ui rather than copied here. A configuration this app
 * cannot understand is a configuration it refuses, because rearranging the
 * shop's software around a half-read file is worse than saying so.
 *
 * In D2 this file arrives from the activation endpoint. Until then it is
 * read from disk, which is also how a support case will be reproduced later.
 */

export type ConfigurationResult =
  | { ok: true; configuration: Configuration }
  | { ok: false; reason: "missing" | "unreadable" | "invalid"; detail?: string };

export function loadConfiguration(file: string): ConfigurationResult {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const checked = configurationSchema.safeParse(parsed);
  if (!checked.success) {
    return {
      ok: false,
      reason: "invalid",
      detail: checked.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  }

  return { ok: true, configuration: checked.data };
}
