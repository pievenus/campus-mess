"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import type { OrderStatus } from "./core";

const ICONS = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  cart: <><path d="M3 4h2.2l2.3 11h10.1l2.1-8H6.2" /><circle cx="9" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /></>,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  logout: <path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" />,
  settings: <><path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2.2" /><circle cx="8" cy="17" r="2.2" /></>,
  flame: <path d="M12 3c.8 3.8 5 5 5 10a5 5 0 0 1-10 0c0-1.9.9-3.2 2-4 .4 1.9 1.4 2.4 2 1.9 1-1.9 0-5 1-7.9z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

export function Logo({ size = 32, tone = "accent" }: { size?: number; tone?: "accent" | "white" }) {
  const tile = tone === "accent" ? "var(--color-accent)" : "#ffffff";
  const ink = tone === "accent" ? "#ffffff" : "var(--color-accent)";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill={tile} />
      <path d="M12 18a4 4 0 0 1 4-4h32a4 4 0 0 1 4 4v8a4 4 0 0 0 0 8v12a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V34a4 4 0 0 0 0-8z" fill={ink} />
      <path d="M18 43h28" stroke={tile} strokeWidth="3" strokeDasharray="4 4" strokeLinecap="round" />
      <path d="M24 29l6 6 11-12" fill="none" stroke={tile} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VegMark({ veg }: { veg: boolean }) {
  const c = veg ? "var(--color-ok)" : "var(--color-danger)";
  return (
    <span role="img" aria-label={veg ? "Vegetarian" : "Non-vegetarian"} className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border-[1.5px] bg-white" style={{ borderColor: c }}>
      <span className="h-2 w-2 rounded-full" style={{ background: c }} />
    </span>
  );
}

export function LoginArt({ size = 150 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true" focusable="false">
      <ellipse cx="80" cy="148" rx="62" ry="5" fill="var(--color-line)" />
      <rect x="40" y="10" width="80" height="136" rx="12" fill="#fff" stroke="var(--color-ink)" strokeWidth="4" />
      <rect x="66" y="16" width="28" height="5" rx="2.5" fill="var(--color-ink)" />
      <rect x="50" y="30" width="60" height="42" rx="6" fill="var(--color-accent-soft)" />
      <circle cx="80" cy="51" r="13" fill="#fff" stroke="var(--color-accent)" strokeWidth="3" />
      <circle cx="80" cy="51" r="5" fill="var(--color-amber)" />
      <rect x="50" y="82" width="60" height="42" rx="6" fill="var(--color-line)" />
      <path d="M64 112h32M70 98h20" stroke="var(--color-muted)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="62" cy="134" r="6" fill="var(--color-accent)" /><path d="M59 134h6M62 131v6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="98" cy="134" r="6" fill="var(--color-accent)" /><path d="M95 134h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyCartArt() {
  return (
    <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true" focusable="false">
      <circle cx="52" cy="52" r="48" fill="var(--color-line)" />
      <path d="M26 34h8l6 30h30l6-22H38" fill="#fff" stroke="var(--color-ink)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="46" cy="76" r="4" fill="var(--color-accent)" /><circle cx="68" cy="76" r="4" fill="var(--color-accent)" />
    </svg>
  );
}

const CHIP: Record<OrderStatus, string> = {
  Pending: "status-pending",
  Cooking: "status-cooking",
  Ready: "status-ready",
  Completed: "status-done",
  Cancelled: "status-cancelled",
};
export const STATUS_WORD: Record<OrderStatus, string> = {
  Pending: "Waiting",
  Cooking: "Cooking",
  Ready: "Ready to collect",
  Completed: "Collected",
  Cancelled: "Cancelled",
};

export function TokenSlip({
  number,
  counter,
  status,
  statusLabel,
  size = "md",
  children,
  footer,
}: {
  number: number;
  counter?: string;
  status: OrderStatus;
  statusLabel?: string;
  size?: "md" | "lg";
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const label = statusLabel ?? STATUS_WORD[status];
  return (
    <article className="card overflow-hidden" aria-label={`Token ${number}${counter ? `, ${counter}` : ""}, ${label}`}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1.5">
          {counter && <p className="section-title truncate">{counter}</p>}
          <span className={`status-chip ${CHIP[status]}`}>{label}</span>
        </div>
        <div className="shrink-0 text-right">
          <p className="micro">Token</p>
          <p className={`ticket-number ${size === "lg" ? "text-[4.5rem]" : "text-[3rem]"}`}>{number}</p>
        </div>
      </div>
      {children !== undefined && (
        <div className="border-t border-line-strong px-4 pb-4 pt-3">
          <p className="micro mb-1.5">Items</p>
          {children}
        </div>
      )}
      {footer && <div className="border-t border-line bg-panel px-4 py-3">{footer}</div>}
    </article>
  );
}

const STEPS = ["Order placed", "Cooking", "Ready to collect", "Collected"] as const;
const STEP_INDEX: Partial<Record<OrderStatus, number>> = { Pending: 0, Cooking: 1, Ready: 2, Completed: 3 };

export function StatusTimeline({ status }: { status: OrderStatus }) {
  const at = STEP_INDEX[status];
  if (at === undefined) return null;
  return (
    <ol className="tl" aria-label="Order progress">
      {STEPS.map((s, i) => (
        <li key={s} data-done={i <= at} data-current={i === at} aria-current={i === at ? "step" : undefined}>{s}</li>
      ))}
    </ol>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="spinner" role="status" aria-label={label} />;
}

export function MenuSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading the menu" className="-mx-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-4">
          <div className="skeleton h-4 w-4" />
          <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-3/5" /><div className="skeleton h-3 w-1/5" /></div>
          <div className="skeleton h-11 w-[84px]" />
        </div>
      ))}
    </div>
  );
}

