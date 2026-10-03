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
  const [tab, setTab] = useState<"queue" | "submit" | "jobs" | "analytics">("queue");
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
        {tab === "jobs" && <Jobs key_={key} />}
        {tab === "analytics" && <AnalyticsView key_={key} />}
      </div>
    </div>
  );
}

function Queue({ key_ }: { key_: string }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/admin/deals?status=PENDING", key_);
      setDeals(data.deals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [key_]);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    try {
      await api(`/api/admin/deals/${id}`, key_, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      setDeals((ds) => ds.filter((d) => d.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    }
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
  if (deals.length === 0)
    return <p className="rounded-xl bg-emerald-50 p-6 text-sm text-emerald-700">Queue is clear — nothing pending review. 🎉</p>;

  return (
    <div className="space-y-3">
      {deals.map((d) => (
        <DealRow key={d.id} deal={d} onAct={act} onBoost={boost} />
      ))}
    </div>
  );
}

function DealRow({
  deal: d,
  onAct,
  onBoost,
}: {
  deal: Deal;
  onAct: (id: string, action: "approve" | "reject") => void;
  onBoost: (id: string, boostFactor: number, pinnedUntil: string | null) => void;
}) {
  const [boostFactor, setBoostFactor] = useState(String(d.boostFactor ?? 1));
  const [pinnedUntil, setPinnedUntil] = useState("");
  const pinned = d.pinnedUntil && new Date(d.pinnedUntil).getTime() > Date.now();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
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
