"use client";
import { T } from "@/components/language-provider";


export default function ExportHistory() {
  return <a href="/api/history/export" className="button"><T>{"Export CSV"}</T></a>;
}
