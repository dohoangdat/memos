import { forkFetch } from "@/lib/fork-api";

/**
 * Push notifications for reminders (server/reminder) on this device. The service worker
 * (web/sw) shows them; it is registered in production builds only.
 */
export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

const registration = async () => (await navigator.serviceWorker?.getRegistration()) ?? undefined;

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  }
  if (!("PushManager" in window)) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

const keyBytes = (base64url: string) => {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

/** Asks for permission, subscribes this device and registers it with the server. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = (await registration()) ?? (await navigator.serviceWorker.ready);
  const { publicKey } = await forkFetch<{ publicKey: string }>("/api/x/push/key");
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  await forkFetch("/api/x/push/subscriptions", { method: "POST", body: subscription.toJSON() });
  return "on";
}

export async function disablePush(): Promise<void> {
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (!subscription) return;
  await forkFetch("/api/x/push/subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => undefined);
  await subscription.unsubscribe();
}

export const sendTestPush = () => forkFetch<{ sent: number; failed: number }>("/api/x/push/test", { method: "POST", body: {} });
