"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/categories";

// Email alert signup: email + optional category/keyword. No account needed.
export function SubscribeForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, category, keyword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Signup failed");
      setStatus("done");
      setMessage("You're in! Watch your inbox for the next deal drop.");
      setEmail("");
      setKeyword("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Signup failed");
    }
  };

  return (
    <form onSubmit={submit} className={compact ? "flex flex-col gap-2" : "mx-auto flex max-w-xl flex-col gap-3 sm:flex-row"}>
      <label className="sr-only" htmlFor="alert-email">Email address</label>
      <input
        id="alert-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
      />
      {!compact && (
        <>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category filter"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Keyword (optional)"
            aria-label="Keyword filter"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
          />
        </>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        className="bg-brand-600 hover:bg-brand-700 rounded-xl px-6 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {status === "sending" ? "Joining…" : "Get alerts"}
      </button>
      {message && (
        <p
          role="status"
          className={`text-xs font-medium ${status === "done" ? "text-emerald-600" : "text-red-600"} ${compact ? "" : "sm:basis-full"}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
