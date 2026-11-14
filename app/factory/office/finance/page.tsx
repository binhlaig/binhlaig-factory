"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { decodePage, decodeReceipt, receivingRequest, totalFor } from "@/lib/receiving-bulk-api";

function localDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
}

function validDate(value: string) {
  const date = new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default function OfficeFinancePage() {
  const { data, status } = useSession();
  if (status === "loading") return <p role="status" className="p-6">ဝင်ရောက်မှု စစ်ဆေးနေပါသည်…</p>;
  if (status !== "authenticated") return <p className="p-6">ငွေစာရင်းကြည့်ရန် ဝင်ရောက်ပေးပါ။</p>;

  const session = data as { shopId?: string | number; accessToken?: string; user?: {
    shopId?: string | number; id?: string | number; userId?: string | number; accountType?: string; role?: string;
  } } | null;
  let claims: Record<string, unknown> = {};
  try {
    const part = session?.accessToken?.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (part) claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))) ?? {};
  } catch { /* Explicit session fields can still identify the account. */ }
  const shop = session?.user?.shopId ?? session?.shopId ?? claims.shopId ?? claims.shop_id;
  const account = session?.user?.id || session?.user?.userId || claims.sub;
  if (!/^[1-9]\d*$/.test(String(shop)) || (typeof account !== "number" && typeof account !== "string") || !String(account).trim()) {
    return <p role="alert" className="p-6">ဆိုင်နှင့် အသုံးပြုသူ အချက်အလက် မရရှိပါ။</p>;
  }
  const scope = JSON.stringify([String(shop), session?.user?.accountType ?? claims.accountType ?? session?.user?.role ?? "", String(account)]);
  return <Finance key={scope} />;
}

type Row = { date: string; currency: string; amount: bigint | null };
type Result = { rows: Row[] } | { error: string };
const zero = BigInt(0);
const scale = BigInt(1_000_000);
const chartNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function scaled(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,24}(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"));
}

function financeRow(date: unknown, currency: unknown, amount: bigint | null): Row {
  if (typeof date !== "string" || !validDate(date) || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("မှတ်တမ်းရက်စွဲ သို့မဟုတ် ငွေကြေး အချက်အလက် မမှန်ပါ။");
  }
  return { date, currency, amount };
}

function money(amount: bigint | null, currency: string, places = 6) {
  if (amount === null) return "—";
  const divisor = BigInt(10) ** BigInt(places);
  const fraction = (amount % divisor).toString().padStart(places, "0").replace(/0+$/, "");
  return `${(amount / divisor).toLocaleString("en-US")}${fraction ? "." + fraction : ""} ${currency}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readSales(signal: AbortSignal): Promise<Row[]> {
  const rows = new Map<string, Row>();
  const size = 100;
  for (let page = 0; page < 10_000; page++) {
    const response = await fetch(`/api/factory/dispatches/sources?page=${page}&size=${size}`, {
      cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error(`အော်ဒါစာရင်း ရယူ၍မရပါ။ (HTTP ${response.status})`);
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.content) || data.page !== page || data.size !== size ||
      typeof data.totalElements !== "number" || !Number.isSafeInteger(data.totalElements) || data.totalElements < 0) {
      throw new Error("အော်ဒါစာရင်း ပုံစံ မမှန်ပါ။");
    }
    for (const row of data.content) {
      if (!isRecord(row) || row.orderStatus !== "CONFIRMED" || typeof row.orderId !== "string" ||
        !row.orderId || rows.has(row.orderId)) throw new Error("အော်ဒါမှတ်တမ်း မကိုက်ညီပါ။ ပြန်တင်ပါ။");
      rows.set(row.orderId, financeRow(row.deliveryDate, row.currency, scaled(row.total)));
    }
    if ((page + 1) * size >= data.totalElements && rows.size === data.totalElements) return [...rows.values()];
    if (!data.content.length || (page + 1) * size >= data.totalElements) break;
  }
  throw new Error("အော်ဒါစာရင်း အပြည့်မရပါ။");
}

async function readPurchases(signal: AbortSignal): Promise<Row[]> {
  const seen = new Set<number>();
  const rows: Row[] = [];
  const size = 100;
  for (let page = 0; page < 10_000; page++) {
    const result = decodePage(await receivingRequest(`?page=${page}&size=${size}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    }), decodeReceipt);
    if (result.number !== page) throw new Error("ကုန်လက်ခံစာရင်း စာမျက်နှာ မမှန်ပါ။");
    for (const receipt of result.content) {
      if (seen.has(receipt.id)) throw new Error("ကုန်လက်ခံမှတ်တမ်း ထပ်နေပါသည်။ ပြန်တင်ပါ။");
      seen.add(receipt.id);
      if (receipt.status !== "CONFIRMED") continue;
      const cost = receipt.stockKind === "BULK" && receipt.bulkPackageCount && receipt.snapshot.bulk
        ? totalFor(receipt.bulkPackageCount, receipt.snapshot.bulk.purchaseCostPerPackage)
        : null;
      rows.push(financeRow(receipt.receivedDate, receipt.currency, scaled(cost)));
    }
    if (page + 1 >= result.totalPages && seen.size === result.totalElements) return rows;
    if (!result.content.length || page + 1 >= result.totalPages) break;
  }
  throw new Error("ကုန်လက်ခံစာရင်း အပြည့်မရပါ။");
}

