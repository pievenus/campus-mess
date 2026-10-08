"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Drawer, EmptyCartArt, Icon, Logo, MenuSkeleton, Qty, StatusTimeline, TokenSlip, VegMark, STATUS_WORD, type DrawerItem } from "./lib/ui";
import { RequireRole, useAuth } from "./lib/auth";
import { useLive } from "./lib/useLive";
import { BRAND, CATEGORY_ORDER, money, supabase, type MenuItem, type MyOrder, type PlacedOrder } from "./lib/core";

const MAX_QTY = 20;

function orderErrorMessage(raw: string): { text: string; refreshMenu: boolean } {
  const m = raw.toLowerCase();
  if (m.includes("canteen_closed")) return { text: "The canteen is closed right now.", refreshMenu: false };
  if (m.includes("item_unavailable"))
    return { text: `Some items just became unavailable (${raw.split(":").slice(1).join(":").trim()}). Remove them and try again.`, refreshMenu: true };
  if (m.includes("order_too_large")) return { text: "That is too many items for one order (the limit is 40). Remove a few and try again.", refreshMenu: false };
  if (m.includes("too_many_active_orders"))
    return { text: "You already have 6 orders in progress. Collect one, then order again.", refreshMenu: false };
  if (m.includes("invalid_items")) return { text: "Something is wrong with your cart. Refresh the page and try again.", refreshMenu: true };
  if (m.includes("not_authenticated") || m.includes("jwt")) return { text: "Your session expired. Please log in again.", refreshMenu: false };
  if (m.includes("fetch") || m.includes("network") || m.includes("load failed") || m.includes("timeout"))
    return { text: "We could not reach the server. Tap Place order again. It is safe: you will not get two tokens.", refreshMenu: false };
  return {
    text: "Something went wrong. Tap Place order again (it is safe: you will not get two tokens). If it keeps happening, tell the canteen admin.",
    refreshMenu: false,
  };
}

async function fetchMenu(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, name, category, price, is_available, veg_or_nonveg, counter")
    .eq("is_archived", false)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({ ...(m as MenuItem), price: Number(m.price) }));
}

async function fetchIsOpen(): Promise<boolean> {
  const { data, error } = await supabase.from("settings").select("is_open").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.is_open ?? false;
}

async function fetchMyOrders(userId: string): Promise<MyOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, counter, status, total_amount, cancel_reason, created_at, order_items(item_name, quantity, unit_price)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((o) => ({ ...(o as unknown as MyOrder), total_amount: Number(o.total_amount) }));
}

async function recoverOrders(userId: string, requestId: string): Promise<PlacedOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, counter, total_amount, status")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .order("order_number");
  if (error || !data) return [];
  return data.map((o) => ({ ...(o as unknown as PlacedOrder), total_amount: Number(o.total_amount) }));
}

