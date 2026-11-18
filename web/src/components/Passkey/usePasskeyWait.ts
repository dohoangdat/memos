import { useEffect, useState } from "react";

/**
 * A server-imposed wait before the next passkey try, counting down each second:
 * `remaining` is in whole seconds (0 when none), `start(seconds)` begins one.
 */
export function usePasskeyWait(initialSeconds = 0) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (initialSeconds > 0) setUntil(Date.now() + initialSeconds * 1000);
  }, [initialSeconds]);

  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);

  return {
    remaining: Math.max(0, Math.ceil((until - now) / 1000)),
    start: (seconds: number) => {
      setNow(Date.now());
      setUntil(seconds > 0 ? Date.now() + seconds * 1000 : 0);
    },
  };
}
