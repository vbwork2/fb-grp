import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/components/language-provider";
import { LOCALE_COOKIE } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await cookies()).get(LOCALE_COOKIE)?.value;
  return locale === "vi"
    ? { title: "Groupflow | Trợ lý đăng bài nhóm Facebook", description: "Quản lý nội dung và tự xác nhận từng bài đăng vào nhóm Facebook." }
    : { title: "Groupflow | Facebook Group Posting Assistant", description: "Organize Facebook Group content workflows and confirm each post yourself." };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = (await cookies()).get(LOCALE_COOKIE)?.value === "vi" ? "vi" : "en";
  return <html lang={locale}><body><LanguageProvider initialLocale={locale}>{children}</LanguageProvider></body></html>;
}
