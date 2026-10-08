"use client";

import { T } from "@/components/language-provider";
import { UploadIcon } from "@/components/icons";

export default function ExportHistory() {
  return (
    <a href="/api/history/export" className="button" title="Export posting history as CSV">
      <UploadIcon className="w-4 h-4 rotate-180 text-slate-500" />
      <span><T>{"Export CSV"}</T></span>
    </a>
  );
}
