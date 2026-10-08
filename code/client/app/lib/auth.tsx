"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./core";
import { Spinner } from "./ui";

export type Role = "student" | "chef" | "admin";
export type Profile = { id: string; name: string; role: Role; counter: string | null };

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "ready"; session: Session; profile: Profile }
  | { status: "error"; message: string };

type AuthContextValue = AuthState & { signOut: () => Promise<void>; retry: () => void };

const AuthContext = createContext<AuthContextValue | null>(null);

export const homeFor = (role: Role) => (role === "admin" ? "/admin" : role === "chef" ? "/kitchen" : "/");

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSessionChecked(true);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    let alive = true;
    setProfile(null);
    setProfileError(null);
    supabase
      .from("profiles")
      .select("id, name, role, counter")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setProfileError("Could not load your account. Check your connection and try again.");
        else if (!data) setProfileError("Your account has no profile. Please contact the canteen admin.");
        else setProfile(data as Profile);
      });
    return () => {
      alive = false;
    };
  }, [userId, retryTick]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);
  const retry = useCallback(() => setRetryTick((n) => n + 1), []);

  const value = useMemo<AuthContextValue>(() => {
    let state: AuthState;
    if (!supabaseConfigured) {
      state = { status: "error", message: "The app is not configured (missing Supabase URL or key)." };
    } else if (!sessionChecked) {
      state = { status: "loading" };
    } else if (!session) {
      state = { status: "signedOut" };
    } else if (profileError) {
      state = { status: "error", message: profileError };
    } else if (!profile) {
      state = { status: "loading" };
    } else {
      state = { status: "ready", session, profile };
    }
    return { ...state, signOut, retry };
  }, [session, sessionChecked, profile, profileError, signOut, retry]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const role = auth.status === "ready" ? auth.profile.role : null;
  const allowed = role !== null && roles.includes(role);

  useEffect(() => {
    if (auth.status === "signedOut") router.replace("/login");
    else if (role !== null && !allowed) router.replace(homeFor(role));
  }, [auth.status, role, allowed, router]);

  if (allowed) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      {auth.status === "error" ? (
        <div className="max-w-sm space-y-4 text-center">
          <p className="banner banner-error" role="alert">{auth.message}</p>
          <div className="flex justify-center gap-3">
            <button onClick={auth.retry} className="btn btn-dark">Try again</button>
            <button onClick={() => void auth.signOut()} className="btn btn-quiet">Log out</button>
          </div>
        </div>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
