import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, ArrowUpDown, Crosshair, Scale, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, CircleDashed, ExternalLink, Flag, Gavel, Plus } from "lucide-react";
import { fetchCatalog, submitFieldValue, signUp, signIn, signOut, getCurrentProfile, fetchAcceptanceStats } from "./lib/api";
import { supabase } from "./lib/supabaseClient";

// ---------------------------------------------------------------------------
// Palette / tokens
// ---------------------------------------------------------------------------
const C = {
  bg: "#1C1F22",
  panel: "#23272B",
  panelAlt: "#2A2F34",
  line: "#3B4046",
  lineFaint: "#2E3338",
  text: "#E9E6DE",
  textDim: "#9BA1A6",
  textFaint: "#6B7176",
  olive: "#8A9A5B",
  oliveDim: "#5E6B40",
  brass: "#C9A24B",
  brassDim: "#8A6F35",
  gray: "#6B7176",
  rust: "#B5533C",
  rustDim: "#7A3B29",
};

const headFont = { fontFamily: "'Oswald', sans-serif" };
const monoFont = { fontFamily: "'IBM Plex Mono', monospace" };
const bodyFont = { fontFamily: "'IBM Plex Sans', sans-serif" };

const STATUS_META = {
  empty: { label: "No data yet", color: "#4A4F55", Icon: CircleDashed },
  unverified: { label: "Unverified — 1 source", color: C.gray, Icon: CircleDashed },
  verified: { label: "Verified", color: C.olive, Icon: CheckCircle2 },
  disputed: { label: "Disputed", color: C.rust, Icon: AlertTriangle },
};

function sub(value, sourceLabel, contributor, sourceType = "independent") {
  return { value, sourceLabel, contributor, sourceType };
}

function analyzeField(field) {
  field = field || [];
  if (field.length === 0) {
    return { status: "empty", primary: null, entries: [], all: [] };
  }
  const groups = {};
  field.forEach((s) => {
    const k = String(s.value);
    (groups[k] = groups[k] || []).push(s);
  });
  const entries = Object.values(groups)
    .map((subs) => ({ value: subs[0].value, subs }))
    .sort((a, b) => b.subs.length - a.subs.length);

  if (entries.length === 1) {
    return { status: entries[0].subs.length >= 2 ? "verified" : "unverified", primary: entries[0], entries, all: field };
  }
  const top = entries[0];
  const restTotal = entries.slice(1).reduce((s, e) => s + e.subs.length, 0);
  const usedManufacturerTiebreak = field.some((s) => s.sourceType === "manufacturer");
  if (top.subs.length > restTotal) {
    return { status: "verified", primary: top, entries, all: field, resolvedDispute: usedManufacturerTiebreak };
  }
  const needsModerator = entries.length > 1 && entries[1].subs.length === top.subs.length;
  return { status: "disputed", primary: top, entries, all: field, needsModerator };
}

const FIELD_DEFS = {
  Firearms: [
    { key: "caliber", label: "Caliber" },
    { key: "action", label: "Action" },
    { key: "barrel", label: "Barrel (in)", numeric: true, lowerBetter: false },
    { key: "weight", label: "Weight (lb)", numeric: true, lowerBetter: true },
    { key: "capacity", label: "Capacity", numeric: true, lowerBetter: false },
    { key: "price", label: "Price", numeric: true, lowerBetter: true, isPrice: true },
  ],
  Optics: [
    { key: "mag", label: "Magnification" },
    { key: "objective", label: "Objective (mm)", numeric: true, lowerBetter: false },
    { key: "tube", label: "Tube (mm)", numeric: true, lowerBetter: false },
    { key: "weight", label: "Weight (oz)", numeric: true, lowerBetter: true },
    { key: "reticle", label: "Reticle" },
    { key: "price", label: "Price", numeric: true, lowerBetter: true, isPrice: true },
  ],
};

function uniq(arr, key) {
  return [...new Set(arr.map((x) => x[key]))].sort();
}

function StatusDot({ status, manufacturerAssisted, size = 7 }) {
  const m = STATUS_META[status];
  return (
    <span title={m.label} style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: m.color, marginRight: 6, flexShrink: 0, boxShadow: manufacturerAssisted ? `0 0 0 2px ${C.brass}` : "none" }} />
  );
}

