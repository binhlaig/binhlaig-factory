"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { historyPage } from "@/lib/production/factory-production-api";

type Totals = { values: Map<string, bigint>; count: number; missing: number };
type Report = { totals: Totals } | { error: string };
const scale = BigInt(1_000_000);
const zero = BigInt(0);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("API data ပုံစံ မမှန်ပါ။");
  return value as Record<string, unknown>;
}

function decimal(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^\d{1,24}(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"));
}

function format(value: bigint, currency: string) {
  const divisor = scale * scale;
  const fraction = (value % divisor).toString().padStart(12, "0").replace(/0+$/, "");
  return `${(value / divisor).toLocaleString("en-US")}${fraction ? "." + fraction : ""} ${currency}`;
}

function aggregate<T>(rows: T[], valueOf: (row: T) => [unknown, unknown, unknown]): Totals {
  const values = new Map<string, bigint>();
  let missing = 0;
  for (const row of rows) {
    const [currency, rawQuantity, rawPrice] = valueOf(row);
    const quantity = decimal(rawQuantity);
    const price = decimal(rawPrice);
    if (quantity === zero) continue;
    if (quantity === null || price === null || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
      missing++;
      continue;
    }
    values.set(currency, (values.get(currency) ?? zero) + quantity * price);
  }
  return { values, count: rows.length, missing };
}

async function readPages(path: string, keyOf: (row: Record<string, unknown>) => string, signal: AbortSignal) {
  const rows = new Map<string, Record<string, unknown>>();
  const size = 100;
  for (let page = 0; page < 10000; page++) {
    const response = await fetch(`${path}?page=${page}&size=${size}`, {
      cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error(`စာရင်း ရယူ၍မရပါ။ (HTTP ${response.status})`);
    const data = record(await response.json());
    if (!Array.isArray(data.content) || data.page !== page || data.size !== size ||
      typeof data.totalElements !== "number" || !Number.isSafeInteger(data.totalElements) || data.totalElements < 0) {
      throw new Error("API စာမျက်နှာ အချက်အလက် မမှန်ပါ။");
    }
    for (const item of data.content) {
      const row = record(item);
      const key = keyOf(row);
      if (!key || rows.has(key)) throw new Error("မှတ်တမ်း နံပါတ် ထပ်နေပါသည်။ ပြန်တင်ပါ။");
      rows.set(key, row);
    }
    if (rows.size === data.totalElements && (page + 1) * size >= data.totalElements) return [...rows.values()];
    if (!data.content.length || (page + 1) * size >= data.totalElements) break;
  }
  throw new Error("စာရင်း အပြည့်အစုံ မရရှိပါ။ ပြန်တင်ပါ။");
}

async function productionValue(signal: AbortSignal) {
  const rows = new Map<number, Awaited<ReturnType<typeof historyPage>>["content"][number]>();
  for (let page = 0; page < 10000; page++) {
    signal.throwIfAborted();
    const result = await historyPage(page, "CONFIRMED");
    for (const row of result.content) {
      if (row.status !== "CONFIRMED" || rows.has(row.id)) throw new Error("Production မှတ်တမ်း မကိုက်ညီပါ။");
      rows.set(row.id, row);
    }
    if (page + 1 >= result.totalPages && rows.size === result.totalElements) {
      return aggregate([...rows.values()], (row) => [
        row.currency, row.actualOutputQuantity, row.snapshot.calculation?.values?.price,
      ]);
    }
    if (page + 1 >= result.totalPages || !result.content.length) break;
  }
  throw new Error("Production စာရင်း အပြည့်အစုံ မရရှိပါ။");
}

async function orderValue(signal: AbortSignal) {
  const rows = await readPages("/api/factory/dispatches/sources",
    (row) => typeof row.orderId === "string" ? row.orderId : "", signal);
  if (rows.some((row) => row.orderStatus !== "CONFIRMED")) throw new Error("အော်ဒါ အခြေအနေ မကိုက်ညီပါ။");
  return aggregate(rows, (row) => [row.currency, "1", row.total]);
}

async function warehouseValue(signal: AbortSignal) {
  const rows = await readPages("/api/factory/packing-gateway/packing/products",
    (row) => JSON.stringify([row.costingSheetId, row.costingItemId, row.sourceVersion,
      row.warehouseId, row.locationId, row.batch]), signal);
  return aggregate(rows, (row) => [row.currency, row.onHandQuantity, row.unitPrice]);
}

const metrics = [
  { title: "ထုတ်လုပ်မှု စုစုပေါင်းတန်ဖိုး", detail: "အတည်ပြုပြီး ထုတ်လုပ်ပမာဏ × ထုတ်လုပ်ချိန် ရောင်းဈေး", load: productionValue, href: "/factory/production", label: "Production", fill: "#2563eb", barClass: "bg-blue-600 dark:bg-blue-400" },
  { title: "အော်ဒါ စုစုပေါင်းတန်ဖိုး", detail: "Dispatch စာရင်းရှိ အတည်ပြုပြီး အော်ဒါတန်ဖိုး", load: orderValue, href: "/factory/office/orders", label: "Orders", fill: "#059669", barClass: "bg-emerald-600 dark:bg-emerald-400" },
  { title: "Warehouse လက်ကျန်တန်ဖိုး", detail: "ထုပ်ပိုးပြီး လက်ရှိစတော့ × API ရောင်းဈေး။ အော်ဒါအတွက် ဖယ်ထားသော စတော့ ပါဝင်သည်။", load: warehouseValue, href: "/factory/office/packing", label: "Warehouse", fill: "#7c3aed", barClass: "bg-violet-600 dark:bg-violet-400" },
];
export default function OfficeFactoryValuesPage() {
  const { data, status } = useSession();
  if (status === "loading") return <p role="status" className="p-6">စစ်ဆေးနေပါသည်…</p>;
  if (status !== "authenticated") return <p role="alert" className="p-6">တန်ဖိုးစာရင်းကြည့်ရန် ဝင်ရောက်ပေးပါ။</p>;

  const session = data as { shopId?: string | number; accessToken?: string; user?: {
    shopId?: string | number; id?: string | number; userId?: string | number; accountType?: string; role?: string;
  } } | null;
  let claims: Record<string, unknown> = {};
  try {
    const part = session?.accessToken?.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (part) {
      const decoded: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
      if (decoded && typeof decoded === "object") claims = decoded as Record<string, unknown>;
    }
  } catch { /* Session fields can still identify the signed-in account. */ }
  const shop = session?.user?.shopId ?? session?.shopId ?? claims.shopId ?? claims.shop_id;
  const account = session?.user?.id || session?.user?.userId || claims.sub;
  if (!/^[1-9]\d*$/.test(String(shop)) || (typeof account !== "string" && typeof account !== "number") || !String(account).trim()) {
    return <p role="alert" className="p-6">ဆိုင်နှင့် အသုံးပြုသူ အချက်အလက်ကို စစ်ပေးပါ။</p>;
  }
  const scope = JSON.stringify([String(shop), session?.user?.accountType ?? claims.accountType ?? session?.user?.role, String(account)]);
  return <FactoryValues key={scope} />;
}

function ValueChart({ reports }: { reports: Record<string, Report> }) {
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const currencies = [...new Set(Object.values(reports).flatMap((report) =>
    "totals" in report ? [...report.totals.values.keys()] : []
  ))].sort();
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0];
  const bars = metrics.map((metric) => {
    const report = reports[metric.href];
    const totals = report && "totals" in report ? report.totals : undefined;
    return { ...metric, report, totals, value: currency ? totals?.values.get(currency) : undefined };
  });
  const chartData = bars.map(({ label, fill, value }) => ({
    label, fill, amount: value === undefined ? null : Number(value) / Number(scale * scale),
  }));
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const loading = Object.keys(reports).length < metrics.length;

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7" aria-labelledby="factory-value-chart">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="factory-value-chart" className="text-lg font-semibold">စုစုပေါင်းတန်ဖိုး နှိုင်းယှဉ်ချက်</h2>
        {currency && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            ငွေကြေး
            <select className="h-11 rounded-lg border bg-background px-3 font-semibold text-foreground"
              value={currency} onChange={(event) => setSelectedCurrency(event.target.value)}>
              {currencies.map((code) => <option key={code}>{code}</option>)}
            </select>
          </label>
        )}
      </header>
      {currency ? (
        <>
          <div className="mt-5 h-64 min-w-0" aria-label={`စုစုပေါင်းတန်ဖိုး (${currency})`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={chartData} layout="vertical" margin={{ right: 18, left: 0 }} barSize={24}>
                <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="4 4" />
                <XAxis type="number" domain={[0, "auto"]} tickFormatter={(value: number) => compact.format(value)}
                  tick={{ fill: "currentColor", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="label" width={86}
                  tick={{ fill: "currentColor", fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip cursor={false} content={({ active, label }) => {
                  const row = bars.find((bar) => bar.label === label);
                  if (!active || row?.value === undefined) return null;
                  return (
                    <div className="rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-md">
                      <p>{row.label}</p>
                      <p className="font-semibold tabular-nums">{format(row.value, currency)}</p>
                    </div>
                  );
                }} />
                <Bar dataKey="amount" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                  {chartData.map(({ label, fill }) => <Cell key={label} fill={fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
          {bars.map(({ href, label, barClass, report, totals, value }) => {
            const fallback = !report ? "ရယူနေပါသည်…" : totals ? "ဤငွေကြေးဖြင့် တန်ဖိုးမရှိပါ" : "ရယူ၍မရပါ";
            return (
              <li key={href}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${barClass}`} />{label}</span>
                  <span className="min-w-0 break-words text-sm font-semibold tabular-nums">
                    {value === undefined ? fallback : format(value, currency)}
                    {!!totals?.missing && <span className="ml-2 text-xs font-normal text-amber-800 dark:text-amber-300">စာရင်းအချို့ မပြည့်စုံပါ</span>}
                  </span>
                </div>
              </li>
            );
          })}
          </ul>
        </>
      ) : (
        <p role="status" className="mt-5 text-sm text-muted-foreground">
          {loading ? "တန်ဖိုးများ ရယူနေပါသည်…" : "ဇယားတွင် ပြသနိုင်သော တန်ဖိုး မရှိသေးပါ။"}
        </p>
      )}
    </section>
  );
}

function FactoryValues() {
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    for (const metric of metrics) {
      void metric.load(controller.signal)
        .then((totals): Report => ({ totals }))
        .catch((reason: unknown): Report => ({
          error: reason instanceof Error ? reason.message : "စာရင်း ရယူ၍မရပါ။",
        }))
        .then((report) => {
          if (!controller.signal.aborted) setReports((current) => ({ ...current, [metric.href]: report }));
        });
    }
    return () => controller.abort();
  }, [revision]);

  return (
    <main lang="my" className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Factory တန်ဖိုးအနှစ်ချုပ်</h1>
        <Button variant="outline" disabled={Object.keys(reports).length !== metrics.length} onClick={() => {
          setReports({});
          setRevision((value) => value + 1);
        }}>ပြန်တင်ရန်</Button>
      </header>
      <ValueChart reports={reports} />
      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => {
          const report = reports[metric.href];
          return (
            <section key={metric.href} className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
              <h2 className="flex items-center gap-2 font-semibold"><span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${metric.barClass}`} />{metric.title}</h2>
              <p className="text-sm leading-7 text-muted-foreground">{metric.detail}</p>
              {!report ? <p role="status" className="text-sm">စာရင်း ရယူနေပါသည်…</p>
                : "error" in report ? <p role="alert" className="text-sm text-destructive">{report.error}</p>
                : (
                  <>
                    {report.totals.values.size ? [...report.totals.values].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => (
                      <p className="break-words text-xl font-semibold tabular-nums" key={currency}>{format(value, currency)}</p>
                    )) : <p className="text-xl font-semibold">{report.totals.missing ? "တန်ဖိုး မရရှိပါ" : "0"}</p>}
                    <p className="text-sm text-muted-foreground">မှတ်တမ်း {report.totals.count.toLocaleString()} ကြောင်း</p>
                    {report.totals.missing > 0 && <p role="status" className="text-sm leading-7 text-amber-800 dark:text-amber-300">
                      ဈေးနှုန်း သို့မဟုတ် ပမာဏ မပြည့်စုံသော စာရင်း {report.totals.missing.toLocaleString()} ကြောင်းကို တွက်ချက်မှုမှ ချန်ထားသည်။
                    </p>}
                  </>
                )}
              <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline" href={metric.href}>စာရင်းကြည့်ရန် →</Link>
            </section>
          );
        })}
      </div>
    </main>
  );
}
