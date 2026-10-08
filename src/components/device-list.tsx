"use client";
import { T } from "@/components/language-provider";
import { translateDialog } from "@/lib/i18n";


import { useState } from "react";

type Device = { id: string; name: string; createdAt: Date | string; lastSeenAt: Date | string | null; expiresAt: Date | string };

export default function DeviceList({ initialDevices }: { initialDevices: Device[] }) {
  const [items, setItems] = useState(initialDevices);
  const [error, setError] = useState("");
  async function revoke(id: string) {
    if (!window.confirm(translateDialog("Revoke this device? It will immediately lose API access."))) return;
    const response = await fetch("/api/devices", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const result = await response.json() as { error?: { message: string } };
    if (!response.ok) { setError(result.error?.message ?? "Unable to revoke device."); return; }
    setItems((current) => current.filter((device) => device.id !== id));
  }
  if (items.length === 0) return <div className="empty"><strong><T>{"No connected devices."}</T></strong><T>{"Generate a pairing code to connect the extension."}</T></div>;
  return <><div className="table-wrap"><table><thead><tr><th><T>{"Device"}</T></th><th><T>{"Paired"}</T></th><th><T>{"Last seen"}</T></th><th><T>{"Expires"}</T></th><th><T>{"Actions"}</T></th></tr></thead><tbody>{items.map((device) => <tr key={device.id}><td>{device.name}</td><td>{new Date(device.createdAt).toLocaleString()}</td><td><T>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Not used yet"}</T></td><td>{new Date(device.expiresAt).toLocaleDateString()}</td><td><button className="button small danger" onClick={() => void revoke(device.id)}><T>{"Revoke"}</T></button></td></tr>)}</tbody></table></div>{error && <p className="error" style={{ padding: 15 }}><T>{error}</T></p>}</>;
}
