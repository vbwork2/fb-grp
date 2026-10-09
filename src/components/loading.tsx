"use client";

import { createContext, useContext, useRef, useState, type ComponentProps, type MouseEvent, type FormEvent } from "react";
import { T } from "@/components/language-provider";

const FormBusy = createContext(false);

export function LoadingDots() {
  return <span className="loading-dots" aria-hidden="true"><span /><span /><span /></span>;
}

export function LoadingStatus({ children = "Please wait…" }: { children?: React.ReactNode }) {
  return <span className="loading-status" role="status"><LoadingDots /><span><T>{children}</T></span></span>;
}

type ButtonProps = Omit<ComponentProps<"button">, "onClick"> & { onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown };

export function ActionButton({ onClick, disabled, children, type, ...props }: ButtonProps) {
  const formBusy = useContext(FormBusy);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const busy = pending || (type !== "button" && type !== "reset" && formBusy);
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (locked.current || busy) { event.preventDefault(); return; }
    setError("");
    try {
      const result = onClick?.(event);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        locked.current = true;
        setPending(true);
        void Promise.resolve(result).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Request failed.");
        }).finally(() => { locked.current = false; setPending(false); });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
  }
  return <><button {...props} type={type} disabled={disabled || busy} aria-busy={busy} onClick={click}>{busy && <LoadingDots />}{children}</button>{error && <span className="error" role="alert"><T>{error}</T></span>}</>;
}

type FormProps = Omit<ComponentProps<"form">, "onSubmit"> & { onSubmit: (event: FormEvent<HTMLFormElement>) => unknown };

export function ActionForm({ onSubmit, children, ...props }: FormProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    setError("");
    try {
      const result = onSubmit(event);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        locked.current = true;
        setPending(true);
        void Promise.resolve(result).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Request failed.");
        }).finally(() => { locked.current = false; setPending(false); });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
  }
  return <FormBusy.Provider value={pending}><form {...props} aria-busy={pending} onSubmit={submit}>{children}{pending && <span className="sr-only" role="status"><T>{"Please wait…"}</T></span>}{error && <p className="error" role="alert"><T>{error}</T></p>}</form></FormBusy.Provider>;
}
