import { createClient } from "@supabase/supabase-js";

export const BRAND = {
  name: "Campus Canteen",
  tagline: "Order ahead. Skip the queue.",
  description: "Order from your campus canteen and pick it up with your token.",
  campusEmailHint: "@ug.iist.ac.in or @iist.ac.in",
  supportContact: "the canteen admin",
} as const;

const CAMPUS_EMAIL = /^[a-z0-9._-]+@(ug\.)?iist\.ac\.in$/;

export const normalizeEmail = (v: string) => v.trim().toLowerCase();
export const isCampusEmail = (v: string) => CAMPUS_EMAIL.test(normalizeEmail(v));

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  is_available: boolean;
  veg_or_nonveg: "veg" | "non-veg";
  counter: string;
};

export type OrderStatus = "Pending" | "Cooking" | "Ready" | "Completed" | "Cancelled";

export type OrderLine = { item_name: string; quantity: number; unit_price: number };

export type MyOrder = {
  id: string;
  order_number: number;
  counter: string;
  status: OrderStatus;
  total_amount: number;
  cancel_reason: string | null;
  created_at: string;
  order_items: OrderLine[];
};

export type PlacedOrder = { id: string; order_number: number; counter: string; total_amount: number; status: OrderStatus };

export const CATEGORY_ORDER = ["Tea / Snacks", "Breakfast", "Lunch", "Veg Items", "Veg Curry", "Non-Veg Items", "Non-Veg Curry", "Juices & Shakes"];

export const money = (n: number) => `₹${Number.isInteger(Number(n)) ? Number(n) : Number(n).toFixed(2)}`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = url !== "" && anonKey !== "";

export const supabase = createClient(
  supabaseConfigured ? url : "http://localhost:54321",
  supabaseConfigured ? anonKey : "not-configured",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);
