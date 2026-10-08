"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./core";

type Options = {
  realtime?: boolean;
};

export function useLive<T>(name: string, fetcher: () => Promise<T>, tables: string[], intervalMs = 10_000, options: Options = {}) {
  const realtime = options.realtime ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  const seq = useRef(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await fetcherRef.current();
      if (mine !== seq.current) return;
      setData(d);
      setError(null);
      setLastOk(Date.now());
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  const tablesKey = tables.join(",");
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    const onWake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (realtime) {
      channel = supabase.channel(`live-${name}`);
      for (const table of tablesKey.split(",")) {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => void refresh());
      }
      channel.subscribe((status) => setLive(status === "SUBSCRIBED"));
    }

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [name, tablesKey, intervalMs, realtime, refresh]);

  return { data, error, live, lastOk, refresh };
}
