// Anonymous client identifier persisted in localStorage.
// Used to scope places-lists ownership without requiring login.
const KEY = "btm_client_id";

export function getClientId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
