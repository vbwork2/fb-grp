"use client";

import { ActionButton } from "@/components/loading";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/components/language-provider";
import { ConfirmDialog } from "@/components/modal";
import { translateDialog } from "@/lib/i18n";

export default function DeleteCampaignButton({ id, name, disabled = false, onDeleted }: { id: string; name: string; disabled?: boolean; onDeleted?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function remove() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to delete campaign.");
      if (onDeleted) onDeleted();
      else router.replace("/campaigns");
      router.refresh();
    } catch (cause) {
      throw new Error(cause instanceof Error ? cause.message : "Unable to delete campaign.", { cause });
    } finally { setBusy(false); }
  }
  return <div>
    <ActionButton type="button" className="button small danger" disabled={disabled || busy} title={disabled ? translateDialog("Pause the campaign before deleting it.") : undefined} onClick={() => setConfirming(true)}><T>{busy ? "Deleting campaign…" : "Delete campaign"}</T></ActionButton>
    {confirming && <ConfirmDialog title={<T>{"Delete campaign"}</T>} onClose={() => setConfirming(false)} onConfirm={remove} confirmLabel="Delete campaign">
      <strong>{name}</strong><p><T>{"Delete this campaign and its queue/history permanently? Shared content, groups and Facebook posts will be kept."}</T></p>
    </ConfirmDialog>}
  </div>;
}
