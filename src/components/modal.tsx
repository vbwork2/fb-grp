"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { T } from "@/components/language-provider";
import { ActionButton } from "@/components/loading";

let openModals = 0;
let previousOverflow = "";

export function Modal({ open = true, title, onClose, busy = false, wide = false, children }: {
  open?: boolean;
  title: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    if (openModals++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-modal-initial-focus]")?.focus();
    return () => {
      dialog.close();
      if (--openModals === 0) document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [open]);

  function dismiss() {
    if (!busy && !dialogRef.current?.querySelector('form[aria-busy="true"]')) onClose();
  }

  return <dialog ref={dialogRef} aria-labelledby={titleId} aria-modal="true"
    className={`workspace-modal${wide ? " workspace-modal-wide" : ""}`}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
    }}>
    <div className="workspace-modal-head">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="button small" disabled={busy} onClick={dismiss}><T>{"Close"}</T></button>
    </div>
    <div className="workspace-modal-body">{children}</div>
  </dialog>;
}

export function ConfirmDialog({ title, children, onClose, onConfirm, confirmLabel = "Delete" }: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  confirmLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  async function confirm() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return <Modal title={title} onClose={onClose} busy={busy}>
    <div className="form">
      <div className="workspace-confirm-copy">{children}</div>
      {error && <p className="error" role="alert"><T>{error}</T></p>}
      <div className="buttons workspace-modal-actions">
        <button type="button" className="button" data-modal-initial-focus disabled={busy} onClick={onClose}><T>{"Cancel"}</T></button>
        <ActionButton type="button" className="button danger" disabled={busy} onClick={confirm}><T>{busy ? "Please wait…" : confirmLabel}</T></ActionButton>
      </div>
    </div>
  </Modal>;
}