function StatusBadge({ status, manufacturerAssisted }) {
  const m = STATUS_META[status];
  const Icon = m.Icon;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${m.color}55`, color: m.color, fontSize: "0.65rem", ...monoFont }}>
      <Icon size={10} /> {m.label}{manufacturerAssisted ? " · mfr. tiebreak" : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Moderator resolution mini-form
// ---------------------------------------------------------------------------
function ResolveForm({ entries, profile, onSubmit }) {
  const [value, setValue] = useState(entries[0]?.value ?? "");
  const [customValue, setCustomValue] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceType, setSourceType] = useState("independent");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const inputStyle = { ...bodyFont, background: C.bg, border: `1px solid ${C.line}`, color: C.text, padding: "5px 8px", fontSize: "0.78rem", outline: "none" };

  async function submit() {
    const finalValue = useCustom ? customValue : value;
    if (!finalValue || !sourceLabel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(sub(isNaN(Number(finalValue)) ? finalValue : Number(finalValue), sourceLabel.trim(), profile.username, sourceType));
      setSourceLabel(""); setCustomValue(""); setUseCustom(false);
    } catch (err) {
      setError(err.message ?? "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <div className="mt-2 p-2.5 text-xs" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.textFaint }}>
        Sign in (top right) to add a resolving source.
      </div>
    );
  }

  return (
    <div className="mt-2 p-2.5 flex flex-col gap-2" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
      <div style={{ color: C.textFaint, ...monoFont }} className="text-xs mb-0.5">Add resolving source — submitting as @{profile.username}</div>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={useCustom ? "__custom" : value} onChange={(e) => { if (e.target.value === "__custom") setUseCustom(true); else { setUseCustom(false); setValue(e.target.value); } }} style={inputStyle}>
          {entries.map((en, i) => <option key={i} value={en.value}>{en.value}</option>)}
          <option value="__custom">Different value…</option>
        </select>
        {useCustom && <input value={customValue} onChange={(e) => setCustomValue(e.target.value)} placeholder="New value" style={{ ...inputStyle, width: "110px" }} />}
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} style={inputStyle}>
          <option value="independent">Independent source</option>
          <option value="manufacturer">Manufacturer spec sheet</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Source (e.g. owner's manual, PDF)" style={{ ...inputStyle, flex: 1, minWidth: "160px" }} />
        <button onClick={submit} disabled={busy} className="fs-btn flex items-center gap-1 px-3 py-1.5 text-xs font-medium" style={{ background: C.olive, color: C.bg, ...headFont }}>
          <Plus size={12} /> {busy ? "…" : "Submit"}
        </button>
      </div>
      {error && <div className="text-xs" style={{ color: C.rust }}>{error}</div>}
      {sourceType === "manufacturer" && (
        <div className="text-xs" style={{ color: C.brass }}>Manufacturer sources are only permitted here, to resolve an existing dispute.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddSourceForm — the general contribution form, used on any field that
// isn't currently disputed. No manufacturer-source option here on purpose:
// that stays restricted to ResolveForm, for genuine disputes only.
// ---------------------------------------------------------------------------
function AddSourceForm({ fieldKey, currentValue, hasExistingValue, profile, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [useCustom, setUseCustom] = useState(!hasExistingValue);
  const [customValue, setCustomValue] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const inputStyle = { ...bodyFont, background: C.bg, border: `1px solid ${C.line}`, color: C.text, padding: "5px 8px", fontSize: "0.78rem", outline: "none" };

  async function submit() {
    const finalValue = useCustom ? customValue : currentValue;
    if (!finalValue || !sourceLabel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(sub(isNaN(Number(finalValue)) ? finalValue : Number(finalValue), sourceLabel.trim(), profile.username, "independent"));
      setSourceLabel(""); setCustomValue(""); setUseCustom(!hasExistingValue); setOpen(false);
    } catch (err) {
      setError(err.message ?? "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return <div className="text-xs mt-1.5" style={{ color: C.textFaint }}>Sign in to add a source.</div>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="fs-btn text-xs mt-1.5 flex items-center gap-1" style={{ color: C.olive }}>
        <Plus size={11} /> {hasExistingValue ? "Confirm or add a different source" : "Add a source"}
      </button>
    );
  }

  return (
    <div className="mt-1.5 p-2 flex flex-col gap-1.5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      {hasExistingValue && (
        <div className="flex flex-col gap-1 text-xs" style={{ color: C.textDim }}>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!useCustom} onChange={() => setUseCustom(false)} /> Confirms current value ({currentValue})
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={useCustom} onChange={() => setUseCustom(true)} /> Different value
          </label>
        </div>
      )}
      {useCustom && <input value={customValue} onChange={(e) => setCustomValue(e.target.value)} placeholder="Value" style={inputStyle} />}
      <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Source (e.g. owner's manual, PDF)" style={inputStyle} />
      {error && <div className="text-xs" style={{ color: C.rust }}>{error}</div>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="fs-btn px-2 py-1 text-xs font-medium" style={{ background: C.olive, color: C.bg, ...headFont }}>{busy ? "…" : "Submit"}</button>
        <button onClick={() => setOpen(false)} className="fs-btn px-2 py-1 text-xs" style={{ color: C.textFaint }}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth panel — sign in / sign up / sign out
// ---------------------------------------------------------------------------
function AuthPanel({ profile, stats, onAuthChange }) {
  const [open, setOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmNotice, setConfirmNotice] = useState(false);
  const [tosAgreed, setTosAgreed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const turnstileRef = useRef(null);
  const widgetIdRef = useRef(null);

  const inputStyle = { ...bodyFont, background: C.bg, border: `1px solid ${C.line}`, color: C.text, padding: "6px 8px", fontSize: "0.8rem", outline: "none", width: "100%" };

  // Load Cloudflare Turnstile's script once, then render the widget into
  // turnstileRef whenever the form is open. Tokens are single-use, so the
  // widget resets itself after every submit attempt (success or failure).
  useEffect(() => {
    if (!open) return;
    function renderWidget() {
      if (!turnstileRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
        callback: (token) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(null),
      });
    }
    if (window.turnstile) {
      renderWidget();
    } else if (!document.getElementById("turnstile-script")) {
      const script = document.createElement("script");
      script.id = "turnstile-script";
      script.src = "https://challenge.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [open, authMode]);

  function resetCaptcha() {
    setCaptchaToken(null);
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }

  async function handleSubmit() {
    setError(null);
    if (!captchaToken) { setError("Please complete the verification below"); return; }
    setBusy(true);
    try {
      if (authMode === "signup") {
        if (!username.trim()) throw new Error("Pick a username");
        if (!tosAgreed) throw new Error("You must agree to the Terms of Service and Privacy Policy");
        await signUp(email.trim(), password, username.trim(), captchaToken);
        setConfirmNotice(true);
      } else {
        await signIn(email.trim(), password, captchaToken);
        setOpen(false);
        onAuthChange();
      }
    } catch (err) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setBusy(false);
      resetCaptcha();
    }
  }

  async function handleSignOut() {
    await signOut();
    onAuthChange();
  }

  if (profile) {
    return (
      <div className="flex items-center gap-3">
        <span style={{ color: C.textDim, ...monoFont }} className="text-xs">
          @{profile.username} <span style={{ color: C.brass }}>· {profile.account_tier}</span>
          {stats?.total_judged > 0 && <span style={{ color: C.textFaint }}> · {stats.accepted}/{stats.total_judged} accepted</span>}
        </span>
        <button onClick={handleSignOut} className="fs-btn text-xs" style={{ color: C.textFaint, textDecoration: "underline" }}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="fs-btn px-3 py-2 text-sm" style={{ background: C.olive, color: C.bg, ...headFont }}>
        Sign in
      </button>
      {open && (
        <div className="absolute right-0 mt-2 p-3 z-10 flex flex-col gap-2" style={{ background: C.panel, border: `1px solid ${C.line}`, width: "260px" }}>
          <div className="flex gap-1 mb-1">
            <button onClick={() => { setAuthMode("signin"); setError(null); setConfirmNotice(false); }} className="fs-btn flex-1 py-1 text-xs"
              style={{ background: authMode === "signin" ? C.oliveDim : "transparent", color: authMode === "signin" ? C.text : C.textDim, border: `1px solid ${C.line}` }}>
              Sign in
            </button>
            <button onClick={() => { setAuthMode("signup"); setError(null); setConfirmNotice(false); }} className="fs-btn flex-1 py-1 text-xs"
              style={{ background: authMode === "signup" ? C.oliveDim : "transparent", color: authMode === "signup" ? C.text : C.textDim, border: `1px solid ${C.line}` }}>
              Sign up
            </button>
          </div>

          {confirmNotice ? (
            <div className="text-xs" style={{ color: C.olive }}>Check your email to confirm your account, then sign in.</div>
          ) : (
            <>
              {authMode === "signup" && (
                <>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" style={inputStyle} />
                  <label className="flex items-start gap-1.5 text-xs" style={{ color: C.textDim }}>
                    <input type="checkbox" checked={tosAgreed} onChange={(e) => setTosAgreed(e.target.checked)} style={{ marginTop: "2px" }} />
                    <span>
                      I agree to the <a href="/terms.html" target="_blank" rel="noopener" style={{ color: C.olive, textDecoration: "underline" }}>Terms of Service</a> and{" "}
                      <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: C.olive, textDecoration: "underline" }}>Privacy Policy</a>
                    </span>
                  </label>
                </>
              )}
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inputStyle} />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" style={inputStyle} />
              <div ref={turnstileRef} />
              {error && <div className="text-xs" style={{ color: C.rust }}>{error}</div>}
              <button onClick={handleSubmit} disabled={busy || (authMode === "signup" && !tosAgreed) || !captchaToken} className="fs-btn py-1.5 text-xs font-medium"
                style={{ background: C.olive, color: C.bg, ...headFont, opacity: (busy || (authMode === "signup" && !tosAgreed) || !captchaToken) ? 0.5 : 1 }}>
                {busy ? "…" : authMode === "signup" ? "Create account" : "Sign in"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Age gate — shown once per browser (stored in localStorage), not per session.
// A simple attestation gate, same pattern used by most firearms retail sites.
// ---------------------------------------------------------------------------
const AGE_GATE_KEY = "fieldsheet_age_confirmed";

function AgeGate({ onConfirm }) {
  const [declined, setDeclined] = useState(false);

  if (declined) {
    return (
      <div style={{ ...bodyFont, background: C.bg, color: C.text, minHeight: "100vh" }} className="w-full flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <Crosshair size={28} color={C.rust} strokeWidth={1.5} className="mx-auto mb-4" />
          <p style={{ ...headFont }} className="text-lg mb-2">Access restricted</p>
          <p style={{ color: C.textDim }} className="text-sm">Field Sheet is only available to visitors who are 18 years of age or older.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...bodyFont, background: C.bg, color: C.text, minHeight: "100vh" }} className="w-full flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <Crosshair size={28} color={C.olive} strokeWidth={1.5} className="mx-auto mb-4" />
        <p style={{ ...headFont }} className="text-xl mb-2">Age confirmation required</p>
        <p style={{ color: C.textDim }} className="text-sm mb-6">Field Sheet contains firearm and optic specification data. You must be 18 or older to enter.</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => { localStorage.setItem(AGE_GATE_KEY, "true"); onConfirm(); }}
            className="fs-btn px-5 py-2 text-sm font-medium"
            style={{ background: C.olive, color: C.bg, ...headFont }}
          >
            Yes, I'm 18 or older
          </button>
          <button
            onClick={() => setDeclined(true)}
            className="fs-btn px-5 py-2 text-sm"
            style={{ background: "transparent", border: `1px solid ${C.line}`, color: C.textDim, ...headFont }}
          >
            No
          </button>
        </div>
        <p style={{ color: C.textFaint }} className="text-xs mt-6">
          By continuing you also agree to our <a href="/terms.html" target="_blank" rel="noopener" style={{ color: C.olive, textDecoration: "underline" }}>Terms of Service</a> and <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: C.olive, textDecoration: "underline" }}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function FieldSheet() {
  const [ageConfirmed, setAgeConfirmed] = useState(() => localStorage.getItem(AGE_GATE_KEY) === "true");
  const [mode, setMode] = useState("catalog"); // 'catalog' | 'moderator'
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [catalog, setCatalog] = useState({ Firearms: [], Optics: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState("Firearms");
  const [query, setQuery] = useState("");
  const [mfgFilter, setMfgFilter] = useState(new Set());
  const [typeFilter, setTypeFilter] = useState(new Set());
  const [maxPrice, setMaxPrice] = useState(2500);
  const [numericFilters, setNumericFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState("price");
  const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState({ Firearms: new Set(), Optics: new Set() });
  const [expanded, setExpanded] = useState(null);

  async function loadCatalog() {
    setLoading(true);
    setLoadError(null);
    try {
      const [firearms, optics] = await Promise.all([fetchCatalog("firearm"), fetchCatalog("optic")]);
      setCatalog({ Firearms: firearms, Optics: optics });
    } catch (err) {
      setLoadError(err.message ?? "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }

  async function refreshProfile() {
    try {
      const p = await getCurrentProfile();
      setProfile(p);
      setStats(p ? await fetchAcceptanceStats() : null);
    } catch {
      setProfile(null);
      setStats(null);
    }
  }

  useEffect(() => {
    refreshProfile();
    const { data: listener } = supabase.auth.onAuthStateChange(() => { refreshProfile(); });
    return () => listener?.subscription?.unsubscribe();
  }, []);

  useEffect(() => { loadCatalog(); }, []);

  // Writes a real submission through submit_field_value(), which is where the
  // rate limits, minimum-interval check, and manufacturer-source restriction
  // are actually enforced (see supabase-migration.sql). Requires the visitor
  // to be signed in — this will throw "Not authenticated" until login is wired up.
  async function addSubmission(tabName, itemId, fieldKey, submission) {
    await submitFieldValue({
      productId: itemId,
      fieldKey,
      value: submission.value,
      sourceLabel: submission.sourceLabel,
      sourceType: submission.sourceType,
    });
    await loadCatalog(); // refresh so the newly-derived status reflects immediately
    await refreshProfile(); // this write may have just changed our own tier
  }

  const data = catalog[tab];
  const fieldDefs = FIELD_DEFS[tab];
  const mfgOptions = useMemo(() => uniq(data, "mfg"), [data]);
  const typeOptions = useMemo(() => uniq(data, "type"), [data]);

  const analyzed = useMemo(() => {
    return data.map((item) => {
      const result = {};
      fieldDefs.forEach((fd) => { result[fd.key] = analyzeField(item.fields[fd.key]); });
      return { ...item, analysis: result };
    });
  }, [data, fieldDefs]);

  // Numeric fields (besides price, which has its own always-visible slider) get
  // a dynamic "max" filter, ranged to whatever's actually in the current data.
  const numericFieldDefs = fieldDefs.filter((fd) => fd.numeric && fd.key !== "price");
  const fieldRanges = useMemo(() => {
    const ranges = {};
    numericFieldDefs.forEach((fd) => {
      const vals = analyzed.map((item) => item.analysis[fd.key]?.primary?.value).filter((v) => typeof v === "number");
      ranges[fd.key] = vals.length ? Math.ceil(Math.max(...vals)) : 100;
    });
    return ranges;
  }, [analyzed, tab]);

  useEffect(() => {
    setNumericFilters((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.entries(fieldRanges).forEach(([k, v]) => { if (next[k] === undefined) { next[k] = v; changed = true; } });
      return changed ? next : prev;
    });
  }, [fieldRanges]);

  // Flat list of every disputed field across BOTH tabs, for the moderator queue
  const disputeQueue = useMemo(() => {
    const out = [];
    ["Firearms", "Optics"].forEach((tabName) => {
      catalog[tabName].forEach((item) => {
        FIELD_DEFS[tabName].forEach((fd) => {
          const a = analyzeField(item.fields[fd.key]);
          if (a.status === "disputed") out.push({ tabName, item, fd, analysis: a });
        });
      });
    });
    return out;
  }, [catalog]);

  const filtered = useMemo(() => {
    let rows = analyzed.filter((r) => {
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || r.mfg.toLowerCase().includes(q) || r.model.toLowerCase().includes(q);
      const matchesMfg = mfgFilter.size === 0 || mfgFilter.has(r.mfg);
      const matchesType = typeFilter.size === 0 || typeFilter.has(r.type);
      const priceValue = r.analysis.price?.primary?.value;
      const matchesPrice = priceValue == null || priceValue <= maxPrice;
      const matchesNumeric = numericFieldDefs.every((fd) => {
        const v = r.analysis[fd.key]?.primary?.value;
        return v == null || numericFilters[fd.key] == null || v <= numericFilters[fd.key];
      });
      return matchesQuery && matchesMfg && matchesType && matchesPrice && matchesNumeric;
    });
    rows.sort((a, b) => {
      const av = sortKey === "mfg" || sortKey === "model" ? a[sortKey] : a.analysis[sortKey]?.primary?.value;
      const bv = sortKey === "mfg" || sortKey === "model" ? b[sortKey] : b.analysis[sortKey]?.primary?.value;
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // empty fields sort to the end regardless of direction
      if (bv == null) return -1;
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [analyzed, query, mfgFilter, typeFilter, maxPrice, numericFilters, sortKey, sortDir]);

  const selSet = selected[tab];
  const compareItems = analyzed.filter((r) => selSet.has(r.id));

  function toggleMfg(val) { const next = new Set(mfgFilter); next.has(val) ? next.delete(val) : next.add(val); setMfgFilter(next); }
  function toggleType(val) { const next = new Set(typeFilter); next.has(val) ? next.delete(val) : next.add(val); setTypeFilter(next); }
  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev[tab]);
      if (next.has(id)) next.delete(id); else if (next.size < 4) next.add(id);
      return { ...prev, [tab]: next };
    });
  }
  function onSort(key) { if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } }
  function switchTab(t) { setTab(t); setQuery(""); setMfgFilter(new Set()); setTypeFilter(new Set()); setMaxPrice(2500); setNumericFilters({}); setSortKey("price"); setSortDir("asc"); setShowFilters(false); setExpanded(null); }
  const bestFor = (fieldDef) => {
    if (!fieldDef.numeric || compareItems.length < 2) return null;
    const vals = compareItems.map((c) => c.analysis[fieldDef.key]?.primary?.value).filter((v) => typeof v === "number");
    if (vals.length < 2) return null;
    return fieldDef.lowerBetter ? Math.min(...vals) : Math.max(...vals);
  };

  if (!ageConfirmed) {
    return <AgeGate onConfirm={() => setAgeConfirmed(true)} />;
  }

  return (
    <div style={{ ...bodyFont, background: C.bg, color: C.text, minHeight: "100%" }} className="w-full">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 4px; }
        .fs-row:hover { background: ${C.panelAlt}; }
        .fs-chip { transition: background .12s ease, border-color .12s ease, color .12s ease; }
        .fs-btn { transition: opacity .12s ease; }
        .fs-btn:hover { opacity: 0.85; }
        select, input { border-radius: 0; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.line}` }} className="px-5 sm:px-8 pt-6 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Crosshair size={20} color={C.olive} strokeWidth={1.5} />
              <span style={{ ...headFont, letterSpacing: "0.02em" }} className="text-2xl font-semibold">Field Sheet</span>
            </div>
            <p style={{ color: C.textDim }} className="text-sm mt-1 max-w-lg">
              Every fact is one or more sourced submissions. Status is derived automatically — it isn't set by hand.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setMode(mode === "catalog" ? "moderator" : "catalog")} className="fs-btn flex items-center gap-2 px-3 py-2 text-sm"
              style={{ background: mode === "moderator" ? C.rustDim : C.panel, border: `1px solid ${mode === "moderator" ? C.rust : C.line}`, color: mode === "moderator" ? C.text : C.textDim }}>
              <Gavel size={14} />
              {mode === "catalog" ? `Moderator queue (${disputeQueue.length})` : "Back to catalog"}
            </button>
            <AuthPanel profile={profile} stats={stats} onAuthChange={refreshProfile} />
          </div>
        </div>

        {mode === "catalog" && (
          <>
            <div className="flex flex-wrap gap-4 mt-3 text-xs" style={{ color: C.textDim }}>
              {Object.entries(STATUS_META).map(([key, m]) => (
                <span key={key} className="inline-flex items-center gap-1.5"><StatusDot status={key} /> {m.label}</span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: C.olive, boxShadow: `0 0 0 2px ${C.brass}` }} />
                Verified via manufacturer tiebreak
              </span>
              <span className="inline-flex items-center gap-1.5"><Flag size={11} color={C.rust} /> Tied dispute — needs moderator</span>
            </div>
            <p style={{ color: C.textFaint }} className="text-xs mt-2 max-w-lg">
              Manufacturer sources can only be cited to resolve an existing dispute between two contributors — they aren't allowed as a first submission.
            </p>
            <div className="flex gap-1 mt-5">
              {["Firearms", "Optics"].map((t) => (
                <button key={t} onClick={() => switchTab(t)} className="fs-btn px-4 py-2 text-sm font-medium"
                  style={{ ...headFont, background: tab === t ? C.olive : "transparent", color: tab === t ? C.bg : C.textDim, border: `1px solid ${tab === t ? C.olive : C.line}`, letterSpacing: "0.03em" }}>
                  {t}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="px-5 sm:px-8 py-16 text-center" style={{ color: C.textFaint }}>Loading catalog…</div>
      ) : loadError ? (
        <div className="px-5 sm:px-8 py-16 text-center" style={{ color: C.rust }}>Couldn't load the catalog: {loadError}</div>
      ) : data.length === 0 && mode === "catalog" ? (
        <div className="px-5 sm:px-8 py-16 text-center" style={{ color: C.textFaint }}>
          No {tab.toLowerCase()} in the database yet. Run the seed script, or add a product.
        </div>
      ) : mode === "moderator" ? (
        <div className="px-5 sm:px-8 py-6">
          <div className="flex items-center gap-2 mb-1">
            <Gavel size={16} color={C.rust} />
            <span style={{ ...headFont, letterSpacing: "0.02em" }} className="text-lg font-medium">Moderator queue</span>
          </div>
          <p style={{ color: C.textDim }} className="text-sm mb-5">
            Every disputed field, across both categories, in one place. Add a resolving source below each — once one value has a clear majority, it drops off this queue automatically.
          </p>

          {disputeQueue.length === 0 ? (
            <div style={{ color: C.textFaint }} className="text-sm py-8 text-center border" style={{ borderColor: C.line }}>Nothing disputed right now.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {disputeQueue.map(({ tabName, item, fd, analysis }, i) => (
                <div key={i} className="p-3" style={{ background: C.panel, border: `1px solid ${C.rustDim}` }}>
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <div>
                      <span style={{ ...headFont }} className="text-sm font-medium">{item.mfg} {item.model}</span>
                      <span style={{ color: C.textFaint }} className="text-xs ml-2">{tabName} · {fd.label}</span>
                    </div>
                    <StatusBadge status="disputed" />
                    {analysis.needsModerator && (
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: C.rust }}><Flag size={11} /> Tied</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4 mb-1">
                    {analysis.entries.map((entry, j) => (
                      <div key={j} style={{ borderLeft: `2px solid ${C.rust}` }} className="pl-2">
                        <div className="text-sm" style={{ ...(fd.isPrice || fd.numeric ? monoFont : {}) }}>{fd.isPrice ? `$${entry.value.toLocaleString()}` : entry.value}</div>
                        {entry.subs.map((s, k) => (
                          <div key={k} className="text-xs mt-0.5" style={{ color: C.textFaint }}>
                            <span className="inline-flex items-center gap-1"><ExternalLink size={9} />{s.sourceLabel}</span> · @{s.contributor}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <ResolveForm entries={analysis.entries} profile={profile} onSubmit={(submission) => addSubmission(tabName, item.id, fd.key, submission)} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Filter bar */}
          <div className="px-5 sm:px-8 py-4 flex flex-col gap-3" style={{ borderBottom: `1px solid ${C.line}` }}>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: C.panel, border: `1px solid ${C.line}`, minWidth: "220px" }}>
                <Search size={15} color={C.textFaint} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab.toLowerCase()}...`}
                  style={{ ...bodyFont, background: "transparent", color: C.text, outline: "none", width: "100%", fontSize: "0.85rem" }} />
              </div>
              <button onClick={() => setShowFilters(!showFilters)} className="fs-btn flex items-center gap-1 px-3 py-2 text-sm"
                style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.textDim }}>
                Manufacturer / type
                <ChevronDown size={14} style={{ transform: showFilters ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
              </button>
              <div className="flex items-center gap-2 text-sm" style={{ color: C.textDim }}>
                <span style={monoFont}>Max ${maxPrice.toLocaleString()}</span>
                <input type="range" min="150" max="2500" step="50" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} style={{ width: "140px" }} />
              </div>
              <span style={{ color: C.textFaint, ...monoFont }} className="text-xs ml-auto">{filtered.length} of {data.length}</span>
            </div>
            {showFilters && (
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-wrap gap-1.5">
                  {mfgOptions.map((m) => (
                    <button key={m} onClick={() => toggleMfg(m)} className="fs-chip px-2.5 py-1 text-xs"
                      style={{ background: mfgFilter.has(m) ? C.oliveDim : "transparent", border: `1px solid ${mfgFilter.has(m) ? C.olive : C.line}`, color: mfgFilter.has(m) ? C.text : C.textDim }}>
                      {m}
                    </button>
                  ))}
                </div>
                <div style={{ width: 1, background: C.line }} />
                <div className="flex flex-wrap gap-1.5">
                  {typeOptions.map((t) => (
                    <button key={t} onClick={() => toggleType(t)} className="fs-chip px-2.5 py-1 text-xs"
                      style={{ background: typeFilter.has(t) ? C.brassDim : "transparent", border: `1px solid ${typeFilter.has(t) ? C.brass : C.line}`, color: typeFilter.has(t) ? C.text : C.textDim }}>
                      {t}
                    </button>
                  ))}
                </div>
                {numericFieldDefs.length > 0 && <div style={{ width: 1, background: C.line }} />}
                <div className="flex flex-wrap gap-4">
                  {numericFieldDefs.map((fd) => (
                    <div key={fd.key} className="flex items-center gap-2 text-xs" style={{ color: C.textDim }}>
                      <span style={monoFont}>Max {fd.label}: {numericFilters[fd.key] ?? fieldRanges[fd.key]}</span>
                      <input type="range" min={0} max={fieldRanges[fd.key] || 100} step={fd.key === "weight" ? 0.1 : 1}
                        value={numericFilters[fd.key] ?? fieldRanges[fd.key]}
                        onChange={(e) => setNumericFilters((prev) => ({ ...prev, [fd.key]: Number(e.target.value) }))}
                        style={{ width: "110px" }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Compare tray */}
          {compareItems.length > 0 && (
            <div className="px-5 sm:px-8 py-5" style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Scale size={15} color={C.brass} />
                  <span style={{ ...headFont, letterSpacing: "0.02em" }} className="text-sm font-medium">
                    Comparing {compareItems.length} {compareItems.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <button onClick={() => setSelected((p) => ({ ...p, [tab]: new Set() }))} className="fs-btn text-xs flex items-center gap-1" style={{ color: C.textDim }}>
                  <X size={12} /> Clear
                </button>
              </div>
              <div className="overflow-x-auto">
                <table style={{ borderCollapse: "collapse" }} className="w-full text-sm">
                  <thead>
                    <tr>
                      <td></td>
                      {compareItems.map((item) => (
                        <td key={item.id} className="pb-3 pr-6" style={{ ...headFont, fontWeight: 600 }}>{item.mfg} {item.model}</td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fieldDefs.map((fd) => {
                      const best = bestFor(fd);
                      return (
                        <tr key={fd.key} style={{ borderBottom: `1px solid ${C.lineFaint}` }}>
                          <td style={{ color: C.textFaint, ...monoFont }} className="py-2.5 pr-4 text-xs whitespace-nowrap align-top">{fd.label}</td>
                          {compareItems.map((item) => {
                            const a = item.analysis[fd.key];
                            const isBest = fd.numeric && best !== null && a.primary?.value === best;
                            return (
                              <td key={item.id} className="py-2.5 pr-6 align-top" style={{ minWidth: "170px" }}>
                                <div className="flex items-center">
                                  <StatusDot status={a.status} manufacturerAssisted={a.resolvedDispute} />
                                  <span style={{ color: isBest ? C.brass : a.status === "empty" ? C.textFaint : C.text, fontWeight: isBest ? 600 : 400, ...(fd.isPrice || fd.numeric ? monoFont : {}) }}>
                                    {a.status === "empty" ? "—" : fd.isPrice ? `$${a.primary.value.toLocaleString()}` : a.primary.value}
                                  </span>
                                  {isBest && <span style={{ color: C.brass }} className="ml-1">●</span>}
                                </div>
                                <div className="mt-0.5 text-xs" style={{ color: a.status === "disputed" ? C.rust : C.textFaint }}>
                                  {a.status === "empty" ? "No data" : a.status === "disputed" ? `Disputed — ${a.entries.length} competing values` : `${a.all.length} source${a.all.length > 1 ? "s" : ""}`}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results table */}
          <div className="px-5 sm:px-8 py-5 overflow-x-auto">
            <table style={{ borderCollapse: "collapse" }} className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                  <th className="text-left pb-2 pr-2" style={{ width: "24px" }}></th>
                  <th className="text-left pb-2 pr-2" style={{ width: "36px" }}></th>
                  <th onClick={() => onSort("mfg")} className="text-left pb-2 pr-6 cursor-pointer select-none whitespace-nowrap"
                    style={{ ...monoFont, color: sortKey === "mfg" ? C.brass : C.textDim, fontSize: "0.72rem", letterSpacing: "0.04em" }}>
                    <span className="inline-flex items-center gap-1">Manufacturer{sortKey === "mfg" && <ArrowUpDown size={11} style={{ transform: sortDir === "desc" ? "scaleY(-1)" : "none" }} />}</span>
                  </th>
                  <th onClick={() => onSort("model")} className="text-left pb-2 pr-6 cursor-pointer select-none whitespace-nowrap"
                    style={{ ...monoFont, color: sortKey === "model" ? C.brass : C.textDim, fontSize: "0.72rem", letterSpacing: "0.04em" }}>
                    <span className="inline-flex items-center gap-1">Model{sortKey === "model" && <ArrowUpDown size={11} style={{ transform: sortDir === "desc" ? "scaleY(-1)" : "none" }} />}</span>
                  </th>
                  {fieldDefs.map((fd) => (
                    <th key={fd.key} onClick={() => onSort(fd.key)} className="text-left pb-2 pr-6 cursor-pointer select-none whitespace-nowrap"
                      style={{ ...monoFont, color: sortKey === fd.key ? C.brass : C.textDim, fontSize: "0.72rem", letterSpacing: "0.04em" }}>
                      <span className="inline-flex items-center gap-1">
                        {fd.label}
                        {sortKey === fd.key && <ArrowUpDown size={11} style={{ transform: sortDir === "desc" ? "scaleY(-1)" : "none" }} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const isSel = selSet.has(item.id);
                  const isOpen = expanded === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      <tr className="fs-row cursor-pointer" style={{ borderBottom: isOpen ? "none" : `1px solid ${C.lineFaint}`, background: isSel ? C.panelAlt : "transparent" }}>
                        <td className="py-2.5 pr-2" onClick={() => setExpanded(isOpen ? null : item.id)}>
                          {isOpen ? <ChevronDown size={14} color={C.textDim} /> : <ChevronRight size={14} color={C.textDim} />}
                        </td>
                        <td className="py-2.5 pr-2" onClick={() => toggleSelect(item.id)}>
                          <div style={{ width: 16, height: 16, border: `1px solid ${isSel ? C.brass : C.line}`, background: isSel ? C.brass : "transparent" }} />
                        </td>
                        <td className="py-2.5 pr-6 whitespace-nowrap" onClick={() => setExpanded(isOpen ? null : item.id)} style={{ color: C.text, fontWeight: 500 }}>
                          {item.mfg}
                        </td>
                        <td className="py-2.5 pr-6 whitespace-nowrap" onClick={() => setExpanded(isOpen ? null : item.id)} style={{ color: C.text }}>
                          {item.model}
                        </td>
                        {fieldDefs.map((fd) => {
                          const a = item.analysis[fd.key];
                          return (
                            <td key={fd.key} className="py-2.5 pr-6 whitespace-nowrap" onClick={() => setExpanded(isOpen ? null : item.id)}
                              style={{ ...(fd.isPrice || fd.numeric ? monoFont : {}), color: a.status === "disputed" ? C.rust : C.textDim }}>
                              <span className="inline-flex items-center">
                                <StatusDot status={a.status} manufacturerAssisted={a.resolvedDispute} size={6} />
                                {a.status === "disputed" ? `${a.entries.length} values` : a.status === "empty" ? "—" : (fd.isPrice ? `$${a.primary.value.toLocaleString()}` : a.primary.value)}
                                {a.needsModerator && <Flag size={11} color={C.rust} className="ml-1" />}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                      {isOpen && (
                        <tr style={{ borderBottom: `1px solid ${C.lineFaint}` }}>
                          <td colSpan={fieldDefs.length + 4} className="pb-4 pt-1">
                            <div className="px-3 py-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                              <div style={{ ...headFont }} className="text-sm font-medium mb-2">{item.mfg} {item.model} — field sources</div>
                              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                                {fieldDefs.map((fd) => {
                                  const a = item.analysis[fd.key];
                                  return (
                                    <div key={fd.key} className="p-2" style={{ background: C.bg, border: `1px solid ${a.status === "disputed" ? C.rustDim : C.lineFaint}` }}>
                                      <div className="flex items-center justify-between mb-1.5">
                                        <span style={{ color: C.textFaint, ...monoFont }} className="text-xs">{fd.label}</span>
                                        <StatusBadge status={a.status} manufacturerAssisted={a.resolvedDispute} />
                                      </div>
                                      {a.status === "empty" ? (
                                        <div className="flex flex-col gap-1">
                                          <div className="text-xs" style={{ color: C.textFaint }}>No submissions yet — be the first to add one.</div>
                                          <AddSourceForm fieldKey={fd.key} currentValue={null} hasExistingValue={false} profile={profile}
                                            onSubmit={(submission) => addSubmission(tab, item.id, fd.key, submission)} />
                                        </div>
                                      ) : a.status === "disputed" ? (
                                        <div className="flex flex-col gap-2">
                                          {a.entries.map((entry, i) => (
                                            <div key={i} style={{ borderLeft: `2px solid ${C.rust}` }} className="pl-2">
                                              <div className="text-sm" style={{ ...(fd.isPrice || fd.numeric ? monoFont : {}) }}>
                                                {fd.isPrice ? `$${entry.value.toLocaleString()}` : entry.value}
                                              </div>
                                              {entry.subs.map((s, j) => (
                                                <div key={j} className="text-xs mt-0.5" style={{ color: C.textFaint }}>
                                                  <span className="inline-flex items-center gap-1"><ExternalLink size={9} />{s.sourceLabel}</span> · @{s.contributor}
                                                </div>
                                              ))}
                                            </div>
                                          ))}
                                          {a.needsModerator && (
                                            <div className="flex items-center gap-1.5 mt-1 px-1.5 py-1" style={{ background: "rgba(181,83,60,0.1)", border: `1px solid ${C.rustDim}` }}>
                                              <Flag size={11} color={C.rust} />
                                              <span className="text-xs" style={{ color: C.rust }}>Tied — escalated for moderator review</span>
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <>
                                          <div className="text-sm mb-1" style={{ ...(fd.isPrice || fd.numeric ? monoFont : {}) }}>
                                            {fd.isPrice ? `$${a.primary.value.toLocaleString()}` : a.primary.value}
                                          </div>
                                          <div className="flex flex-col gap-0.5">
                                            {a.all.map((s, i) => (
                                              <div key={i} className="text-xs flex items-center gap-1" style={{ color: s.sourceType === "manufacturer" ? C.brass : C.textFaint }}>
                                                <ExternalLink size={9} />
                                                <span>{s.sourceLabel}</span><span>· @{s.contributor}</span>
                                              </div>
                                            ))}
                                          </div>
                                          <AddSourceForm fieldKey={fd.key} currentValue={a.primary.value} hasExistingValue={true} profile={profile}
                                            onSubmit={(submission) => addSubmission(tab, item.id, fd.key, submission)} />
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <p style={{ color: C.textFaint }} className="text-xs mt-3">Click the arrow to see every submission behind a field, including disputed values. Click a row to add it to comparison (up to 4).</p>
          </div>
        </>
      )}
      <div className="px-5 sm:px-8 py-4 flex gap-4 text-xs" style={{ borderTop: `1px solid ${C.lineFaint}`, color: C.textFaint }}>
        <a href="/terms.html" target="_blank" rel="noopener" style={{ color: C.textFaint }}>Terms of Service</a>
        <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: C.textFaint }}>Privacy Policy</a>
      </div>
    </div>
  );
}
