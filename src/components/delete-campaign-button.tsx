"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/components/language-provider";
import { translateDialog } from "@/lib/i18n";

export default function DeleteCampaignButton({ id, name, disabled = false, onDeleted }: { id: string; name: string; disabled?: boolean; onDeleted?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (busy || disabled) return;
    const warning = translateDialog("Delete this campaign and its queue/history permanently? Shared content, groups and Facebook posts will be kept.");
    if (!window.confirm(`${name}\n\n${warning}`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to delete campaign.");
      if (onDeleted) onDeleted();
      else router.replace("/campaigns");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete campaign.");
    } finally { setBusy(false); }
  }
  return <div>
    <button type="button" className="button small danger" disabled={disabled || busy} title={disabled ? translateDialog("Pause the campaign before deleting it.") : undefined} onClick={() => void remove()}><T>{busy ? "Deleting campaign…" : "Delete campaign"}</T></button>
    {error && <p className="error" role="alert"><T>{error}</T></p>}
  </div>;
}
