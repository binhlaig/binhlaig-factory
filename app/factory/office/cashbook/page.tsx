"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClipboardList, Factory, Warehouse } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { historyPage } from "@/lib/production/factory-production-api";

type DailyTotal = { values: Map<string, bigint>; missing: number };
type Totals = DailyTotal & { daily: Map<string, DailyTotal> };
type Report = { totals: Totals; fetchedAt: Date } | { error: string };
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

function aggregate<T>(rows: T[], valueOf: (row: T) => [unknown, unknown, unknown], dateOf?: (row: T) => unknown): Totals {
  const totals: Totals = { values: new Map(), missing: 0, daily: new Map() };
  for (const row of rows) {
    const date = dateOf?.(row);
    let day: DailyTotal | undefined;
    if (dateOf) {
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("မှတ်တမ်းရက်စွဲ မပြည့်စုံပါ။");
      }
      day = totals.daily.get(date) ?? { values: new Map(), missing: 0 };
      totals.daily.set(date, day);
    }
    const [currency, rawQuantity, rawPrice] = valueOf(row);
    const quantity = decimal(rawQuantity);
    const price = decimal(rawPrice);
    if (quantity === null || (quantity !== zero && price === null) || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
      totals.missing++;
      if (day) day.missing++;
      continue;
    }
    const value = quantity * (price ?? zero);
    for (const target of day ? [totals, day] : [totals]) {
      target.values.set(currency, (target.values.get(currency) ?? zero) + value);
    }
  }
  return totals;
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
      ], (row) => row.productionDate);
    }
    if (page + 1 >= result.totalPages || !result.content.length) break;
  }
  throw new Error("Production စာရင်း အပြည့်အစုံ မရရှိပါ။");
}

async function orderValue(signal: AbortSignal) {
  const rows = await readPages("/api/factory/dispatches/sources",
    (row) => typeof row.orderId === "string" ? row.orderId : "", signal);
  if (rows.some((row) => row.orderStatus !== "CONFIRMED")) throw new Error("အော်ဒါ အခြေအနေ မကိုက်ညီပါ။");
  return aggregate(rows, (row) => [row.currency, "1", row.total], (row) => row.deliveryDate);
}

async function warehouseValue(signal: AbortSignal) {
  const rows = await readPages("/api/factory/packing-gateway/packing/products",
    (row) => JSON.stringify([row.costingSheetId, row.costingItemId, row.sourceVersion,
      row.warehouseId, row.locationId, row.batch]), signal);
  return aggregate(rows, (row) => [row.currency, row.onHandQuantity, row.unitPrice]);
}

const metrics = [
  { key: "production", title: "စုစုပေါင်း ထုတ်လုပ်မှုတန်ဖိုး", label: "ထုတ်လုပ်မှု", load: productionValue, href: "/factory/production", Icon: Factory, stroke: "#2563eb", colorClass: "border-l-blue-600 text-blue-700 dark:text-blue-300" },
  { key: "orders", title: "အတည်ပြုပြီး အော်ဒါတန်ဖိုး", label: "အော်ဒါ", load: orderValue, href: "/factory/office/orders", Icon: ClipboardList, stroke: "#059669", colorClass: "border-l-emerald-600 text-emerald-700 dark:text-emerald-300" },
  { key: "warehouse", title: "ဂိုဒေါင် လက်ကျန်တန်ဖိုး", label: "ဂိုဒေါင်", load: warehouseValue, href: "/factory/office/packing", Icon: Warehouse, colorClass: "border-l-violet-600 text-violet-700 dark:text-violet-300" },
] as const;

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

function recentDates(days: number, now: Date) {
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    dates.push([date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part) => String(part).padStart(2, "0")).join("-"));
  }
  return dates;
}

