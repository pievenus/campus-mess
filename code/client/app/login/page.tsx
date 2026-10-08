"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { homeFor, useAuth } from "../lib/auth";
import { BRAND, isCampusEmail, normalizeEmail, supabase } from "../lib/core";
import { LoginArt, Logo } from "../lib/ui";

type Tab = "student" | "staff";
type Step = "email" | "code";
type AuthErr = { message?: string; status?: number } | null;

const RESEND_SECONDS = 60;

function friendly(err: AuthErr, context: "send" | "verify" | "password"): string {
  const m = (err?.message ?? "").toLowerCase();
  if (m.includes("database error saving new user")) return `Use your campus email (${BRAND.campusEmailHint}).`;
  if (err?.status === 429 || m.includes("rate limit") || m.includes("too many") || m.includes("security purposes"))
    return "Too many attempts. Wait a minute, then try again.";
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("load failed"))
    return "No connection. Check your internet and try again.";
  if (context === "verify") return "That code is wrong or has expired. Request a new one.";
  if (context === "password") return "Wrong email or password.";
  return "Could not send the code. Please try again in a moment.";
}

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();

  const [tab, setTab] = useState<Tab>("student");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (auth.status === "ready") router.replace(homeFor(auth.profile.role));
  }, [auth, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const switchTab = (t: Tab) => {
    setTab(t);
    setStep("email");
    setCode("");
    setPassword("");
    setError(null);
    setInfo(null);
  };

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    const addr = normalizeEmail(email);
    if (!isCampusEmail(addr)) {
      setError(`Use your campus email (${BRAND.campusEmailHint}).`);
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true } });
    setBusy(false);
    if (err) {
      setError(friendly(err, "send"));
      return;
    }
    setEmail(addr);
    setStep("code");
    setCode("");
    setCooldown(RESEND_SECONDS);
    setInfo(`We sent a code to ${addr}. It can take a minute; check spam too.`);
  };

  const verifyCode = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setBusy(false);
    if (err) setError(friendly(err, "verify"));
  };

  const staffLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
    setBusy(false);
    if (err) setError(friendly(err, "password"));
  };

  const redirecting = auth.status === "ready";

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="mx-auto w-full max-w-md flex-1 px-5 pb-8 pt-10">
        <div className="flex items-center gap-3"><Logo size={44} /></div>
        <div className="mt-6"><LoginArt size={150} /></div>
        <h1 className="page-title mt-4 !text-[2rem] whitespace-pre-line">Welcome to{"\n"}<em>{BRAND.name}</em></h1>
        <p className="mt-2 text-base text-muted">{BRAND.tagline}</p>
      </div>

      <main className="hero">
        <div className="mx-auto w-full max-w-md px-5 pb-8 pt-6">
          <div className="mb-5 grid grid-cols-2 gap-2" role="tablist" aria-label="Login type">
            {(["student", "staff"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => switchTab(t)}
                className={`min-h-[44px] rounded-full font-display text-sm font-semibold ${tab === t ? "bg-white text-accent" : "bg-white/15 text-white"}`}
              >
                {t === "student" ? "Student" : "Canteen counter"}
              </button>
            ))}
          </div>

          {auth.status === "error" && <p className="banner banner-error mb-4" role="alert">{auth.message}</p>}

          {tab === "student" && step === "email" && (
            <form onSubmit={sendCode} className="space-y-4">
              <div>
                <label htmlFor="email" className="label text-white">Campus email</label>
                <input id="email" type="email" inputMode="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="name@ug.iist.ac.in" className="field !border-white" />
                <p className="mt-2 text-xs text-white/85">We email you a one-time code, so you don&apos;t need a password. You stay signed in on this phone afterwards.</p>
              </div>
              <button type="submit" disabled={busy || redirecting} className="btn btn-inverse btn-lg w-full">{busy ? "Sending code" : "Send code"}</button>
            </form>
          )}

          {tab === "student" && step === "code" && (
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <label htmlFor="code" className="label text-white">Code from your email</label>
                <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" required value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="123456" className="field !border-white display text-center text-3xl font-bold tracking-[0.3em]" />
              </div>
              <button type="submit" disabled={busy || redirecting || code.length < 6} className="btn btn-inverse btn-lg w-full">{busy ? "Checking code" : "Log in"}</button>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => { setStep("email"); setError(null); setInfo(null); }} className="btn btn-ghost">Change email</button>
                <button type="button" disabled={cooldown > 0 || busy} onClick={() => void sendCode()} className="btn btn-ghost">
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {tab === "staff" && (
            <form onSubmit={staffLogin} className="space-y-4">
              <div>
                <label htmlFor="staff-email" className="label text-white">Counter account email</label>
                <input id="staff-email" type="email" autoComplete="username" required value={email}
                  onChange={(e) => setEmail(e.target.value)} className="field !border-white" />
              </div>
              <div>
                <label htmlFor="password" className="label text-white">Password</label>
                <input id="password" type="password" autoComplete="current-password" required value={password}
                  onChange={(e) => setPassword(e.target.value)} className="field !border-white" />
              </div>
              <button type="submit" disabled={busy || redirecting} className="btn btn-inverse btn-lg w-full">{busy ? "Logging in" : "Log in"}</button>
            </form>
          )}

          {info && !error && <p className="banner banner-ok mt-4" role="status">{info}</p>}
          {error && <p className="banner banner-error mt-4" role="alert">{error}</p>}
          <p className="mt-5 text-xs text-white/85">
            Tip: add this site to your home screen for one-tap ordering. We store your campus email and your orders only to run the
            canteen. Questions or deletion requests: ask {BRAND.supportContact}.
          </p>
        </div>
      </main>
    </div>
  );
}