function Home() {
  const auth = useAuth();
  const menuLive = useLive("menu", fetchMenu, ["menu_items"], 60_000, { realtime: false });
  const openLive = useLive("settings", fetchIsOpen, ["settings"], 15_000, { realtime: false });
  const myId = auth.status === "ready" ? auth.session.user.id : "";
  const ordersLive = useLive("my-orders", () => fetchMyOrders(myId), ["orders"], 10_000, { realtime: false });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const [cart, setCart] = useState<Record<string, number>>({});
  const [showCart, setShowCart] = useState(false);
  const [filter, setFilter] = useState<"all" | "veg" | "non-veg">("all");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const placingRef = useRef(false);
  const request = useRef<{ sig: string; id: string } | null>(null);

  const menu = useMemo(() => menuLive.data ?? [], [menuLive.data]);
  const byId = useMemo(() => new Map(menu.map((m) => [m.id, m])), [menu]);

  const categories = useMemo(() => {
    const present = Array.from(new Set(menu.map((m) => m.category)));
    const known = CATEGORY_ORDER.filter((c) => present.includes(c));
    const rest = present.filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...rest];
  }, [menu]);

  const visible = useMemo(
    () => {
      const term = search.trim().toLowerCase();
      return menu.filter(
        (m) =>
          (filter === "all" || m.veg_or_nonveg === filter) &&
          (category === "All" || m.category === category) &&
          (term === "" || m.name.toLowerCase().includes(term)),
      );
    },
    [menu, filter, category, search],
  );
  const sections = categories.map((c) => ({ name: c, items: visible.filter((m) => m.category === c) })).filter((s) => s.items.length > 0);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ item: byId.get(id), id, qty }))
        .filter((l): l is { item: MenuItem; id: string; qty: number } => l.item !== undefined),
    [cart, byId],
  );
  const itemCount = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + l.qty * l.item.price, 0);
  const counters = Array.from(new Set(lines.map((l) => l.item.counter)));
  const hasUnavailable = lines.some((l) => !l.item.is_available);
  const isOpen = openLive.data;

  const setQty = (id: string, qty: number) => {
    setPlaced(null);
    setOrderError(null);
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = Math.min(qty, MAX_QTY);
      return next;
    });
  };

  const requestId = () => {
    const sig = JSON.stringify(Object.entries(cart).sort());
    if (!request.current || request.current.sig !== sig) request.current = { sig, id: crypto.randomUUID() };
    return request.current.id;
  };

  const finishPlaced = (orders: PlacedOrder[]) => {
    setPlaced(orders);
    setCart({});
    request.current = null;
    setShowCart(false);
    setOrderError(null);
    void ordersLive.refresh();
  };

  const placeOrder = async () => {
    if (placingRef.current || lines.length === 0 || hasUnavailable) return;
    placingRef.current = true;
    setPlacing(true);
    setOrderError(null);
    try {
      const { data, error } = await supabase.rpc("place_order", {
        p_request_id: requestId(),
        p_items: lines.map((l) => ({ menu_item_id: l.id, quantity: l.qty })),
      });
      if (error) {
        const rid = request.current?.id;
        const found = rid ? await recoverOrders(myId, rid).catch(() => []) : [];
        if (found.length > 0) return finishPlaced(found);
        const e = orderErrorMessage(error.message);
        setOrderError(e.text);
        if (e.refreshMenu) void menuLive.refresh();
        void openLive.refresh();
        return;
      }
      finishPlaced(data as PlacedOrder[]);
    } catch {
      const rid = request.current?.id;
      const found = rid ? await recoverOrders(myId, rid).catch(() => []) : [];
      if (found.length > 0) finishPlaced(found);
      else setOrderError(orderErrorMessage("network").text);
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  };

  if (auth.status !== "ready") return null;
  const orders = ordersLive.data ?? [];
  const activeOrders = orders.filter((o) => o.status === "Pending" || o.status === "Cooking" || o.status === "Ready");
  const pastOrders = orders.filter((o) => !activeOrders.includes(o));

  const first = auth.profile.name.trim().split(/\s+/)[0] || "there";
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? "Good morning," : hour < 17 ? "Good afternoon," : "Good evening,";
  const jumpToOrders = () => (document.getElementById("orders") ?? document.getElementById("orders-earlier"))?.scrollIntoView({ behavior: "smooth" });
  const drawerItems: DrawerItem[] = [
    ...(orders.length > 0 ? [{ label: "Your orders", icon: "receipt", onClick: jumpToOrders } as DrawerItem] : []),
    ...(auth.profile.role === "admin" ? [{ label: "Admin", icon: "settings", href: "/admin/" } as DrawerItem] : []),
    { label: "Log out", icon: "logout", danger: true, onClick: () => void auth.signOut() },
  ];

  return (
    <main className="min-h-screen bg-paper pb-32 text-ink">
      <header className="hero">
        <div className="mx-auto max-w-2xl px-4 pb-6 pt-3">
          <div className="flex items-center justify-between">
            <button onClick={() => setMenuOpen(true)} className="icon-btn -ml-2" aria-label="Open menu"><Icon name="menu" /></button>
            <Logo size={36} tone="white" />
          </div>
          <h1 className="hero-title mt-3 whitespace-pre-line">{greeting}{"\n"}{first}</h1>
          <p className="mt-1 text-sm text-white/85">{BRAND.tagline}</p>
        </div>
        {ordersLive.error && ordersLive.lastOk !== null && (
          <p className="bg-amber-soft px-4 py-1.5 text-center text-sm font-semibold text-amber-ink" role="status">
            Could not refresh. Showing data from {Math.max(1, Math.round((now - ordersLive.lastOk) / 1000))} s ago. Check your connection.
          </p>
        )}
      </header>

      {isOpen === false && (
        <p className="strip strip-danger text-center" role="status">
          The canteen is closed right now. You can read the menu, but orders are paused.
        </p>
      )}

      <div className="mx-auto max-w-2xl px-4">
        {ordersLive.error && orders.length === 0 && <p className="banner banner-error mt-4" role="alert">Could not load your orders. {ordersLive.error}</p>}

        {activeOrders.length > 0 && (
          <section id="orders" aria-label="Your orders" className="space-y-3 pt-5">
            <h2 className="section-title">Track your orders</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {activeOrders.map((o) => (
                <TokenSlip key={o.id} number={o.order_number} counter={o.counter} status={o.status}
                  footer={<span className="num text-sm font-semibold">{money(o.total_amount)} to pay at the counter</span>}>
                  <ul className="space-y-1 text-sm font-semibold">
                    {o.order_items.map((l, i) => (
                      <li key={i}><span className="num font-bold text-accent-ink">{l.quantity} ×</span> {l.item_name}</li>
                    ))}
                  </ul>
                  <div className="mt-3 border-t border-line pt-3"><StatusTimeline status={o.status} /></div>
                </TokenSlip>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Menu" className="pt-5">
          <div className="sticky top-0 z-10 -mx-4 space-y-3 border-b border-line bg-white/95 px-4 pb-3 pt-2 backdrop-blur">
            <div className="flex items-center gap-3">
              <h2 className="section-title">Menu</h2>
              <label className="pill-field ml-auto max-w-[19rem] flex-1">
                <Icon name="search" size={18} />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the menu" aria-label="Search the menu" />
                {search !== "" && <button onClick={() => setSearch("")} className="icon-btn icon-btn-dark -mr-3 !h-9 !w-9" aria-label="Clear search"><Icon name="close" size={18} /></button>}
              </label>
            </div>
            <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Food type">
              {(["all", "veg", "non-veg"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className="chip">
                  {f === "all" ? "All" : f === "veg" ? "Veg" : "Non-veg"}
                </button>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Category">
              {["All", ...categories].map((c) => (
                <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c} className="chip">{c}</button>
              ))}
            </div>
          </div>

          {menuLive.data === null && !menuLive.error && <MenuSkeleton />}
          {menuLive.error && menuLive.data === null && (
            <p className="banner banner-error mt-4" role="alert">
              Could not load the menu. Check your connection.{" "}
              <button onClick={() => void menuLive.refresh()} className="font-bold underline">Try again</button>
            </p>
          )}
          {menuLive.data !== null && sections.length === 0 && <p className="hint py-6">Nothing matches that filter. Try All.</p>}

          {sections.map((s) => (
            <div key={s.name}>
              <h3 className="cat-label -mx-4">{s.name}</h3>
              <ul className="rows -mx-4">
                {s.items.map((m) => (
                  <li key={m.id}>
                    <VegMark veg={m.veg_or_nonveg === "veg"} />
                    <div className={`min-w-0 flex-1 ${m.is_available ? "" : "text-muted"}`}>
                      <p className={`item-name ${m.is_available ? "" : "line-through"}`}>{m.name}</p>
                      <p className="item-price num mt-0.5">{m.is_available ? money(m.price) : <span className="text-danger">Sold out</span>}</p>
                    </div>
                    {m.is_available && <Qty qty={cart[m.id] ?? 0} onChange={(q) => setQty(m.id, q)} name={m.name} max={MAX_QTY} />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {pastOrders.length > 0 && (
          <section id="orders-earlier" aria-label="Earlier orders" className="space-y-3 pt-8">
            <h2 className="section-title text-muted">Earlier orders</h2>
            <ul className="space-y-3">
              {pastOrders.map((o) => (
                <li key={o.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="section-title truncate">{o.counter}</p>
                      <p className="num text-xs font-semibold text-muted">Token {o.order_number}</p>
                    </div>
                    <span className={`status-chip shrink-0 ${o.status === "Cancelled" ? "status-cancelled" : "status-done"}`}>{STATUS_WORD[o.status]}</span>
                  </div>
                  <p className="micro mt-3">Items</p>
                  <p className="mt-0.5 text-xs font-bold text-accent-ink">{o.order_items.map((l) => `${l.quantity} × ${l.item_name}`).join(", ")}</p>
                  {o.status === "Cancelled" && o.cancel_reason && <p className="mt-2 text-sm font-semibold text-danger">Reason: {o.cancel_reason}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} name={auth.profile.name} email={auth.session.user.email} items={drawerItems} />

      {placed && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-white" role="dialog" aria-modal="true" aria-label="Order placed">
          <div className="mx-auto max-w-2xl px-4 pb-10 pt-10">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-ok text-white"><Icon name="check" size={34} /></span>
            <h2 className="page-title mt-5">Order <em>placed</em></h2>
            <p className="mb-6 mt-2 text-base text-muted" role="status">Remember your number and pay at the counter when you collect.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {placed.map((p) => (
                <TokenSlip key={p.id} number={p.order_number} counter={p.counter} status="Pending" statusLabel="Order placed" size="lg"
                  footer={<span className="num text-sm font-semibold">{money(p.total_amount)} to pay at the counter</span>} />
              ))}
            </div>
            {placed.length > 1 && <p className="hint mt-4">Your items come from {placed.length} counters, so you have one number for each.</p>}
            <button onClick={() => { setPlaced(null); window.scrollTo(0, 0); }} className="btn btn-primary btn-xl mt-6 w-full">Done</button>
          </div>
        </div>
      )}

      {itemCount > 0 && !showCart && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3">
          <button onClick={() => setShowCart(true)} style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}
            className="mx-auto flex min-h-[56px] w-full max-w-2xl items-center justify-between rounded-lg bg-accent px-4 font-display font-semibold text-white">
            <span><span className="num">{itemCount}</span> item{itemCount > 1 ? "s" : ""}<span className="mx-2 opacity-60" aria-hidden="true">|</span><span className="num">{money(total)}</span></span>
            <span className="inline-flex items-center gap-2">View cart <Icon name="cart" size={20} /></span>
          </button>
        </div>
      )}

      {showCart && (
        <div className="fixed inset-0 z-40 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Your cart">
          <header className="hero">
            <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3">
              <button onClick={() => setShowCart(false)} className="icon-btn -ml-2" aria-label="Close cart"><Icon name="back" /></button>
              <h2 className="hero-title !text-2xl">Your cart</h2>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl">
              {lines.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-16 text-center">
                  <EmptyCartArt />
                  <p className="mt-4 text-muted">Your cart is empty. Add something from the menu.</p>
                </div>
              ) : (
                <ul className="rows">
                  {lines.map((l) => (
                    <li key={l.id}>
                      <VegMark veg={l.item.veg_or_nonveg === "veg"} />
                      <div className="min-w-0 flex-1">
                        <p className="item-name">{l.item.name}</p>
                        <p className="mt-0.5 text-xs font-semibold text-muted">
                          {l.item.is_available ? (
                            <><span className="num">{money(l.item.price)}</span> each, from {l.item.counter}</>
                          ) : (
                            <span className="text-danger">No longer available. Remove it to continue.</span>
                          )}
                        </p>
                      </div>
                      <Qty qty={l.qty} onChange={(q) => setQty(l.id, q)} name={l.item.name} max={MAX_QTY} />
                    </li>
                  ))}
                </ul>
              )}

              {counters.length > 1 && <p className="banner banner-warn mx-4 mt-3">These items come from {counters.length} counters, so you will get {counters.length} numbers.</p>}
              {lines.length > 0 && (
                <div className="mt-2 flex items-center gap-2 border-y border-line px-4 py-4 text-accent">
                  <Icon name="info" size={18} />
                  <span className="flex-1 font-display text-sm font-bold">Total, pay at the counter</span>
                  <span className="num font-display text-xl font-bold">{money(total)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-line bg-white p-3">
            <div className="mx-auto max-w-2xl space-y-2">
              {isOpen === false && <p className="banner banner-error" role="status">The canteen is closed right now.</p>}
              {orderError && <p className="banner banner-error" role="alert">{orderError}</p>}
              <button onClick={() => void placeOrder()} disabled={placing || lines.length === 0 || hasUnavailable || isOpen === false} className="btn btn-primary btn-xl w-full">
                {placing ? "Placing order" : "Place order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function HomePage() {
  return (
    <RequireRole roles={["student", "admin"]}>
      <Home />
    </RequireRole>
  );
}
