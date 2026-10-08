"use client";

import { T, LocalizedInput, LocalizedTextarea } from "@/components/language-provider";
import { translateDialog } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { CampaignWizard } from "@/components/campaign-wizard";
import {
  GroupsIcon,
  ContentIcon,
  CampaignIcon,
  UploadIcon,
  PlusIcon,
  EditIcon,
  CopyIcon,
  TrashIcon,
  ExternalLinkIcon,
  PlayIcon,
  AlertCircleIcon,
  CheckIcon,
  DeviceIcon,
  CloseIcon,
} from "@/components/icons";

type Group = {
  id: string;
  name: string;
  facebookUrl: string;
  category: string | null;
  status: string;
  lastPostedAt: Date | string | null;
};
type Content = { id: string; name: string; body: string; linkUrl: string | null };
type MediaItem = { id: string; mimeType: string; originalFilename: string; sizeBytes: number };
type Variant = { id: string; name: string; body: string };
type Campaign = {
  campaign: {
    id: string;
    contentId: string;
    name: string;
    status: string;
    minIntervalSeconds: number;
    maxIntervalSeconds: number;
    createdAt: Date | string;
  };
  contentName: string;
};
type ApiResult<T> = { data: T | null; error: { message: string } | null };

async function request<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method: method ?? "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { method: method ?? "GET" }
  );
  const result = (await response.json()) as ApiResult<T>;
  if (!response.ok || result.error) throw new Error(result.error?.message ?? "Request failed.");
  return result.data as T;
}

function Feedback({ error, success }: { error: string; success: string }) {
  return (
    <>
      {error && (
        <p className="error" role="alert">
          <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{error}</T></span>
        </p>
      )}
      {success && (
        <div className="notice" role="status">
          <CheckIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{success}</T></span>
        </div>
      )}
    </>
  );
}

