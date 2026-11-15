// Locale-aware number, money and date formatting shared by trading panels.
//
// The admin can set a site locale, currency and number style. Values are read
// at call time so an open panel picks up a new setting on its next render.

import type { LocaleSettings } from "./api";
import { formatLocalDate, type DisplayDateFormat } from "./time";

let localeSettings: LocaleSettings = {
  locale: "",
  timezone: "",
  currency: "USD",
  dateFormat: "locale",
  numberFormat: "locale",
};

export function setLocaleSettings(settings: LocaleSettings): void {
  localeSettings = { ...settings };
}

export function getLocaleSettings(): LocaleSettings {
  return { ...localeSettings };
}

function numberLocale(): string | undefined {
  if (localeSettings.numberFormat === "comma-dot") return localeSettings.locale || "en-US";
  if (localeSettings.numberFormat === "dot-comma") return localeSettings.locale || "de-DE";
  return localeSettings.locale.trim() || undefined;
}

export function formatNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {}
): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(numberLocale(), options);
}

export function formatCurrency(
  value: number | null | undefined,
  currency = localeSettings.currency
): string {
  if (value == null || !Number.isFinite(value)) return "-";
  try {
    return new Intl.NumberFormat(localeSettings.locale || undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(value);
  } catch {
    return `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${
      currency || "USD"
    }`;
  }
}

export function formatDisplayDate(
  value: string | number | Date,
  dateFormat: DisplayDateFormat = localeSettings.dateFormat
): string {
  return formatLocalDate(value, {
    timeZone: localeSettings.timezone || undefined,
    locale: localeSettings.locale || undefined,
    dateFormat,
  });
}
