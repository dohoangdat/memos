/**
 * Back never leaves the installed app from a page it was opened on (fork). When the app starts
 * on a page other than the home page as the first entry of its history (a notification, a shared
 * link, a reload of a memo), the home page is put underneath it, so Back goes home instead of
 * closing the app. Imported first by main.tsx, before the router reads the location.
 */
const BASE_KEY = "__appBase";

const standalone = () => {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};

// The installed app (standalone) has no other page to go back to; a browser tab only when this
// is the first page of the tab.
if (typeof window !== "undefined" && !window.history.state?.[BASE_KEY] && (window.history.length <= 1 || standalone())) {
  const { pathname, search, hash } = window.location;
  if (pathname !== "/" && !pathname.startsWith("/auth")) {
    window.history.replaceState({ [BASE_KEY]: true }, "", "/");
    window.history.pushState(null, "", `${pathname}${search}${hash}`);
  }
}

export {};
