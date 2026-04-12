import type { Locale } from "./i18n";

const dictionaries = {
  en: () => import("@/dictionaries/en.json").then((m) => m.default),
  pl: () => import("@/dictionaries/pl.json").then((m) => m.default),
};

export type Dictionary = Awaited<ReturnType<(typeof dictionaries)["en"]>>;

export function getDictionary(locale: Locale) {
  return dictionaries[locale]();
}