function FactoryValues() {
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [revision, setRevision] = useState(0);
  const [days, setDays] = useState(7);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [clock, setClock] = useState<Date | null>(null);
  const gradient = useId();

  useEffect(() => {
    const updateClock = () => setClock(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 60_000);
    window.addEventListener("focus", updateClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateClock);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    for (const metric of metrics) {
      void metric.load(controller.signal)
        .then((totals): Report => ({ totals, fetchedAt: new Date() }))
        .catch((reason: unknown): Report => ({
          error: reason instanceof Error ? reason.message : "စာရင်း ရယူ၍မရပါ။",
        }))
        .then((report) => {
          if (!controller.signal.aborted) setReports((current) => ({ ...current, [metric.key]: report }));
        });
    }
    return () => controller.abort();
  }, [revision]);

  const dates = clock ? recentDates(days, clock) : [];
  const currencies = [...new Set(Object.values(reports).flatMap((report) =>
    "totals" in report ? [...report.totals.values.keys()] : [],
  ))].sort();
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0];
  const cards = metrics.map((metric) => {
    const report = reports[metric.key];
    const totals = report && "totals" in report ? report.totals : undefined;
    const period = metric.key === "warehouse" ? (totals ? [totals] : []) :
      dates.flatMap((date) => {
        const day = totals?.daily.get(date);
        return day ? [day] : [];
      });
    const value = period.reduce((sum, day) => sum + (day.values.get(currency) ?? zero), zero);
    const missing = period.reduce((sum, day) => sum + day.missing, 0);
    const hasValues = period.some((day) => day.values.has(currency));
    return { ...metric, report, totals, value, missing, hasValues };
  });
  const dailyMetrics = cards.filter((metric) => metric.key !== "warehouse");

  function pointValue(totals: Totals | undefined, date: string) {
    if (!totals || !currency) return null;
    const day = totals.daily.get(date);
    if (day?.missing) return null;
    return Number(day?.values.get(currency) ?? zero) / Number(scale * scale);
  }

  const chart = dates.map((date) => ({
    date,
    production: pointValue(dailyMetrics[0].totals, date),
    orders: pointValue(dailyMetrics[1].totals, date),
  }));
  const canPlot = chart.some(({ production, orders }) => production !== null || orders !== null);
  const shortNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

  return (
    <main lang="my" className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold sm:text-2xl">စက်ရုံတန်ဖိုး အနှစ်ချုပ်</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="စာရင်းကာလ" className="flex gap-1 rounded-xl border bg-muted/50 p-1">
            {[7, 30].map((range) => (
              <Button key={range} size="sm" type="button" className="min-h-10" aria-pressed={days === range}
                variant={days === range ? "default" : "ghost"} onClick={() => setDays(range)}>
                {range === 7 ? "၇ ရက်" : "၃၀ ရက်"}
              </Button>
            ))}
          </div>
          {currency && (
            <select aria-label="ငွေကြေး" className="h-11 rounded-lg border bg-background px-3 text-sm"
              value={currency} onChange={(event) => setSelectedCurrency(event.target.value)}>
              {currencies.map((code) => <option key={code}>{code}</option>)}
            </select>
          )}
          <Button variant="outline" className="min-h-11" disabled={Object.keys(reports).length !== metrics.length}
            onClick={() => { setReports({}); setRevision((value) => value + 1); }}>ပြန်တင်ရန်</Button>
        </div>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map(({ key, report, title, value, missing, hasValues, href, Icon, colorClass }) => (
          <section key={key} className={`min-w-0 rounded-xl border border-l-4 bg-card p-4 shadow-sm ${colorClass}`}>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Icon className="size-5 shrink-0" aria-hidden="true" />{title}
            </h2>
            {!report ? <p role="status" className="mt-3 text-sm">စာရင်း ရယူနေပါသည်…</p>
              : "error" in report ? <p role="alert" className="mt-3 text-sm text-destructive">{report.error}</p>
              : (
                <>
                  <p className="mt-2 break-words text-xl font-bold tabular-nums sm:text-2xl">
                    {currency && (hasValues || (!missing && key !== "warehouse")) ? format(value, currency) : "—"}
                  </p>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    {key === "warehouse"
                      ? `လက်ရှိစတော့ · ${report.fetchedAt.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}`
                      : `${dates[0] ?? ""} မှ ${dates[dates.length - 1] ?? ""} အထိ`}
                  </p>
                  {missing > 0 && <p className="text-xs leading-6 text-amber-700 dark:text-amber-300">တန်ဖိုးမပြည့်စုံသော မှတ်တမ်း {missing} ကြောင်း</p>}
                </>
              )}
            <Link className="mt-1 inline-flex min-h-9 items-center text-xs font-medium hover:underline" href={href}>စာရင်းကြည့်ရန် →</Link>
          </section>
        ))}
      </div>

      <section aria-labelledby="daily-value-title" className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="daily-value-title" className="text-lg font-semibold">နေ့စဉ်တန်ဖိုး{currency ? ` · ${currency}` : ""}</h2>
          <div className="flex flex-wrap gap-4 text-xs">
            {dailyMetrics.map((metric) => (
              <span key={metric.key} className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="h-0.5 w-5 rounded" style={{ backgroundColor: metric.stroke }} />
                {metric.label}
              </span>
            ))}
          </div>
        </header>
        {canPlot ? (
          <div className="mt-4 h-72 min-w-0 sm:h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={chart} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="4 4" />
                <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)}
                  minTickGap={18} tickLine={false} axisLine={false} tick={{ fill: "currentColor", fontSize: 11 }} />
                <YAxis domain={[0, "auto"]} tickFormatter={(value: number) => shortNumber.format(value)}
                  width={52} tickLine={false} axisLine={false} tick={{ fill: "currentColor", fontSize: 11 }} />
                <Tooltip filterNull={false} cursor={{ stroke: "#94a3b8", strokeDasharray: "4 4" }} content={({ active, label }) => {
                  if (!active || typeof label !== "string") return null;
                  return (
                    <div className="rounded-lg border bg-card p-3 text-xs leading-6 text-foreground shadow-md">
                      <p className="font-semibold">{label}</p>
                      {dailyMetrics.map(({ key, label: name, totals, stroke }) => {
                        const day = totals?.daily.get(label);
                        return (
                          <p key={key} className="flex items-center gap-2">
                            <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: stroke }} />
                            {name} · {totals ? day?.missing ? "တန်ဖိုး မပြည့်စုံပါ" : format(day?.values.get(currency) ?? zero, currency) : "တန်ဖိုး မရရှိပါ"}
                          </p>
                        );
                      })}
                    </div>
                  );
                }} />
                <Area dataKey="production" type="linear" stroke="#2563eb" strokeWidth={2.5} fill={`url(#${gradient})`}
                  dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                <Line dataKey="orders" type="linear" stroke="#059669" strokeWidth={2.5}
                  dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          {Object.keys(reports).length < metrics.length ? "စာရင်း ရယူနေပါသည်…" : "ပြသနိုင်သော နေ့စဉ်တန်ဖိုး မရှိသေးပါ။"}
        </p>}
        <p className="mt-2 text-xs leading-6 text-muted-foreground">ထုတ်လုပ်ရက်နှင့် သတ်မှတ်ပို့ရက်အလိုက် · တန်ဖိုးမပြည့်စုံသောရက်တွင် မျဉ်းပြတ်ပြသည်။</p>
      </section>
    </main>
  );
}
