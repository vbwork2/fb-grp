"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LOCALE_COOKIE, translate, type Locale } from "@/lib/i18n";

const LocaleContext = createContext<Locale>("en");
const LanguageSlotContext = createContext<(element: HTMLDivElement | null) => void>(() => {});
const subscribeToHydration = () => () => {};

export function useLocale() {
  return useContext(LocaleContext);
}

export function LanguagePickerSlot() {
  const setTarget = useContext(LanguageSlotContext);
  return <div className="language-slot" ref={setTarget} />;
}

export function LanguageProvider({ children, initialLocale }: { children: ReactNode; initialLocale: Locale }) {
  const [locale, setLocale] = useState(initialLocale);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "vi" ? "Groupflow | Trợ lý đăng bài nhóm Facebook" : "Groupflow | Facebook Group Posting Assistant";
  }, [locale]);
  function changeLocale(next: Locale) {
    setLocale(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  const picker = <div className="language-picker"><label htmlFor="app-language">{locale === "vi" ? "Ngôn ngữ" : "Language"}</label><select id="app-language" disabled={!hydrated} value={locale} onChange={(event) => changeLocale(event.target.value === "vi" ? "vi" : "en")}><option value="en">English</option><option value="vi">Tiếng Việt</option></select></div>;
  return <LocaleContext.Provider value={locale}><LanguageSlotContext.Provider value={setTarget}>{target ? createPortal(picker, target) : picker}{children}</LanguageSlotContext.Provider></LocaleContext.Provider>;
}

export function T({ children }: { children: ReactNode }) {
  const locale = useContext(LocaleContext);
  function render(value: ReactNode): ReactNode {
    if (typeof value === "string") return translate(value, locale);
    if (Array.isArray(value)) return value.map(render);
    return value;
  }
  return <>{render(children)}</>;
}

export function LocalizedInput(props: ComponentProps<"input">) {
  const locale = useContext(LocaleContext);
  return <input {...props} placeholder={props.placeholder ? translate(props.placeholder, locale) : undefined} aria-label={props["aria-label"] ? translate(props["aria-label"], locale) : undefined} title={props.title ? translate(props.title, locale) : undefined} />;
}

export function LocalizedTextarea(props: ComponentProps<"textarea">) {
  const locale = useContext(LocaleContext);
  return <textarea {...props} placeholder={props.placeholder ? translate(props.placeholder, locale) : undefined} aria-label={props["aria-label"] ? translate(props["aria-label"], locale) : undefined} />;
}

