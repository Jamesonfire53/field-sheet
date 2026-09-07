// src/lib/supabaseClient.js
//
// Reads the project URL and anon key from environment variables — never
// hardcode these directly in source. Vite exposes vars prefixed VITE_ to the
// browser; if you're using a different bundler (Next.js, CRA), adjust the
// prefix accordingly (NEXT_PUBLIC_, REACT_APP_, etc).

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
