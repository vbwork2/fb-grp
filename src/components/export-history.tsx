"use client";

import { ActionButton } from "@/components/loading";
import { T } from "@/components/language-provider";

export default function ExportHistory() {
  async function download() {
    const response = await fetch("/api/history/export");
    if (!response.ok) throw new Error("Request failed.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "posting-history.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <ActionButton type="button" className="button" onClick={download} title="Export posting history as CSV"><T>{"Export CSV"}</T></ActionButton>;
}
