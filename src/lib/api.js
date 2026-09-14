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

export async function createProduct({ category, manufacturer, model, type }) {
  const { data, error } = await supabase.rpc("create_product", {
    p_category: category,
    p_manufacturer: manufacturer,
    p_model: model,
    p_type: type,
  });
  if (error) throw error;
  return data;
}

export async function fetchModeratorQueue() {
  const { data, error } = await supabase.rpc("get_moderator_queue");
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function fetchProductImages(productId) {
  const { data, error } = await supabase.rpc("get_product_images", { p_product_id: productId });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    url: supabase.storage.from("product-images").getPublicUrl(row.storage_path).data.publicUrl,
  }));
}

export async function uploadProductImage(productId, file, caption) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const ext = file.name.split(".").pop();
  const path = `${productId}/${user.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file);
  if (uploadError) throw uploadError;

  const { data, error } = await supabase.rpc("add_product_image", {
    p_product_id: productId,
    p_storage_path: path,
    p_caption: caption ?? null,
  });
  if (error) {
    // Clean up the uploaded file if the database insert (e.g. rate limit) rejected it
    await supabase.storage.from("product-images").remove([path]);
    throw error;
  }
  return data;
}

export async function reportImage(imageId, reason) {
  const { error } = await supabase.rpc("report_image", { p_image_id: imageId, p_reason: reason ?? null });
  if (error) throw error;
}

export async function fetchHiddenImagesQueue() {
  const { data, error } = await supabase.rpc("get_hidden_images_queue");
  if (error) throw error;
  return data;
}

export async function removeImage(imageId) {
  const { error } = await supabase.rpc("remove_image", { p_image_id: imageId });
  if (error) throw error;
}

export async function restoreImage(imageId) {
  const { error } = await supabase.rpc("restore_image", { p_image_id: imageId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export async function signUp(email, password, username, captchaToken) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username }, captchaToken },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password, captchaToken) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
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
  const { data, error } = await supabase.rpc("get_my_profile");
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchAcceptanceStats() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("contributor_acceptance_rate", { p_user: user.id });
  if (error) throw error;
  return data?.[0] ?? null;
}
