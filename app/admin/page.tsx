"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/categories";

const KEY_STORAGE = "dealriz-admin-key";

type Deal = {
  id: string;
  title: string;
  salePrice: number;
  originalPrice: number | null;
  discountPct: number | null;
  category: string;
  status: string;
  aiScore: number | null;
  clicks: number;
  createdAt: string;
  store: { name: string };
  rankScore?: number;
  boostFactor: number;
  pinnedUntil: string | null;
  isPriceDrop: boolean;
};

type Analytics = {
  liveDeals: number;
  pendingDeals: number;
  clicks7d: number;
  clicks30d: number;
  subscribers: number;
  topDeals: { id: string; slug: string; title: string; clicks: number; views: number; aiScore: number | null }[];
  byCategory: { category: string; count: number }[];
  recentJobs: { id: string; network: string; status: string; dealsFound: number; dealsAdded: number; dealsUpdated: number; startedAt: string; error: string | null }[];
};

function useAdminKey() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    setKey(sessionStorage.getItem(KEY_STORAGE));
  }, []);
  const save = (k: string) => {
    sessionStorage.setItem(KEY_STORAGE, k);
    setKey(k);
  };
  const clear = () => {
    sessionStorage.removeItem(KEY_STORAGE);
    setKey(null);
  };
  return { key, save, clear };
}

async function api(path: string, key: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), "X-Admin-Key": key, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export default function AdminPage() {
  const { key, save, clear } = useAdminKey();
  const [tab, setTab] = useState<"queue" | "submit" | "import" | "jobs" | "analytics">("queue");
  const [input, setInput] = useState("");

  if (key === null) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <h1 className="text-2xl font-black">Admin</h1>
        <p className="mt-2 text-sm text-slate-500">
          Enter your <code>ADMIN_API_KEY</code> to continue. It stays in this browser tab only.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Admin API key"
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm"
            onKeyDown={(e) => e.key === "Enter" && input && save(input)}
          />
          <button
            onClick={() => input && save(input)}
            className="bg-brand-600 hover:bg-brand-700 rounded-xl px-5 py-2 text-sm font-bold text-white"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    ["queue", "Moderation queue"],
    ["submit", "Submit deal"],
    ["import", "Bulk import"],
    ["jobs", "Jobs"],
    ["analytics", "Analytics"],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Admin dashboard</h1>
        <button onClick={clear} className="text-xs font-semibold text-slate-500 hover:underline">
          Lock (forget key)
        </button>
      </div>

      <div className="mt-4 flex gap-2 border-b border-slate-200">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === id
                ? "border-b-2 border-brand-600 text-brand-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "queue" && <Queue key_={key} />}
        {tab === "submit" && <SubmitForm key_={key} />}
        {tab === "import" && <BulkImport key_={key} />}
        {tab === "jobs" && <Jobs key_={key} />}
        {tab === "analytics" && <AnalyticsView key_={key} />}
      </div>
    </div>
  );
}

const QUEUE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
type QueueStatus = (typeof QUEUE_STATUSES)[number];

