export const WORKSPACE_CHANGED_EVENT = "groupflow:workspace-changed";

// Notify the app shell after writes so prefetched pages cannot retain old data.
export async function workspaceFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const method = (init?.method ?? "GET").toUpperCase();
  if (response.ok && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    window.dispatchEvent(new Event(WORKSPACE_CHANGED_EVENT));
  }
  return response;
}
