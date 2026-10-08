"use client";

import { useMemo, useState } from "react";
import { RequireRole, useAuth } from "../lib/auth";
import { useLive } from "../lib/useLive";
import { Drawer, Icon, Logo, MenuSkeleton, VegMark, type DrawerItem } from "../lib/ui";
import { BRAND, CATEGORY_ORDER, money, supabase } from "../lib/core";

type AdminItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  is_available: boolean;
  is_archived: boolean;
  veg_or_nonveg: "veg" | "non-veg";
  counter: string;
};
type Draft = { id: string | null; name: string; category: string; price: string; veg_or_nonveg: "veg" | "non-veg"; counter: string };

async function fetchItems(): Promise<AdminItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, name, category, price, is_available, is_archived, veg_or_nonveg, counter")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({ ...(m as AdminItem), price: Number(m.price) }));
}
async function fetchCounters(): Promise<string[]> {
  const { data, error } = await supabase.from("counters").select("name, sort_order").order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => c.name as string);
}
async function fetchOpen(): Promise<boolean> {
  const { data, error } = await supabase.from("settings").select("is_open").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.is_open ?? false;
}

function saveError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("menu_items_live_name_uniq") || m.includes("duplicate")) return "An item with that name already exists.";
  if (m.includes("price")) return "Price must be between 0 and 5000.";
  if (m.includes("row-level security") || m.includes("permission")) return "You are not allowed to do that.";
  if (m.includes("jwt")) return "Session expired. Please log in again.";
  return "Could not save. Check the connection and try again.";
}