function summarize(result: Result | null, currency: string, month: string) {
  if (!result || "error" in result || !currency || !month) return null;
  const days = new Map<string, bigint | null>();
  let missing = 0;
  let total = zero;
  for (const row of result.rows) {
    if (row.currency !== currency || !row.date.startsWith(month + "-")) continue;
    if (row.amount === null) missing++;
    else total += row.amount;
    const prev = days.get(row.date);
    days.set(row.date, prev === null || row.amount === null ? null : (prev ?? zero) + row.amount);
  }
  return { days, total: missing ? null : total, missing };
}

function Finance() {
  const [sales, setSales] = useState<Result | null>(null);
  const [purchases, setPurchases] = useState<Result | null>(null);
  const [month, setMonth] = useState("");
  const [selection, setSelection] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => { setMonth(localDate().slice(0, 7)); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const sources = [[readSales, setSales], [readPurchases, setPurchases]] as const;
    for (const [read, setResult] of sources) {
      void read(controller.signal).then((rows) => {
        if (!controller.signal.aborted) setResult({ rows });
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setResult({ error: reason instanceof Error ? reason.message : "စာရင်း ရယူ၍မရပါ။" });
      });
    }
    return () => controller.abort();
  }, [revision]);

  const currencies = [...new Set([sales, purchases].flatMap((result) =>
    result && "rows" in result ? result.rows.map((row) => row.currency) : []))].sort();
  const currency = currencies.includes(selection) ? selection : currencies[0] ?? "";
  const income = summarize(sales, currency, month);
  const cost = summarize(purchases, currency, month);
  const incomeTotal = income?.total ?? null;
  const costTotal = cost?.total ?? null;
  // Amounts are in millionths. Multiplying by 15 and formatting at 8 decimal places applies 15%.
  const profit = incomeTotal === null || costTotal === null ? null : (incomeTotal + costTotal) * BigInt(15);
  const monthStart = /^\d{4}-\d{2}$/.test(month) ? new Date(`${month}-01T00:00:00Z`) : null;
  monthStart?.setUTCMonth(monthStart.getUTCMonth() + 1, 0);
  const plot = (value: bigint | null, divisor: number) => value === null ? null : Number(value) / divisor;
  const chart = Array.from({ length: monthStart?.getUTCDate() || 0 }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    const date = `${month}-${day}`;
    const revenue = income?.days.has(date) ? income.days.get(date) ?? null : income ? zero : null;
    const expense = cost?.days.has(date) ? cost.days.get(date) ?? null : cost ? zero : null;
    const estimate = revenue === null || expense === null ? null : (revenue + expense) * BigInt(15);
    return { day, revenue, expense, estimate, salesValue: plot(revenue, 1e6), costValue: plot(expense, 1e6), profitValue: plot(estimate, 1e8) };
  });
  const pending = !sales || !purchases;

  return (
    <main lang="my" className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold sm:text-2xl">စက်ရုံ ဝင်ငွေ၊ ထွက်ငွေနှင့် အမြတ်</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="month" aria-label="စာရင်းလ" className="h-11 w-auto" value={month} onChange={(event) => setMonth(event.target.value)} />
          {currency && <select aria-label="ငွေကြေး" className="h-11 rounded-lg border bg-background px-3" value={currency}
            onChange={(event) => setSelection(event.target.value)}>
            {currencies.map((code) => <option key={code}>{code}</option>)}
          </select>}
          <Button variant="outline" disabled={pending} onClick={() => {
            setSales(null); setPurchases(null); setRevision((n) => n + 1);
          }}>ပြန်တင်ရန်</Button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { title: "ဝင်ငွေ", value: money(incomeTotal, currency), detail: "အတည်ပြုပြီး ဆိုင် / ဖောက်သည်အော်ဒါတန်ဖိုး", note: sales && "error" in sales ? sales.error : income?.missing ? `တန်ဖိုးမရသည့် အော်ဒါ ${income.missing} ခု` : "", style: "border-l-emerald-600 text-emerald-700 dark:text-emerald-300" },
          { title: "ထွက်ငွေ", value: money(costTotal, currency), detail: "အတည်ပြုပြီး ကုန်ဝယ်ယူလက်ခံတန်ဖိုး", note: purchases && "error" in purchases ? purchases.error : cost?.missing ? `ဝယ်ဈေး သို့မဟုတ် ပမာဏ မရသည့် မှတ်တမ်း ${cost.missing} ခု` : "", style: "border-l-orange-600 text-orange-700 dark:text-orange-300" },
          { title: "ခန့်မှန်းအမြတ် (၁၅%)", value: money(profit, currency, 8), detail: "(ဝင်ငွေ + ထွက်ငွေ) × ၁၅%", note: "", style: "border-l-indigo-600 text-indigo-700 dark:text-indigo-300" },
        ].map(({ title, value, detail, note, style }) => (
          <section key={title} className={`min-w-0 rounded-xl border border-l-4 bg-card p-4 ${style}`}>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-2 break-words text-xl font-bold tabular-nums">{value}</p>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">{detail}</p>
            {note && <p role="status" className="text-xs leading-6">{note}</p>}
          </section>
        ))}
      </div>

      <section className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="font-semibold">နေ့စဉ်တန်ဖိုး{currency ? ` · ${currency}` : ""}</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">အော်ဒါကို သတ်မှတ်ပို့ရက်၊ ကုန်ဝယ်ယူမှုကို လက်ခံရက်အလိုက် စုထားပါသည်။</p>
        {chart.some((day) => day.salesValue !== null || day.costValue !== null) ? (
          <div className="mt-4 h-72 min-w-0 sm:h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="4 4" />
                <XAxis dataKey="day" minTickGap={12} tick={{ fill: "currentColor", fontSize: 11 }} />
                <YAxis width={55} domain={[0, "auto"]} tickFormatter={(value: number) => chartNumber.format(value)} />
                <Tooltip filterNull={false} content={({ active, label }) => {
                  const point = chart.find((day) => day.day === String(label));
                  if (!active || !point) return null;
                  return <div className="rounded-lg border bg-card p-3 text-sm leading-7 text-foreground shadow-md">
                    <p className="font-semibold">{month}-{point.day}</p>
                    <p>ဝင်ငွေ · {money(point.revenue, currency)}</p>
                    <p>ထွက်ငွေ · {money(point.expense, currency)}</p>
                    <p>ခန့်မှန်းအမြတ် · {money(point.estimate, currency, 8)}</p>
                  </div>;
                }} />
                <Legend />
                <Bar dataKey="salesValue" name="ဝင်ငွေ" fill="#059669" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="costValue" name="ထွက်ငွေ" fill="#ea580c" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line dataKey="profitValue" name="ခန့်မှန်းအမြတ် ၁၅%" stroke="#6366f1" strokeWidth={2.5}
                  dot={false} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p role="status" className="py-10 text-sm text-muted-foreground">
          {pending ? "စာရင်း ရယူနေပါသည်…" : "ရွေးထားသော လအတွက် ပြနိုင်သော တန်ဖိုး မရှိသေးပါ။"}
        </p>}
      </section>
    </main>
  );
}
