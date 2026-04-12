import { describe, it, expect, vi } from "vitest";
import { locales, defaultLocale, isValidLocale } from "@/lib/i18n";
import { getDictionary } from "@/lib/dictionaries";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

import { metadata } from "@/app/layout";
import manifest from "@/app/manifest";

describe("i18n constants", () => {
  it("exports en and pl locales", () => {
    expect(locales).toEqual(["en", "pl"]);
  });

  it("defaults to en", () => {
    expect(defaultLocale).toBe("en");
  });
});

describe("isValidLocale", () => {
  it("returns true for 'en'", () => {
    expect(isValidLocale("en")).toBe(true);
  });

  it("returns true for 'pl'", () => {
    expect(isValidLocale("pl")).toBe(true);
  });

  it("returns false for unknown locales", () => {
    expect(isValidLocale("fr")).toBe(false);
    expect(isValidLocale("")).toBe(false);
    expect(isValidLocale("EN")).toBe(false);
  });
});

describe("getDictionary", () => {
  it("loads English dictionary with expected shape", async () => {
    const dict = await getDictionary("en");
    expect(dict).toHaveProperty("app");
    expect(dict).toHaveProperty("home");
    expect(dict).toHaveProperty("create");
    expect(dict).toHaveProperty("join");
    expect(dict).toHaveProperty("lobby");
    expect(dict.app.title).toBe("tf u like?");
  });

  it("loads Polish dictionary with expected shape", async () => {
    const dict = await getDictionary("pl");
    expect(dict).toHaveProperty("app");
    expect(dict).toHaveProperty("home");
    expect(dict.app.title).toBeDefined();
  });

  it("English and Polish have the same top-level keys", async () => {
    const en = await getDictionary("en");
    const pl = await getDictionary("pl");
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
  });

  it("loads English extension copy with the new brand", async () => {
    const dict = await getDictionary("en");
    expect(dict.lobby.extensionNotFound).toBe(
      "Install the tf u like? desktop extension first"
    );
  });
});

describe("branding metadata", () => {
  it("uses tf u like? user-facing metadata", () => {
    expect(metadata.title).toBe("tf u like?");

    const appleWebApp = metadata.appleWebApp;
    expect(appleWebApp && typeof appleWebApp === "object" ? appleWebApp.title : undefined).toBe(
      "tf u like?"
    );
  });

  it("uses tfulike in the web manifest identifiers", () => {
    const appManifest = manifest();
    expect(appManifest.name).toBe("tf u like?");
    expect(appManifest.short_name).toBe("tf u like?");
  });
});