export function GroupsPanel({ initialGroups }: { initialGroups: Group[] }) {
  const [items, setItems] = useState(initialGroups);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const item = await request<Group>("/api/groups", Object.fromEntries(form.entries()));
      setItems((current) => [item, ...current]);
      formElement.reset();
      setSuccess("Group added to your workspace.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add the group.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function setStatus(group: Group, status: "ACTIVE" | "PAUSED" | "DISABLED") {
    try {
      const item = await request<Group>(`/api/groups/${group.id}`, { status }, "PATCH");
      setItems((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the group.");
    }
  }

  async function remove(group: Group) {
    if (!window.confirm(translateDialog(`Delete ${group.name}?`))) return;
    try {
      await request(`/api/groups/${group.id}`, undefined, "DELETE");
      setItems((current) => current.filter((entry) => entry.id !== group.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete the group.");
    }
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (!file) return;
    setError("");
    setSuccess("");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/groups/import", { method: "POST", body: form });
      const result = (await response.json()) as ApiResult<{
        total: number;
        imported: number;
        duplicate: number;
        invalid: number;
        items: Group[];
      }>;
      if (!response.ok || !result.data) throw new Error(result.error?.message ?? "Unable to import CSV.");
      setItems((current) => [...result.data!.items, ...current]);
      setSuccess(
        `Total ${result.data.total}; imported ${result.data.imported}; duplicates ${result.data.duplicate}; invalid ${result.data.invalid}.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import CSV.");
    } finally {
      inputElement.value = "";
    }
  }

  async function disableSelected() {
    try {
      const updated = await Promise.all(
        selected.map((id) => request<Group>(`/api/groups/${id}`, { status: "DISABLED" }, "PATCH"))
      );
      const byId = new Map(updated.map((group) => [group.id, group]));
      setItems((current) => current.map((group) => byId.get(group.id) ?? group));
      setSelected([]);
      setSuccess(`${updated.length} groups disabled.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to disable selected groups.");
    }
  }

  const visible = items.filter((item) =>
    `${item.name} ${item.category ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {editingGroup && (
        <GroupEditor
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSaved={(updated) => {
            setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            setEditingGroup(null);
          }}
        />
      )}

      {/* Add Group & CSV Import Panel */}
      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <PlusIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Add a Facebook Group"}</T>
            </h2>
          </div>
          <span className="badge blue text-xs font-semibold">
            {items.length}
            <T>{" total"}</T>
          </span>
        </div>

        <form className="form p-5" onSubmit={add}>
          <div className="two-col">
            <div className="field">
              <label htmlFor="groupName">
                <T>{"Group name"}</T>
              </label>
              <input
                id="groupName"
                name="name"
                required
                maxLength={160}
                placeholder="e.g. Graphic Designers Community"
              />
            </div>
            <div className="field">
              <label htmlFor="groupUrl">
                <T>{"Facebook Group URL"}</T>
              </label>
              <LocalizedInput
                id="groupUrl"
                name="facebookUrl"
                type="url"
                placeholder="https://www.facebook.com/groups/..."
                required
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="groupCategory">
              <T>{"Category"}</T>
            </label>
            <input
              id="groupCategory"
              name="category"
              maxLength={80}
              placeholder="e.g. Design, Real Estate, Marketing"
            />
          </div>

          <Feedback error={error} success={success} />

          <div className="flex items-center gap-3 pt-2">
            <button
              className="button primary"
              disabled={isSubmitting}
              style={{ justifySelf: "start" }}
            >
              <PlusIcon className="w-4 h-4" />
              <span><T>{isSubmitting ? "Adding…" : "Add group"}</T></span>
            </button>
          </div>
        </form>

        <div className="p-5 pt-0 border-t border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <label className="button small" htmlFor="groupCsv" title="Import Facebook Groups from CSV">
              <UploadIcon className="w-3.5 h-3.5 text-slate-500" />
              <span><T>{"Import CSV"}</T></span>
            </label>
            <input
              id="groupCsv"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void importCsv(event)}
              style={{ display: "none" }}
            />
          </div>
          <p className="muted text-xs m-0">
            <T>{"CSV columns: name,url,category"}</T>
          </p>
        </div>
      </div>

      {/* Your Groups List */}
      <div className="panel">
        <div className="panel-head flex-wrap">
          <div className="flex items-center gap-2">
            <GroupsIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Your groups"}</T>
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <LocalizedInput
                aria-label="Search groups"
                placeholder="Search groups"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-8"
              />
            </div>
            {selected.length > 0 && (
              <button
                type="button"
                className="button small danger"
                onClick={() => void disableSelected()}
              >
                <T>{"Disable "}</T>
                {selected.length}
              </button>
            )}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
              <GroupsIcon className="w-6 h-6 text-slate-400" />
            </div>
            <strong>
              <T>{"No Facebook Groups yet."}</T>
            </strong>
            <p className="max-w-md text-sm text-slate-500 m-0">
              <T>{"Add your first group or import a CSV to prepare a campaign."}</T>
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <LocalizedInput
                      aria-label="Select visible groups"
                      type="checkbox"
                      checked={visible.length > 0 && visible.every((group) => selected.includes(group.id))}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...new Set([...selected, ...visible.map((group) => group.id)])]
                            : selected.filter((id) => !visible.some((group) => group.id === id))
                        )
                      }
                      className="w-4 h-4 rounded text-blue-600 accent-blue-600"
                    />
                  </th>
                  <th>
                    <T>{"Name"}</T>
                  </th>
                  <th>
                    <T>{"Category"}</T>
                  </th>
                  <th>
                    <T>{"Facebook URL"}</T>
                  </th>
                  <th>
                    <T>{"Status"}</T>
                  </th>
                  <th>
                    <T>{"Last posted"}</T>
                  </th>
                  <th style={{ textAlign: "right" }}>
                    <T>{"Actions"}</T>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <LocalizedInput
                        aria-label={`Select ${group.name}`}
                        type="checkbox"
                        checked={selected.includes(group.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, group.id]
                              : current.filter((id) => id !== group.id)
                          )
                        }
                        className="w-4 h-4 rounded text-blue-600 accent-blue-600"
                      />
                    </td>
                    <td>
                      <strong className="text-slate-900 font-semibold">{group.name}</strong>
                    </td>
                    <td>
                      {group.category ? (
                        <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full font-medium">
                          {group.category}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={group.facebookUrl}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-xs font-semibold"
                      >
                        <span><T>{"Open group"}</T></span>
                        <ExternalLinkIcon className="w-3 h-3" />
                      </a>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          group.status === "ACTIVE"
                            ? "green"
                            : group.status === "DISABLED"
                            ? "red"
                            : "amber"
                        }`}
                      >
                        <T>{group.status}</T>
                      </span>
                    </td>
                    <td className="text-slate-500 text-xs">
                      {group.lastPostedAt ? new Date(group.lastPostedAt).toLocaleDateString() : "—"}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="button small"
                          onClick={() => setEditingGroup(group)}
                          title="Edit group"
                        >
                          <EditIcon className="w-3 h-3 text-slate-500" />
                          <span><T>{"Edit"}</T></span>
                        </button>
                        <button
                          type="button"
                          className="button small"
                          onClick={() =>
                            void setStatus(group, group.status === "PAUSED" ? "ACTIVE" : "PAUSED")
                          }
                        >
                          <T>{group.status === "PAUSED" ? "Resume" : "Pause"}</T>
                        </button>
                        <button
                          type="button"
                          className="button small danger"
                          onClick={() => void remove(group)}
                          title="Delete group"
                        >
                          <TrashIcon className="w-3 h-3" />
                          <span><T>{"Delete"}</T></span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function GroupEditor({
  group,
  onClose,
  onSaved,
}: {
  group: Group;
  onClose: () => void;
  onSaved: (group: Group) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const updated = await request<Group>(`/api/groups/${group.id}`, values, "PATCH");
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel border-blue-200 shadow-md">
      <div className="panel-head bg-blue-50/50">
        <div className="flex items-center gap-2">
          <EditIcon className="w-4 h-4 text-blue-600" />
          <h2>
            <T>{"Edit group"}</T>
          </h2>
        </div>
        <button type="button" className="button small" onClick={onClose}>
          <CloseIcon className="w-3.5 h-3.5" />
          <span><T>{"Close"}</T></span>
        </button>
      </div>
      <form className="form p-5" onSubmit={submit}>
        <div className="field">
          <label htmlFor="editGroupName">
            <T>{"Name"}</T>
          </label>
          <input id="editGroupName" name="name" defaultValue={group.name} required maxLength={160} />
        </div>
        <div className="field">
          <label htmlFor="editGroupUrl">
            <T>{"Facebook Group URL"}</T>
          </label>
          <input
            id="editGroupUrl"
            name="facebookUrl"
            type="url"
            defaultValue={group.facebookUrl}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="editGroupCategory">
            <T>{"Category"}</T>
          </label>
          <input
            id="editGroupCategory"
            name="category"
            defaultValue={group.category ?? ""}
            maxLength={80}
          />
        </div>

        {error && (
          <p className="error" role="alert">
            <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
            <span><T>{error}</T></span>
          </p>
        )}

        <button
          className="button primary"
          disabled={busy}
          style={{ justifySelf: "start" }}
        >
          <T>{busy ? "Saving…" : "Save changes"}</T>
        </button>
      </form>
    </div>
  );
}

export function ContentPanel({ initialContents }: { initialContents: Content[] }) {
  const [items, setItems] = useState(initialContents);
  const [uploads, setUploads] = useState<Record<string, MediaItem[]>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingContent, setEditingContent] = useState<Content | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingContentId, setPendingContentId] = useState<string | null>(null);
  const [expandedVariants, setExpandedVariants] = useState<string[]>([]);
  const maxMegabytes = process.env.NODE_ENV === "production" ? 4 : 10;

  function validateFiles(selected: File[]) {
    if (
      selected.some(
        (file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size === 0
      )
    ) {
      throw new Error("Upload a valid JPG, PNG, or WebP image.");
    }
    if (selected.some((file) => file.size > maxMegabytes * 1024 * 1024)) {
      throw new Error(`Choose an image up to ${maxMegabytes} MB.`);
    }
  }

  async function attachImage(contentId: string, file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("contentId", contentId);
    const response = await fetch("/api/media", { method: "POST", body: form });
    const result = (await response.json()) as ApiResult<MediaItem>;
    if (!response.ok || !result.data) throw new Error(result.error?.message ?? "Unable to upload image.");
    const image = result.data;
    setUploads((current) => ({ ...current, [contentId]: [...(current[contentId] ?? []), image] }));
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setSuccess("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const values = { name: form.get("name"), body: form.get("body"), linkUrl: form.get("linkUrl") };
    setBusy(true);
    let contentId = pendingContentId;
    try {
      validateFiles(files);
      const item = contentId
        ? await request<Content>(`/api/content/${contentId}`, values, "PATCH")
        : await request<Content>("/api/content", values);
      contentId = item.id;
      setPendingContentId(item.id);
      setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      for (const file of files) {
        await attachImage(item.id, file);
        setFiles((current) => current.filter((entry) => entry !== file));
      }
      formElement.reset();
      setFiles([]);
      setPendingContentId(null);
      setSuccess(files.length ? "Content and images saved." : "Content saved.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to save content.";
      setError(message);
      if (contentId)
        setSuccess(
          "Content saved. Some images could not be uploaded. Save again to retry the remaining images."
        );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await request(`/api/content/${id}`, undefined, "DELETE");
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete content.");
    }
  }

  async function duplicate(item: Content) {
    try {
      const copy = await request<Content>("/api/content", {
        name: `${item.name} copy`,
        body: item.body,
        linkUrl: item.linkUrl ?? "",
      });
      setItems((current) => [copy, ...current]);
      setSuccess("Content duplicated.");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to duplicate content.");
    }
  }

  async function uploadImage(contentId: string, event: React.ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (!file) return;
    setError("");
    setSuccess("");
    try {
      validateFiles([file]);
      await attachImage(contentId, file);
      setSuccess("Image uploaded and attached to this content.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload image.");
    } finally {
      inputElement.value = "";
    }
  }

  return (
    <>
      {editingContent && (
        <ContentEditor
          content={editingContent}
          onClose={() => setEditingContent(null)}
          onSaved={(updated) => {
            setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            setEditingContent(null);
          }}
        />
      )}

      {/* Create Content Panel */}
      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <PlusIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Create reusable content"}</T>
            </h2>
          </div>
        </div>
        <form className="form p-5" onSubmit={add}>
          <fieldset
            disabled={busy}
            className="form"
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div className="field">
              <label htmlFor="contentName">
                <T>{"Content name"}</T>
              </label>
              <input
                id="contentName"
                name="name"
                required
                maxLength={160}
                placeholder="e.g. Weekly Product Promotion"
              />
            </div>

            <div className="field">
              <label htmlFor="contentBody">
                <T>{"Caption"}</T>
              </label>
              <LocalizedTextarea
                id="contentBody"
                name="body"
                required
                maxLength={10000}
                placeholder="Write the caption you will review before posting."
              />
            </div>

            <div className="field">
              <label htmlFor="contentLink">
                <T>{"Link (optional)"}</T>
              </label>
              <input
                id="contentLink"
                name="linkUrl"
                type="url"
                placeholder="https://yourwebsite.com/product"
              />
            </div>

            <div className="field">
              <label htmlFor="contentImages">
                <T>{"Images (optional)"}</T>
              </label>
              <input
                id="contentImages"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => {
                  const selected = [...(event.currentTarget.files ?? [])];
                  try {
                    validateFiles(selected);
                    setFiles(selected);
                    setError("");
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Unable to upload image.");
                    setFiles([]);
                    event.currentTarget.value = "";
                  }
                }}
              />
              <p className="muted text-xs">
                <T>
                  {"Choose JPG, PNG, or WebP images. They will be uploaded when you save content."}
                </T>
              </p>
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {files.map((file, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200"
                    >
                      <UploadIcon className="w-3 h-3 text-slate-400" />
                      <span className="font-medium truncate max-w-xs">{file.name}</span>
                      <span className="text-slate-400">({Math.ceil(file.size / 1024)} KB)</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                className="button primary"
                disabled={busy}
                style={{ justifySelf: "start" }}
              >
                <T>{busy ? "Saving…" : "Save content"}</T>
              </button>
            </div>
          </fieldset>
          <Feedback error={error} success={success} />
        </form>
      </div>

      {/* Saved Content Library */}
      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <ContentIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"Saved content"}</T>
            </h2>
          </div>
          <span className="badge blue text-xs font-semibold">
            {items.length}
            <T>{" items"}</T>
          </span>
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
              <ContentIcon className="w-6 h-6 text-slate-400" />
            </div>
            <strong>
              <T>{"No saved content yet."}</T>
            </strong>
            <p className="max-w-md text-sm text-slate-500 m-0">
              <T>{"Create reusable captions for your campaigns."}</T>
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const expanded = expandedVariants.includes(item.id);
              const mediaForContent = uploads[item.id] ?? [];
              return (
                <article key={item.id} className="p-6 hover:bg-slate-50/40 transition-colors">
                  <div className="row mb-3">
                    <strong className="text-base font-semibold text-slate-900">{item.name}</strong>
                    <div className="buttons">
                      <button
                        type="button"
                        className="button small"
                        disabled={busy || pendingContentId === item.id}
                        onClick={() => setEditingContent(item)}
                        title="Edit content"
                      >
                        <EditIcon className="w-3 h-3 text-slate-500" />
                        <span><T>{"Edit"}</T></span>
                      </button>
                      <button
                        type="button"
                        className="button small"
                        onClick={() => void duplicate(item)}
                        title="Duplicate content"
                      >
                        <CopyIcon className="w-3 h-3 text-slate-500" />
                        <span><T>{"Duplicate"}</T></span>
                      </button>
                      <button
                        type="button"
                        className="button small danger"
                        disabled={busy || pendingContentId === item.id}
                        onClick={() => void remove(item.id)}
                        title="Delete content"
                      >
                        <TrashIcon className="w-3 h-3" />
                        <span><T>{"Delete"}</T></span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 my-3">
                    <p
                      className="text-slate-800 text-sm m-0 leading-relaxed font-normal"
                      style={{ whiteSpace: "pre-wrap" }}
                    >
                      {item.body}
                    </p>
                    {item.linkUrl && (
                      <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700">
                        <ExternalLinkIcon className="w-3 h-3" />
                        <a href={item.linkUrl} target="_blank" rel="noreferrer" className="underline truncate">
                          {item.linkUrl}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap my-3">
                    <label
                      className="button small"
                      htmlFor={`image-${item.id}`}
                      title="Attach image to this content"
                    >
                      <UploadIcon className="w-3 h-3 text-slate-500" />
                      <span><T>{"Upload image"}</T></span>
                    </label>
                    <input
                      id={`image-${item.id}`}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => void uploadImage(item.id, event)}
                      style={{ display: "none" }}
                    />
                    {mediaForContent.map((image) => (
                      <a
                        key={image.id}
                        href={`/api/media/${image.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md border border-slate-200 transition-colors"
                      >
                        <span>{image.originalFilename}</span>
                        <span className="text-slate-400">
                          ({Math.ceil(image.sizeBytes / 1024)}
                          <T>{" KB)"}</T>)
                        </span>
                      </a>
                    ))}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      className="button small"
                      aria-expanded={expanded}
                      aria-controls={`variants-${item.id}`}
                      onClick={() =>
                        setExpandedVariants((current) =>
                          expanded ? current.filter((id) => id !== item.id) : [...current, item.id]
                        )
                      }
                    >
                      <T>{expanded ? "Hide content variants" : "Show content variants"}</T>
                    </button>
                    {expanded && (
                      <div id={`variants-${item.id}`} className="mt-3">
                        <VariantEditor contentId={item.id} />
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ContentEditor({
  content,
  onClose,
  onSaved,
}: {
  content: Content;
  onClose: () => void;
  onSaved: (content: Content) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      onSaved(await request<Content>(`/api/content/${content.id}`, values, "PATCH"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update content.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel border-blue-200 shadow-md">
      <div className="panel-head bg-blue-50/50">
        <div className="flex items-center gap-2">
          <EditIcon className="w-4 h-4 text-blue-600" />
          <h2>
            <T>{"Edit content"}</T>
          </h2>
        </div>
        <button type="button" className="button small" onClick={onClose}>
          <CloseIcon className="w-3.5 h-3.5" />
          <span><T>{"Close"}</T></span>
        </button>
      </div>
      <form className="form p-5" onSubmit={submit}>
        <div className="field">
          <label htmlFor="editContentName">
            <T>{"Content name"}</T>
          </label>
          <input
            id="editContentName"
            name="name"
            defaultValue={content.name}
            required
            maxLength={160}
          />
        </div>
        <div className="field">
          <label htmlFor="editContentBody">
            <T>{"Caption"}</T>
          </label>
          <textarea
            id="editContentBody"
            name="body"
            defaultValue={content.body}
            required
            maxLength={10000}
          />
        </div>
        <div className="field">
          <label htmlFor="editContentLink">
            <T>{"Link (optional)"}</T>
          </label>
          <input
            id="editContentLink"
            name="linkUrl"
            type="url"
            defaultValue={content.linkUrl ?? ""}
          />
        </div>

        {error && (
          <p className="error" role="alert">
            <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
            <span><T>{error}</T></span>
          </p>
        )}

        <button
          className="button primary"
          disabled={busy}
          style={{ justifySelf: "start" }}
        >
          <T>{busy ? "Saving…" : "Save changes"}</T>
        </button>
      </form>
    </div>
  );
}

function VariantEditor({ contentId }: { contentId: string }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBody, setEditBody] = useState("");

  useEffect(() => {
    void request<Variant[]>(`/api/content/${contentId}/variants`)
      .then(setVariants)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Unable to load variants.")
      );
  }, [contentId]);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const variant = await request<Variant>(`/api/content/${contentId}/variants`, values);
      setVariants((current) => [...current, variant]);
      form.reset();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add variant.");
    }
  }

  async function save(id: string) {
    try {
      const variant = await request<Variant>(
        `/api/content/${contentId}/variants/${id}`,
        { name: editName, body: editBody },
        "PATCH"
      );
      setVariants((current) => current.map((item) => (item.id === id ? variant : item)));
      setEditing(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update variant.");
    }
  }

  async function remove(id: string) {
    try {
      await request(`/api/content/${contentId}/variants/${id}`, undefined, "DELETE");
      setVariants((current) => current.filter((item) => item.id !== id));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete variant.");
    }
  }

  return (
    <section className="mt-4 p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-3">
      <div className="eyebrow">
        <T>{"Content variants"}</T>
      </div>

      {variants.map((variant) => (
        <div key={variant.id} className="p-3 bg-white border border-slate-200 rounded-lg">
          {editing === variant.id ? (
            <div className="form">
              <LocalizedInput
                aria-label="Variant name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
              <LocalizedTextarea
                aria-label="Variant caption"
                value={editBody}
                onChange={(event) => setEditBody(event.target.value)}
              />
              <div className="buttons">
                <button
                  type="button"
                  className="button small primary"
                  onClick={() => void save(variant.id)}
                >
                  <T>{"Save variant"}</T>
                </button>
                <button
                  type="button"
                  className="button small"
                  onClick={() => setEditing(null)}
                >
                  <T>{"Cancel"}</T>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="row mb-2">
                <strong className="text-sm font-semibold text-slate-900">{variant.name}</strong>
                <div className="buttons">
                  <button
                    type="button"
                    className="button small"
                    onClick={() => {
                      setEditing(variant.id);
                      setEditName(variant.name);
                      setEditBody(variant.body);
                    }}
                  >
                    <T>{"Edit"}</T>
                  </button>
                  <button
                    type="button"
                    className="button small danger"
                    onClick={() => void remove(variant.id)}
                  >
                    <T>{"Delete"}</T>
                  </button>
                </div>
              </div>
              <p className="text-slate-700 text-xs m-0 leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>
                {variant.body}
              </p>
            </>
          )}
        </div>
      ))}

      <form className="form pt-2" onSubmit={add}>
        <div className="two-col">
          <div className="field">
            <label htmlFor={`variantName-${contentId}`}>
              <T>{"Variant name"}</T>
            </label>
            <input
              id={`variantName-${contentId}`}
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Short promotional variant"
            />
          </div>
          <div className="field">
            <label htmlFor={`variantBody-${contentId}`}>
              <T>{"Caption"}</T>
            </label>
            <input
              id={`variantBody-${contentId}`}
              name="body"
              required
              maxLength={10000}
              placeholder="Alternate caption text"
            />
          </div>
        </div>
        <button
          className="button small primary"
          style={{ justifySelf: "start" }}
        >
          <PlusIcon className="w-3.5 h-3.5" />
          <span><T>{"Add variant"}</T></span>
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
          <span><T>{error}</T></span>
        </p>
      )}
    </section>
  );
}

export function CampaignsPanel({
  initialCampaigns,
  groups,
  contents,
}: {
  initialCampaigns: Campaign[];
  groups: Group[];
  contents: Content[];
}) {
  const [items, setItems] = useState(initialCampaigns);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function created(campaign: Campaign["campaign"]) {
    setItems((current) => [
      {
        campaign,
        contentName: contents.find((item) => item.id === campaign.contentId)?.name ?? "Saved content",
      },
      ...current,
    ]);
    setSuccess("Campaign created. Start it when you're ready to build the queue.");
  }

  async function start(id: string) {
    try {
      await request(`/api/campaigns/${id}/start`, {});
      setItems((current) =>
        current.map((entry) =>
          entry.campaign.id === id
            ? { ...entry, campaign: { ...entry.campaign, status: "RUNNING" } }
            : entry
        )
      );
      setSuccess("Campaign started. Its first job is now available to the extension.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start campaign.");
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <CampaignIcon className="w-4 h-4 text-blue-600" />
            <h2>
              <T>{"New campaign"}</T>
            </h2>
          </div>
        </div>

        {contents.length === 0 || groups.filter((group) => group.status === "ACTIVE").length === 0 ? (
          <div className="empty">
            <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
              <CampaignIcon className="w-6 h-6 text-slate-400" />
            </div>
            <strong>
              <T>{"Campaigns need content and groups."}</T>
            </strong>
            <p className="max-w-md text-sm text-slate-500 m-0">
              <T>{"Add at least one saved caption and one active group first."}</T>
            </p>
          </div>
        ) : (
          <CampaignWizard groups={groups} contents={contents} onCreated={created} />
        )}

        {error && (
          <p className="error m-5" role="alert">
            <AlertCircleIcon className="w-4 h-4 flex-shrink-0" />
            <span><T>{error}</T></span>
          </p>
        )}
        {success && (
          <div className="notice m-5" role="status">
            <CheckIcon className="w-4 h-4 flex-shrink-0" />
            <span><T>{success}</T></span>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <CampaignIcon className="w-4 h-4 text-slate-600" />
            <h2>
              <T>{"Campaigns"}</T>
            </h2>
          </div>
          <span className="badge blue text-xs font-semibold">
            {items.length}
            <T>{" total"}</T>
          </span>
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
              <CampaignIcon className="w-6 h-6 text-slate-400" />
            </div>
            <strong>
              <T>{"No campaigns yet."}</T>
            </strong>
            <p className="max-w-md text-sm text-slate-500 m-0">
              <T>{"Create a campaign to prepare your group queue."}</T>
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <T>{"Name"}</T>
                  </th>
                  <th>
                    <T>{"Content"}</T>
                  </th>
                  <th>
                    <T>{"Status"}</T>
                  </th>
                  <th>
                    <T>{"Interval"}</T>
                  </th>
                  <th style={{ textAlign: "right" }}>
                    <T>{"Actions"}</T>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ campaign, contentName }) => (
                  <tr key={campaign.id}>
                    <td>
                      <a
                        href={`/campaigns/${campaign.id}`}
                        className="text-blue-600 hover:text-blue-700 font-semibold"
                      >
                        {campaign.name}
                      </a>
                    </td>
                    <td className="text-slate-600">{contentName}</td>
                    <td>
                      <span
                        className={`badge ${
                          campaign.status === "RUNNING"
                            ? "green"
                            : campaign.status === "CANCELLED"
                            ? "red"
                            : "amber"
                        }`}
                      >
                        <T>{campaign.status}</T>
                      </span>
                    </td>
                    <td className="text-slate-500 text-xs">
                      {campaign.minIntervalSeconds}–{campaign.maxIntervalSeconds}
                      <T>{"s"}</T>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        {campaign.status === "READY" ? (
                          <button
                            type="button"
                            className="button small primary"
                            onClick={() => void start(campaign.id)}
                          >
                            <PlayIcon className="w-3 h-3" />
                            <span><T>{"Start"}</T></span>
                          </button>
                        ) : (
                          <a href={`/campaigns/${campaign.id}`} className="button small">
                            <T>{"Details"}</T>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export function PairingPanel() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await request<{ code: string; expiresAt: string }>("/api/devices/pairing-code", {});
      setCode(result.code);
      setSuccess(`Code expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to generate a code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="flex items-center gap-2">
          <DeviceIcon className="w-4 h-4 text-blue-600" />
          <h2>
            <T>{"Connect Chrome Extension"}</T>
          </h2>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <p className="text-slate-600 text-sm m-0 leading-relaxed">
          <T>
            {"Pair your browser to your workspace. Facebook sign-in remains on facebook.com."}
          </T>
        </p>

        <button
          className="button primary"
          style={{ justifySelf: "start" }}
          disabled={busy}
          onClick={() => void generate()}
        >
          <DeviceIcon className="w-4 h-4" />
          <span><T>{busy ? "Generating…" : "Generate pairing code"}</T></span>
        </button>

        {code && (
          <div className="p-5 bg-blue-50/60 border border-blue-200 rounded-xl space-y-1 inline-block">
            <div className="eyebrow text-blue-600">
              <T>{"One-time code"}</T>
            </div>
            <strong className="text-2xl font-mono tracking-widest text-slate-900 block select-all">
              {code}
            </strong>
          </div>
        )}

        <Feedback error={error} success={success} />
      </div>
    </div>
  );
}
