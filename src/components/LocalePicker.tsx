import { LOCALE_LABELS, setLocale, useLocale, type Locale } from "../lib/i18n";

/** Seletor de idioma da INTERFACE (EN/PT/ES). Endônimos, não traduzidos. */
export function LocalePicker() {
  const locale = useLocale();
  return (
    <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