export function LiveBadge({ live, label }: { live: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold" role="status">
      <span className={`dot ${live ? "bg-ok-soft" : "bg-amber beat"}`} aria-hidden="true" />
      {label ?? (live ? "Live" : "Reconnecting")}
    </span>
  );
}

export function Qty({ qty, onChange, name, max = 20 }: { qty: number; onChange: (q: number) => void; name: string; max?: number }) {
  if (qty <= 0) {
    return (
      <div className="qty">
        <button onClick={() => onChange(1)} className="!w-auto gap-1 bg-accent-soft px-3 text-[0.8125rem] font-bold text-accent-ink hover:!bg-accent-soft" aria-label={`Add ${name}`}>
          Add <Icon name="plus" size={16} />
        </button>
      </div>
    );
  }
  return (
    <div className="qty" role="group" aria-label={`Quantity of ${name}`}>
      <button onClick={() => onChange(qty - 1)} aria-label={`Remove one ${name}`}><Icon name="minus" size={18} /></button>
      <span className="qty-val num" aria-live="polite">{qty}</span>
      <button onClick={() => onChange(qty + 1)} disabled={qty >= max} aria-label={`Add one ${name}`}><Icon name="plus" size={18} /></button>
    </div>
  );
}

export type DrawerItem = { label: string; icon: IconName; href?: string; onClick?: () => void; danger?: boolean };

export function Drawer({ open, onClose, name, email, items }: { open: boolean; onClose: () => void; name: string; email?: string; items: DrawerItem[] }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />
      <nav className="drawer" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="flex items-start justify-between gap-2 px-5 pb-4 pt-6">
          <div className="min-w-0">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <p className="mt-4 truncate font-display text-xl font-bold">{name}</p>
            {email && <p className="mt-0.5 truncate text-sm font-semibold text-muted">{email}</p>}
          </div>
          <button onClick={onClose} className="icon-btn icon-btn-dark -mr-2 -mt-2" aria-label="Close menu" autoFocus><Icon name="close" /></button>
        </div>
        <div className="h-px bg-line-strong" />
        <ul className="py-2">
          {items.map((it) => (
            <li key={it.label}>
              {it.href ? (
                <Link href={it.href} onClick={onClose} className="drawer-item"><Icon name={it.icon} />{it.label}</Link>
              ) : (
                <button onClick={() => { onClose(); it.onClick?.(); }} className={`drawer-item ${it.danger ? "text-danger" : ""}`}><Icon name={it.icon} />{it.label}</button>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