function Admin() {
  const auth = useAuth();
  const items = useLive("admin-menu", fetchItems, ["menu_items"]);
  const open = useLive("admin-open", fetchOpen, ["settings"]);
  const countersLive = useLive("admin-counters", fetchCounters, ["counters"], 60_000);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const counters = useMemo(() => countersLive.data ?? [], [countersLive.data]);
  const all = useMemo(() => items.data ?? [], [items.data]);
  const categories = useMemo(() => {
    const present = Array.from(new Set(all.map((m) => m.category)));
    return [...CATEGORY_ORDER.filter((c) => present.includes(c)), ...present.filter((c) => !CATEGORY_ORDER.includes(c)).sort()];
  }, [all]);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await fn();
      if (error) {
        setMsg(saveError(error.message));
        return false;
      }
      after?.();
      return true;
    } catch {
      setMsg(saveError("network"));
      return false;
    } finally {
      setBusy(false);
      void items.refresh();
      void open.refresh();
    }
  };

  const setOpen = (v: boolean) => {
    if (!v && !window.confirm("Close the canteen? Students will not be able to place orders until you open it again.")) return;
    void run(() => supabase.from("settings").update({ is_open: v }).eq("id", 1));
  };
  const toggleAvail = (m: AdminItem) => void run(() => supabase.from("menu_items").update({ is_available: !m.is_available }).eq("id", m.id));
  const archive = (m: AdminItem) => {
    if (!window.confirm(`Remove "${m.name}" from the menu? Past orders keep it. You can restore it later.`)) return;
    void run(() => supabase.from("menu_items").update({ is_archived: true, is_available: false }).eq("id", m.id));
  };
  const restore = (m: AdminItem) => void run(() => supabase.from("menu_items").update({ is_archived: false }).eq("id", m.id));

  const startNew = () => {
    setFormError(null);
    setDraft({ id: null, name: "", category: categories[0] ?? "", price: "", veg_or_nonveg: "veg", counter: counters[0] ?? "" });
  };
  const startEdit = (m: AdminItem) => {
    setFormError(null);
    setDraft({ id: m.id, name: m.name, category: m.category, price: String(m.price), veg_or_nonveg: m.veg_or_nonveg, counter: m.counter });
  };
  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const category = draft.category.trim();
    const price = Number(draft.price);
    if (!name || name.length > 100) return setFormError("Enter a name (up to 100 characters).");
    if (!category) return setFormError("Choose or type a category.");
    if (draft.price.trim() === "" || !Number.isFinite(price) || price < 0 || price > 5000) return setFormError("Price must be between 0 and 5000.");
    if (!draft.counter) return setFormError("Choose a counter.");
    const row = { name, category, price, veg_or_nonveg: draft.veg_or_nonveg, counter: draft.counter };
    setFormError(null);
    const ok = await run(
      () => (draft.id ? supabase.from("menu_items").update(row).eq("id", draft.id) : supabase.from("menu_items").insert(row)),
      () => setDraft(null),
    );
    if (!ok) setFormError("Not saved. See the message above, then try again.");
  };

  if (auth.status !== "ready") return null;
  const term = q.trim().toLowerCase();
  const live = all.filter((m) => !m.is_archived && (term === "" || m.name.toLowerCase().includes(term)));
  const archived = all.filter((m) => m.is_archived);
  const sections = categories.map((c) => ({ name: c, rows: live.filter((m) => m.category === c) })).filter((s) => s.rows.length > 0);
  const isOpen = open.data;

  const drawerItems: DrawerItem[] = [
    { label: "Kitchen", icon: "flame", href: "/kitchen/" },
    { label: "Student view", icon: "user", href: "/" },
    { label: "Log out", icon: "logout", danger: true, onClick: () => void auth.signOut() },
  ];

  return (
    <main className="min-h-screen bg-paper pb-16 text-ink">
      <header className="hero">
        <div className="mx-auto max-w-3xl px-4 pb-6 pt-3">
          <div className="flex items-center justify-between">
            <button onClick={() => setMenuOpen(true)} className="icon-btn -ml-2" aria-label="Open menu"><Icon name="menu" /></button>
            <Logo size={36} tone="white" />
          </div>
          <h1 className="hero-title mt-3">Admin</h1>
          <p className="mt-1 text-sm text-white/85">{BRAND.name}. {auth.profile.name}</p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-5">
        {msg && <p className="banner banner-error" role="alert">{msg}</p>}
        {items.error && all.length === 0 && <p className="banner banner-error">Could not load the menu. {items.error}</p>}

        <section aria-label="Canteen status" className={`card flex flex-wrap items-center justify-between gap-4 border-l-4 p-4 ${isOpen ? "border-ok" : isOpen === false ? "border-danger" : "border-line-strong"}`}>
          <div>
            <p className="micro">The canteen is</p>
            <p className={`display text-4xl font-bold leading-tight ${isOpen ? "text-ok" : isOpen === false ? "text-danger" : "text-muted"}`}>{isOpen === null ? "…" : isOpen ? "Open" : "Closed"}</p>
            <p className="hint mt-1">{isOpen ? "Students can place orders." : isOpen === false ? "Students cannot place orders." : "Checking"}</p>
          </div>
          {isOpen !== null && (
            <button onClick={() => setOpen(!isOpen)} disabled={busy} className={`btn btn-xl ${isOpen ? "btn-danger" : "btn-primary"}`}>
              {isOpen ? "Close canteen" : "Open canteen"}
            </button>
          )}
        </section>

        <section aria-label="Menu" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="section-title">Menu</h2>
            <button onClick={startNew} className="btn btn-primary"><Icon name="plus" size={18} />Add item</button>
          </div>
          <div>
            <label htmlFor="menu-search" className="sr-only">Search the menu</label>
            <div className="pill-field">
              <Icon name="search" size={18} />
              <input id="menu-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu" />
            </div>
          </div>
          {items.data === null && !items.error && <MenuSkeleton rows={5} />}
          {sections.map((s) => (
            <div key={s.name}>
              <h3 className="cat-label -mx-4">{s.name}</h3>
              <ul className="rows -mx-4">
                {s.rows.map((m) => (
                  <li key={m.id} className="flex-wrap gap-y-2">
                    <VegMark veg={m.veg_or_nonveg === "veg"} />
                    <div className="min-w-0 flex-1 basis-48">
                      <p className={`item-name ${m.is_available ? "" : "text-muted line-through"}`}>{m.name}</p>
                      <p className="mt-0.5 text-xs font-semibold text-muted"><span className="num font-bold text-ink">{money(m.price)}</span> at {m.counter}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleAvail(m)} disabled={busy} role="switch" aria-checked={m.is_available} aria-label={`${m.name} availability`} className="switch" />
                      <span className={`w-[4.75rem] text-xs font-bold ${m.is_available ? "text-ok" : "text-danger"}`}>{m.is_available ? "Available" : "Sold out"}</span>
                      <button onClick={() => startEdit(m)} className="btn btn-quiet">Edit</button>
                      <button onClick={() => archive(m)} disabled={busy} className="btn btn-danger-quiet">Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {items.data !== null && sections.length === 0 && <p className="hint py-4">No items match. Clear the search or add a new item.</p>}
        </section>

        {archived.length > 0 && (
          <section aria-label="Removed items" className="space-y-2">
            <button onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived} className="btn btn-quiet">
              {showArchived ? "Hide" : "Show"} removed items ({archived.length})
            </button>
            {showArchived && (
              <ul className="rows -mx-4">
                {archived.map((m) => (
                  <li key={m.id} className="justify-between">
                    <span className="min-w-0 truncate text-sm font-semibold text-muted">{m.name}, {m.counter}</span>
                    <button onClick={() => restore(m)} disabled={busy} className="btn btn-quiet">Restore</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} name={auth.profile.name} email={auth.session.user.email} items={drawerItems} />

      {draft && (
        <div className="backdrop items-end sm:items-center" role="dialog" aria-modal="true" aria-label={draft.id ? "Edit item" : "Add item"} onClick={() => setDraft(null)}>
          <div className="dialog max-h-[92vh] overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="page-title !text-2xl">{draft.id ? "Edit item" : "Add item"}</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="f-name" className="label">Name</label>
                <input id="f-name" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="field" />
              </div>
              <div>
                <label htmlFor="f-cat" className="label">Category</label>
                <input id="f-cat" list="cats" value={draft.category} maxLength={50} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="field" />
                <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                <p className="hint mt-1">Pick an existing category or type a new one.</p>
              </div>
              <div>
                <label htmlFor="f-price" className="label">Price in rupees</label>
                <input id="f-price" value={draft.price} inputMode="decimal" onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="field" />
              </div>
              <div>
                <p className="label">Type</p>
                <div className="flex gap-2" role="group" aria-label="Food type">
                  {(["veg", "non-veg"] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setDraft({ ...draft, veg_or_nonveg: v })} aria-pressed={draft.veg_or_nonveg === v} className="chip flex-1 justify-center gap-2 !min-h-[48px]">
                      <VegMark veg={v === "veg"} />
                      {v === "veg" ? "Veg" : "Non-veg"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="f-counter" className="label">Counter</label>
                <select id="f-counter" value={draft.counter} onChange={(e) => setDraft({ ...draft, counter: e.target.value })} className="field">
                  {counters.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {formError && <p className="banner banner-error mt-4" role="alert">{formError}</p>}
            {msg && <p className="banner banner-error mt-2" role="alert">{msg}</p>}
            <div className="mt-5 flex gap-2">
              <button onClick={() => setDraft(null)} className="btn btn-quiet btn-lg flex-1">Cancel</button>
              <button onClick={() => void save()} disabled={busy} className="btn btn-primary btn-lg flex-1">{busy ? "Saving" : "Save item"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function AdminPage() {
  return (
    <RequireRole roles={["admin"]}>
      <Admin />
    </RequireRole>
  );
}
