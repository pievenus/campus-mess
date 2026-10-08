"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RequireRole, useAuth } from "../lib/auth";
import { useLive } from "../lib/useLive";
import { Drawer, Icon, LiveBadge, TokenSlip, type DrawerItem } from "../lib/ui";
import { BRAND, money, supabase, type OrderLine, type OrderStatus } from "../lib/core";

type Ticket = {
  id: string;
  order_number: number;
  counter: string;
  status: OrderStatus;
  total_amount: number;
  created_at: string;
  order_items: OrderLine[];
};

const REASONS = ["Item sold out", "Counter closing", "Duplicate order", "Order not collected"];

async function fetchCounterNames(): Promise<string[]> {
  const { data, error } = await supabase.from("counters").select("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => c.name as string);
}

async function fetchTickets(): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, counter, status, total_amount, created_at, order_items(item_name, quantity, unit_price)")
    .in("status", ["Pending", "Cooking", "Ready"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((o) => ({ ...(o as unknown as Ticket), total_amount: Number(o.total_amount) }));
}

function errorText(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid_transition")) return "Someone already changed this ticket. The board has been refreshed.";
  if (m.includes("forbidden")) return "This account is not allowed to change that ticket.";
  if (m.includes("cancel_reason_required")) return "Please give a reason for cancelling.";
  if (m.includes("jwt") || m.includes("not_authenticated")) return "Session expired. Please log in again.";
  return "Could not reach the server. Check the connection and try again.";
}

function beep(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.55);
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "under 1 min" : `${m} min`;
};

const NEXT: Record<string, { to: OrderStatus; label: string; style: string }> = {
  Pending: { to: "Cooking", label: "Start cooking", style: "btn-primary" },
  Cooking: { to: "Ready", label: "Mark ready", style: "btn-dark" },
  Ready: { to: "Completed", label: "Collected", style: "btn-quiet" },
};

function Board() {
  const auth = useAuth();
  const tickets = useLive("kitchen", fetchTickets, ["orders"], 8_000);
  const counterNames = useLive("kitchen-counters", fetchCounterNames, ["counters"], 60_000);
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<Ticket | null>(null);
  const [reason, setReason] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [counterFilter, setCounterFilter] = useState("All");
  const [lastOk, setLastOk] = useState<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const all = useMemo(() => tickets.data ?? [], [tickets.data]);

  useEffect(() => {
    if (tickets.data) setLastOk(Date.now());
  }, [tickets.data]);

  useEffect(() => {
    if (!tickets.data) return;
    const pending = tickets.data.filter((t) => t.status === "Pending").map((t) => t.id);
    if (seen.current === null) {
      seen.current = new Set(pending);
      return;
    }
    const fresh = pending.filter((id) => !seen.current!.has(id));
    pending.forEach((id) => seen.current!.add(id));
    if (fresh.length > 0 && soundOn && audio.current) {
      try {
        void audio.current.resume();
        beep(audio.current);
      } catch {
        return;
      }
    }
  }, [tickets.data, soundOn]);

  const enableSound = () => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current = audio.current ?? new Ctx();
      void audio.current.resume();
      beep(audio.current);
      setSoundOn(true);
    } catch {
      setError("This browser could not start sound.");
    }
  };

  const change = async (t: Ticket, to: OrderStatus, why?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(t.id);
    setError(null);
    try {
      const { error: e } = await supabase.rpc("set_order_status", { p_order_id: t.id, p_status: to, p_reason: why ?? null });
      if (e) setError(errorText(e.message));
      else setCancelFor(null);
    } catch {
      setError(errorText("network"));
    } finally {
      busyRef.current = false;
      setBusy(null);
      void tickets.refresh();
    }
  };

  if (auth.status !== "ready") return null;
  const isAdmin = auth.profile.role === "admin";
  const counters = Array.from(new Set(all.map((t) => t.counter))).sort();
  const shown = isAdmin && counterFilter !== "All" ? all.filter((t) => t.counter === counterFilter) : all;
  const title = isAdmin ? "Kitchen (admin view)" : auth.profile.counter ?? "Kitchen";
  const stale = lastOk !== null && now - lastOk > 25_000;
  const connected = !stale && !tickets.error;

  const cols: { status: OrderStatus; label: string }[] = [
    { status: "Pending", label: "New" },
    { status: "Cooking", label: "Cooking" },
    { status: "Ready", label: "Ready for pickup" },
  ];

  const drawerItems: DrawerItem[] = [
    ...(isAdmin
      ? [
          { label: "Admin", icon: "settings", href: "/admin/" } as DrawerItem,
          { label: "Student view", icon: "user", href: "/" } as DrawerItem,
        ]
      : []),
    { label: "Log out", icon: "logout", danger: true, onClick: () => void auth.signOut() },
  ];

  return (
    <main className="min-h-screen bg-panel pb-10 text-ink">
      <header className="appbar sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={() => setMenuOpen(true)} className="icon-btn -ml-2" aria-label="Open menu"><Icon name="menu" /></button>
            <div className="min-w-0">
              <h1 className="display truncate text-2xl font-bold leading-tight">{title}</h1>
              <p className="text-xs text-white/85">
                {BRAND.name}. {lastOk ? `Updated ${new Date(lastOk).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Loading"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-2 ${connected ? "bg-white/15" : "bg-danger"}`}>
              <LiveBadge live={connected} label={connected ? "Live" : "Reconnecting. Board may be out of date"} />
            </span>
            {isAdmin && counters.length > 1 && (
              <select value={counterFilter} onChange={(e) => setCounterFilter(e.target.value)} className="field !min-h-[44px] !w-auto" aria-label="Counter">
                <option>All</option>
                {counters.map((c) => <option key={c}>{c}</option>)}
              </select>
            )}
            <button onClick={soundOn ? () => setSoundOn(false) : enableSound} aria-pressed={soundOn} className={`btn ${soundOn ? "btn-ghost" : "btn-inverse"}`}>
              {soundOn ? "Sound on" : "Turn sound on"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-4 px-4 pt-5">
        {!isAdmin && auth.profile.counter && counterNames.data && !counterNames.data.includes(auth.profile.counter) && (
          <p className="banner banner-error" role="alert">
            This account&apos;s counter &quot;{auth.profile.counter}&quot; is not a real counter ({counterNames.data.join(", ")}), so it will see no tickets. Ask the admin to correct it.
          </p>
        )}
        {!isAdmin && !auth.profile.counter && (
          <p className="banner banner-warn">This account has no counter assigned, so it cannot see any tickets. Ask the admin to set one.</p>
        )}
        {error && <p className="banner banner-error" role="alert">{error}</p>}
        {tickets.error && all.length === 0 && <p className="banner banner-error">Could not load tickets. {tickets.error}</p>}

        <div className="grid gap-6 md:grid-cols-3">
          {cols.map((c) => {
            const list = shown.filter((t) => t.status === c.status);
            return (
              <section key={c.status} aria-label={c.label} className="space-y-3">
                <h2 className="card flex items-center justify-between px-4 py-2.5">
                  <span className="section-title">{c.label}</span>
                  <span className="num inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-accent px-2 text-sm font-bold text-white">{list.length}</span>
                </h2>
                {tickets.data !== null && list.length === 0 && (
                  <p className="rounded-lg border-2 border-dashed border-line-strong px-4 py-8 text-center text-muted">No tickets here</p>
                )}
                {list.map((t) => {
                  const next = NEXT[t.status];
                  const working = busy === t.id;
                  return (
                    <TokenSlip key={t.id} number={t.order_number} counter={isAdmin || counters.length > 1 ? t.counter : undefined}
                      status={t.status} statusLabel={`In for ${ago(t.created_at, now)}`} size="lg"
                      footer={
                        <div className="flex gap-2">
                          <button onClick={() => void change(t, next.to)} disabled={busy !== null} className={`btn btn-xl flex-1 ${next.style}`}>
                            {working ? "Saving" : next.label}
                          </button>
                          <button onClick={() => { setReason(""); setError(null); setCancelFor(t); }} disabled={busy !== null} className="btn btn-xl btn-danger-quiet">
                            Cancel
                          </button>
                        </div>
                      }>
                      <ul className="space-y-1 text-xl font-semibold leading-snug">
                        {t.order_items.map((l, i) => (
                          <li key={i}><span className="num font-bold text-accent-ink">{l.quantity} ×</span> {l.item_name}</li>
                        ))}
                      </ul>
                      <p className="num mt-2 text-sm text-muted">{money(t.total_amount)} to collect</p>
                    </TokenSlip>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} name={auth.profile.name} email={auth.session.user.email} items={drawerItems} />

      {cancelFor && (
        <div className="backdrop items-end sm:items-center" role="dialog" aria-modal="true" aria-label="Cancel order" onClick={() => setCancelFor(null)}>
          <div className="dialog rounded-b-none p-5 sm:rounded-b-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="page-title !text-2xl">Cancel No. {cancelFor.order_number}?</h2>
            <p className="hint mt-2">The student sees this reason on their order.</p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick reasons">
              {REASONS.map((r) => (
                <button key={r} onClick={() => setReason(r)} aria-pressed={reason === r} className="chip">{r}</button>
              ))}
            </div>
            <label htmlFor="cancel-reason" className="label mt-4">Reason</label>
            <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Type a reason" className="field" />
            {error && <p className="banner banner-error mt-3" role="alert">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setCancelFor(null)} className="btn btn-quiet btn-lg flex-1">Keep order</button>
              <button onClick={() => void change(cancelFor, "Cancelled", reason)} disabled={busy !== null || reason.trim().length === 0} className="btn btn-danger btn-lg flex-1">
                {busy ? "Saving" : "Cancel order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function KitchenPage() {
  return (
    <RequireRole roles={["chef", "admin"]}>
      <Board />
    </RequireRole>
  );
}
