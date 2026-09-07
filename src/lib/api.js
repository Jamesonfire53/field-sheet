// src/lib/api.js
//
// All data access for Field Sheet goes through these functions. None of them
// insert directly into tables — writes go through the submit_field_value and
// get_moderator_queue Postgres functions, which is where the real validation
// (rate limits, manufacturer-source restriction, etc) actually lives.

import { supabase } from "./supabaseClient";

// ---------------------------------------------------------------------------
// Browse / read
// ---------------------------------------------------------------------------

export async function fetchProducts(category) {
  const { data, error } = await supabase
    .from("products")
    .select("id, category, type, model, manufacturers(name)")
    .eq("category", category);
  if (error) throw error;
  return data.map((p) => ({ ...p, mfg: p.manufacturers?.name }));
}

// Fetches one product's full submission history and computes status for
// every field, using the same analyze_field() function the backend uses to
// validate writes — so what you see always matches what the server will
// actually allow.
export async function fetchProductDetail(productId, fieldKeys) {
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, category, type, model, manufacturers(name)")
    .eq("id", productId)
    .single();
  if (productError) throw productError;

  const { data: submissions, error: subError } = await supabase
    .from("submissions")
    .select("field_key, value, source_label, source_url, source_type, contributor_id, created_at, profiles(username)")
    .eq("product_id", productId);
  if (subError) throw subError;

  const fields = {};
  for (const key of fieldKeys) {
    const { data: analysis, error: analysisError } = await supabase.rpc("analyze_field", {
      p_product_id: productId,
      p_field_key: key,
    });
    if (analysisError) throw analysisError;
    fields[key] = {
      ...analysis?.[0],
      submissions: submissions.filter((s) => s.field_key === key),
    };
  }

  return { ...product, mfg: product.manufacturers?.name, fields };
}

// Fetches every product in a category along with ALL of their submissions,
// via the get_catalog() database function — NOT by querying tables directly.
// Direct table access is revoked (see migration-3-lock-down-reads.sql), so
// this RPC call is the only way to read this data, same principle as writes
// going exclusively through submit_field_value().
export async function fetchCatalog(category) {
  const { data, error } = await supabase.rpc("get_catalog", { p_category: category });
  if (error) throw error;
  if (!data) return [];

  const byProduct = {};
  data.forEach((row) => {
    if (!byProduct[row.product_id]) {
      byProduct[row.product_id] = { id: row.product_id, mfg: row.mfg, model: row.model, type: row.type, fields: {} };
    }
    if (row.field_key) {
      const entry = {
        value: isNaN(Number(row.value)) ? row.value : Number(row.value),
        sourceLabel: row.source_label,
        contributor: row.contributor ?? "unknown",
        sourceType: row.source_type,
      };
      (byProduct[row.product_id].fields[row.field_key] = byProduct[row.product_id].fields[row.field_key] || []).push(entry);
    }
  });
  return Object.values(byProduct);
}

// ---------------------------------------------------------------------------
// Write — the single entry point for adding a sourced fact
// ---------------------------------------------------------------------------

export async function submitFieldValue({ productId, fieldKey, value, sourceLabel, sourceUrl, sourceType = "independent" }) {
  const { data, error } = await supabase.rpc("submit_field_value", {
    p_product_id: productId,
    p_field_key: fieldKey,
    p_value: String(value),
    p_source_label: sourceLabel,
    p_source_url: sourceUrl ?? null,
    p_source_type: sourceType,
  });
  // Errors here include the server-side rejections defined in the migration:
  // daily cap reached, submitting too fast, or manufacturer source used
  // outside a dispute. Surface error.message directly to the user — it's
  // written to be human-readable.
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Moderator queue — will throw if the current user isn't tier 'moderator'
// ---------------------------------------------------------------------------

export async function fetchModeratorQueue() {
  const { data, error } = await supabase.rpc("get_moderator_queue");
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export async function signUp(email, password, username) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error) throw error;
  return data;
}

export async function fetchAcceptanceStats() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("contributor_acceptance_rate", { p_user: user.id });
  if (error) throw error;
  return data?.[0] ?? null;
}
