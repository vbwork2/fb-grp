"use client";

import { ActionButton } from "@/components/loading";

import { T } from "@/components/language-provider";
import { ConfirmDialog } from "@/components/modal";
import { useState } from "react";
import { DeviceIcon, TrashIcon } from "@/components/icons";

type Device = {
  id: string;
  name: string;
  createdAt: Date | string;
  lastSeenAt: Date | string | null;
  expiresAt: Date | string;
};

export default function DeviceList({ initialDevices }: { initialDevices: Device[] }) {
  const [items, setItems] = useState(initialDevices);
  const [revoking, setRevoking] = useState<Device | null>(null);

  async function revoke(id: string) {
    const response = await fetch("/api/devices", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const result = (await response.json()) as { error?: { message: string } };
    if (!response.ok) {
      throw new Error(result.error?.message ?? "Unable to revoke device.");
    }
    setItems((current) => current.filter((device) => device.id !== id));
  }

  if (items.length === 0) {
    return (
      <div className="empty">
        <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
          <DeviceIcon className="w-6 h-6 text-slate-400" />
        </div>
        <strong>
          <T>{"No connected devices."}</T>
        </strong>
        <p className="max-w-md text-sm text-slate-500 m-0">
          <T>{"Generate a pairing code to connect the extension."}</T>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <T>{"Device"}</T>
              </th>
              <th>
                <T>{"Paired"}</T>
              </th>
              <th>
                <T>{"Last seen"}</T>
              </th>
              <th>
                <T>{"Expires"}</T>
              </th>
              <th style={{ textAlign: "right" }}>
                <T>{"Actions"}</T>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((device) => (
              <tr key={device.id}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center text-slate-500">
                      <DeviceIcon className="w-3.5 h-3.5" />
                    </div>
                    <strong className="text-slate-900 font-semibold">{device.name}</strong>
                  </div>
                </td>
                <td className="text-slate-500 text-xs">
                  {new Date(device.createdAt).toLocaleString()}
                </td>
                <td className="text-slate-500 text-xs">
                  <T>
                    {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Not used yet"}
                  </T>
                </td>
                <td className="text-slate-500 text-xs">
                  {new Date(device.expiresAt).toLocaleDateString()}
                </td>
                <td>
                  <div className="flex items-center justify-end">
                    <ActionButton
                      type="button"
                      className="button small danger"
                      onClick={() => setRevoking(device)}
                      title="Revoke device access"
                    >
                      <TrashIcon className="w-3 h-3" />
                      <span><T>{"Revoke"}</T></span>
                    </ActionButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {revoking && <ConfirmDialog title={<T>{"Revoke device access"}</T>} confirmLabel="Revoke" onClose={() => setRevoking(null)} onConfirm={() => revoke(revoking.id)}>
        <strong>{revoking.name}</strong><p><T>{"Revoke this device? It will immediately lose API access."}</T></p>
      </ConfirmDialog>}
    </>
  );
}