function Queue({ key_ }: { key_: string }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [status, setStatus] = useState<QueueStatus>("PENDING");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/admin/deals?status=${status}`, key_);
      setDeals(data.deals);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [key_, status]);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    try {
      await api(`/api/admin/deals/${id}`, key_, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      setDeals((ds) => ds.filter((d) => d.id !== id));
      setSelected((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    }
  };

  const del = async (id: string) => {
    if (!window.confirm("Delete this deal permanently? This cannot be undone.")) return;
    try {
      await api(`/api/admin/deals/${id}`, key_, { method: "DELETE" });
      setDeals((ds) => ds.filter((d) => d.id !== id));
      setSelected((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const bulkAct = async (action: "approve" | "reject") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const verb = action === "approve" ? "Approve" : "Reject";
    if (!window.confirm(`${verb} ${ids.length} selected deal${ids.length === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    try {
      await api("/api/admin/deals/bulk", key_, {
        method: "POST",
        body: JSON.stringify({ ids, action }),
      });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleAll = () => {
    setSelected((s) =>
      s.size === deals.length ? new Set() : new Set(deals.map((d) => d.id))
    );
  };

  const toggleOne = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const boost = async (id: string, boostFactor: number, pinnedUntil: string | null) => {
    try {
      await api(`/api/admin/deals/${id}`, key_, {
        method: "PATCH",
        body: JSON.stringify({ action: "boost", boostFactor, pinnedUntil }),
      });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Boost failed");
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Loading queue…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div>
      {/* Bulk toolbar: status filter + select-all + bulk actions */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={deals.length > 0 && selected.size === deals.length}
            onChange={toggleAll}
          />
          Select all ({deals.length})
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as QueueStatus)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700"
          aria-label="Deal status filter"
        >
          {QUEUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <button
            disabled={selected.size === 0 || busy}
            onClick={() => bulkAct("approve")}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Working…" : `Approve selected (${selected.size})`}
          </button>
          <button
            disabled={selected.size === 0 || busy}
            onClick={() => bulkAct("reject")}
            className="rounded-lg bg-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
          >
            {busy ? "Working…" : `Reject selected (${selected.size})`}
          </button>
        </div>
      </div>

      {deals.length === 0 ? (
        <p className="rounded-xl bg-emerald-50 p-6 text-sm text-emerald-700">
          {status === "PENDING"
            ? "Queue is clear — nothing pending review. 🎉"
            : `No ${status.charAt(0) + status.slice(1).toLowerCase()} deals.`}
        </p>
      ) : (
        <div className="space-y-3">
          {deals.map((d) => (
            <DealRow
              key={d.id}
              deal={d}
              onAct={act}
              onBoost={boost}
              onDelete={del}
              checked={selected.has(d.id)}
              onToggle={() => toggleOne(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DealRow({
  deal: d,
  onAct,
  onBoost,
  onDelete,
  checked,
  onToggle,
}: {
  deal: Deal;
  onAct: (id: string, action: "approve" | "reject") => void;
  onBoost: (id: string, boostFactor: number, pinnedUntil: string | null) => void;
  onDelete: (id: string) => void;
  checked: boolean;
  onToggle: () => void;
}) {
  const [boostFactor, setBoostFactor] = useState(String(d.boostFactor ?? 1));
  const [pinnedUntil, setPinnedUntil] = useState("");
  const pinned = d.pinnedUntil && new Date(d.pinnedUntil).getTime() > Date.now();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${d.title}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">
            {d.isPriceDrop && (
              <span className="mr-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-extrabold text-red-700">
                PRICE DROP
              </span>
            )}
            {pinned && (
              <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-700">
                PINNED
              </span>
            )}
            {d.title}
          </p>
          <p className="text-xs text-slate-500">
            {d.store.name} · {d.category} · ${d.salePrice.toFixed(2)}
            {d.discountPct ? ` (−${d.discountPct}%)` : ""} · Score {d.aiScore ?? "—"}
            {d.rankScore != null ? ` · Rank ${d.rankScore.toFixed(1)}` : ""} · {d.clicks} clicks
            {d.boostFactor !== 1 ? ` · ×${d.boostFactor} boost` : ""}
          </p>
        </div>
        <button
          onClick={() => onAct(d.id, "approve")}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
        >
          Approve
        </button>
        <button
          onClick={() => onAct(d.id, "reject")}
          className="rounded-lg bg-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-300"
        >
          Reject
        </button>
        <button
          onClick={() => onDelete(d.id)}
          className="rounded-lg bg-red-100 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-200"
          title="Permanently delete this deal"
        >
          Delete
        </button>
      </div>
      {/* Ranking override: boost multiplier + optional pin */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <label className="text-[11px] font-semibold text-slate-500">
          Boost ×
          <input
            type="number"
            min={1}
            max={2}
            step={0.1}
            value={boostFactor}
            onChange={(e) => setBoostFactor(e.target.value)}
            className="ml-1 w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Pin until
          <input
            type="datetime-local"
            value={pinnedUntil}
            onChange={(e) => setPinnedUntil(e.target.value)}
            className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
        </label>
        <button
          onClick={() => {
            const bf = Math.min(2, Math.max(1, parseFloat(boostFactor) || 1));
            onBoost(d.id, bf, pinnedUntil ? new Date(pinnedUntil).toISOString() : null);
          }}
          className="rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-navy-700"
          title="Multiply rankScore by the boost; a pin date sorts this deal above all unpinned deals until it lapses. Leave pin empty to unpin."
        >
          Apply boost
        </button>
        {(d.boostFactor !== 1 || pinned) && (
          <button
            onClick={() => onBoost(d.id, 1, null)}
            className="text-[11px] font-semibold text-slate-500 hover:underline"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function SubmitForm({ key_ }: { key_: string }) {
  const [form, setForm] = useState({
    title: "", description: "", salePrice: "", originalPrice: "",
    affiliateUrl: "", storeName: "", category: "Electronics",
    couponCode: "", imageUrl: "", badge: "", expiresAt: "",
  });
  const [status, setStatus] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Submitting…");
    try {
      await api("/api/admin/deals", key_, { method: "POST", body: JSON.stringify(form) });
      setStatus("✓ Deal added to the moderation queue.");
      setForm({ title: "", description: "", salePrice: "", originalPrice: "", affiliateUrl: "", storeName: "", category: "Electronics", couponCode: "", imageUrl: "", badge: "", expiresAt: "" });
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : "failed"}`);
    }
  };

  const field = "rounded-xl border border-slate-300 px-3 py-2 text-sm w-full focus:border-brand-500 focus:outline-none";
  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-3">
      <input className={field} placeholder="Title *" required value={form.title} onChange={set("title")} />
      <textarea className={field} placeholder="Description" rows={3} value={form.description} onChange={set("description")} />
      <div className="grid grid-cols-2 gap-3">
        <input className={field} placeholder="Sale price * (e.g. 49.99)" required value={form.salePrice} onChange={set("salePrice")} />
        <input className={field} placeholder="Original price (e.g. 99.99)" value={form.originalPrice} onChange={set("originalPrice")} />
      </div>
      <input className={field} placeholder="Affiliate URL *" required value={form.affiliateUrl} onChange={set("affiliateUrl")} />
      <div className="grid grid-cols-2 gap-3">
        <input className={field} placeholder="Store name *" required value={form.storeName} onChange={set("storeName")} />
        <select className={field} value={form.category} onChange={set("category")}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input className={field} placeholder="Coupon code (optional)" value={form.couponCode} onChange={set("couponCode")} />
        <input className={field} placeholder="Badge: HOT / LIMITED (optional)" value={form.badge} onChange={set("badge")} />
      </div>
      <input className={field} placeholder="Image URL (optional)" value={form.imageUrl} onChange={set("imageUrl")} />
      <label className="text-xs font-semibold text-slate-500">
        Expires at (optional)
        <input type="datetime-local" className={`${field} mt-1`} value={form.expiresAt} onChange={set("expiresAt")} />
      </label>
      <button type="submit" className="bg-brand-600 hover:bg-brand-700 rounded-xl px-6 py-2.5 text-sm font-bold text-white">
        Submit for review
      </button>
      {status && <p className="text-sm text-slate-600">{status}</p>}
    </form>
  );
}

type ImportPreview = {
  totalRows: number;
  validCount: number;
  errorCount: number;
  preview: { title: string; salePrice: number; originalPrice?: number | null; storeName: string; category: string; affiliateUrl: string }[];
  errors: { rowNumber: number; errors: string[] }[];
};

type ImportResult = {
  totalRows: number;
  imported: number;
  skippedDuplicates: number;
  rowErrors: number;
  errors: { rowNumber: number; errors: string[] }[];
};

function BulkImport({ key_ }: { key_: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const post = async (dryRun: boolean) => {
    if (!file && !sheetUrl.trim()) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      if (sheetUrl.trim()) form.append("sheetUrl", sheetUrl.trim());
      else if (file) form.append("file", file);
      form.append("dryRun", dryRun ? "1" : "0");
      form.append("autoApprove", autoApprove ? "1" : "0");
      // NOTE: no Content-Type header — the browser sets the multipart boundary.
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "X-Admin-Key": key_ },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
      if (dryRun) setPreview(data);
      else {
        setResult(data);
        setPreview(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setSheetUrl("");
    setPreview(null);
    setResult(null);
    setError("");
  };

  const hasInput = !!file || !!sheetUrl.trim();

  return (
    <div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
              setError("");
            }}
            className="text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-slate-700"
          />
          <input
            type="url"
            value={sheetUrl}
            onChange={(e) => {
              setSheetUrl(e.target.value);
              setPreview(null);
              setResult(null);
              setError("");
            }}
            placeholder="…or paste a Google Sheets link"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400"
          />
          <a
            href={`/api/admin/import/template?key=${encodeURIComponent(key_)}`}
            className="text-sm font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800"
          >
            Download template
          </a>
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="h-4 w-4"
            />
            Publish immediately (skip moderation queue)
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Excel (.xlsx/.xls), CSV/TSV/TXT, or a shared Google Sheets link ("Anyone with the link can
          view") — max 5MB and 2,000 rows. Required columns: title, salePrice,
          affiliateUrl, storeName. Optional: originalPrice, category, imageUrl, description,
          couponCode, badge, expiresAt, externalId, gtin.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            disabled={!hasInput || busy}
            onClick={() => post(true)}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "Working…" : "Preview"}
          </button>
          {preview && (
            <button
              disabled={busy}
              onClick={() => post(false)}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? "Importing…" : `Confirm import (${preview.validCount} deals)`}
            </button>
          )}
          {(preview || result || error) && (
            <button onClick={reset} className="px-3 py-2 text-sm font-semibold text-slate-500 hover:underline">
              Start over
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}

      {preview && (
        <div className="mt-4">
          <div className="flex gap-4 text-sm">
            <span><b>{preview.totalRows}</b> rows</span>
            <span className="text-emerald-700"><b>{preview.validCount}</b> valid</span>
            <span className="text-red-600"><b>{preview.errorCount}</b> with errors</span>
          </div>
          {preview.preview.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-3">Title</th>
                    <th className="p-3">Price</th>
                    <th className="p-3">Was</th>
                    <th className="p-3">Store</th>
                    <th className="p-3">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="max-w-xs truncate p-3">{r.title}</td>
                      <td className="p-3 font-bold">${r.salePrice.toFixed(2)}</td>
                      <td className="p-3 text-slate-500">{r.originalPrice ? `$${Number(r.originalPrice).toFixed(2)}` : "—"}</td>
                      <td className="p-3">{r.storeName}</td>
                      <td className="p-3">{r.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="p-3 text-xs text-slate-500">Showing first {preview.preview.length} of {preview.validCount} valid rows.</p>
            </div>
          )}
          {preview.errors.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-700">Row errors (fix and re-upload)</p>
              <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs text-red-700">
                {preview.errors.map((e, i) => (
                  <li key={i}>Row {e.rowNumber}: {e.errors.join("; ")}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-bold">Import complete</p>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-emerald-700"><b>{result.imported}</b> imported</span>
            <span className="text-amber-700"><b>{result.skippedDuplicates}</b> duplicates skipped</span>
            <span className="text-red-600"><b>{result.rowErrors}</b> rows with errors</span>
          </div>
          {!autoApprove && result.imported > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Imported deals are <b>PENDING</b> — approve them in the Moderation queue tab.
            </p>
          )}
          {autoApprove && result.imported > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Deals were published and scored immediately — they should appear on the homepage now.
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-xs text-red-700">
              {result.errors.map((e, i) => (
                <li key={i}>{e.rowNumber > 0 ? `Row ${e.rowNumber}: ` : ""}{e.errors.join("; ")}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Jobs({ key_ }: { key_: string }) {
  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");

  const run = async (job: string) => {
    setRunning(job);
    setLog(`Running ${job}…`);
    try {
      const data = await api("/api/jobs/trigger", key_, {
        method: "POST",
        body: JSON.stringify({ job }),
      });
      setLog(JSON.stringify(data.result, null, 2));
    } catch (e) {
      setLog(`Error: ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setRunning(null);
    }
  };

  const jobs = [
    ["ingest", "Ingest affiliate feeds"],
    ["score", "Recompute DealScores"],
    ["expire", "Expire old deals"],
    ["digest", "Send weekly digest now"],
    ["scheduled", "Run smart scheduler (cron)"],
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {jobs.map(([id, label]) => (
          <button
            key={id}
            disabled={running !== null}
            onClick={() => run(id)}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {running === id ? "Running…" : label}
          </button>
        ))}
      </div>
      {log && (
        <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-300">
          {log}
        </pre>
      )}
      <p className="mt-3 text-xs text-slate-500">
        On a schedule? GitHub Actions calls <code>/api/jobs/trigger</code> with
        <code> job: "scheduled"</code> every 6 hours — see <code>.github/workflows/cron.yml</code>.
      </p>
    </div>
  );
}

function AnalyticsView({ key_ }: { key_: string }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/admin/analytics", key_).then(setData).catch((e) =>
      setError(e instanceof Error ? e.message : "Failed")
    );
  }, [key_]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  const cards = [
    ["Live deals", data.liveDeals],
    ["Pending review", data.pendingDeals],
    ["Clicks (7d)", data.clicks7d],
    ["Clicks (30d)", data.clicks30d],
    ["Email subscribers", data.subscribers],
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map(([label, v]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-2xl font-black">{v}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <h3 className="mb-2 mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">Top deals by clicks</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="p-3">Deal</th><th className="p-3">Score</th><th className="p-3">Clicks</th><th className="p-3">Views</th></tr>
          </thead>
          <tbody>
            {data.topDeals.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="max-w-xs truncate p-3">
                  <a href={`/deals/${d.slug}`} target="_blank" rel="noreferrer" className="hover:underline">{d.title}</a>
                </td>
                <td className="p-3 font-bold">{d.aiScore ?? "—"}</td>
                <td className="p-3">{d.clicks}</td>
                <td className="p-3">{d.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">Recent job runs</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="p-3">Network</th><th className="p-3">Status</th><th className="p-3">Found</th><th className="p-3">Added</th><th className="p-3">Updated</th><th className="p-3">Started</th></tr>
          </thead>
          <tbody>
            {data.recentJobs.map((j) => (
              <tr key={j.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-xs">{j.network}</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${j.status === "ok" ? "bg-emerald-100 text-emerald-700" : j.status === "running" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                    {j.status}
                  </span>
                </td>
                <td className="p-3">{j.dealsFound}</td>
                <td className="p-3">{j.dealsAdded}</td>
                <td className="p-3">{j.dealsUpdated}</td>
                <td className="p-3 text-xs text-slate-500">{new Date(j.startedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
