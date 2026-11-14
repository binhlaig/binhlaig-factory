"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { historyPage } from "@/lib/production/factory-production-api";

type Stock = {
  costingSheetId: number;
  costingItemId: number;
  sourceVersion: number;
  warehouseId: number;
  locationId: number;
  productName: string;
  barcode: string;
  batch: string;
  productionIds?: number[];
  saleUnit: string;
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
};

const quantityFields = ["onHandQuantity", "reservedQuantity", "availableQuantity"] as const;
const filters = [
  { value: "all", label: "အားလုံး" },
  { value: "available", label: "အသုံးပြုနိုင်သော စတော့" },
  { value: "reserved", label: "အော်ဒါအတွက် ဖယ်ထားသော စတော့" },
];
const pageSize = 12;
const formatQuantity = (value: string) => BigInt(value).toLocaleString("en-US");

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stockKey(row: Stock) {
  return JSON.stringify([
    row.costingSheetId, row.costingItemId, row.sourceVersion,
    row.warehouseId, row.locationId, row.batch,
  ]);
}

function decodeStock(value: unknown): Stock {
  if (!isRecord(value) ||
    !["costingSheetId", "costingItemId", "sourceVersion", "warehouseId", "locationId"]
      .every((key) => Number.isSafeInteger(value[key])) ||
    !["productName", "barcode", "batch", "saleUnit"].every((key) => typeof value[key] === "string") ||
    !quantityFields.every((key) => typeof value[key] === "string" && /^\d{1,24}$/.test(value[key]))) {
    throw new Error("စတော့အချက်အလက်ပုံစံ မမှန်ပါ။");
  }
  const productionIds = Array.isArray(value.productionIds)
    ? value.productionIds.filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0)
    : [];
  return { ...value, productionIds } as Stock;
}

async function readStock(signal: AbortSignal) {
  const rows = new Map<string, Stock>();
  const size = 100;
  for (let page = 0; page < 10000; page++) {
    const response = await fetch(`/api/factory/packing-gateway/packing/products?page=${page}&size=${size}`, {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (response.status === 401) throw new Error("စာရင်းကြည့်ရန် ပြန်ဝင်ပေးပါ။");
    if (response.status === 403) throw new Error("စတော့စာရင်း ကြည့်ခွင့် မရှိပါ။");
    if (!response.ok) throw new Error(`စတော့စာရင်း ရယူ၍မရပါ။ (${response.status})`);
    const data: unknown = await response.json();
    if (!isRecord(data) || data.page !== page || data.size !== size || !Array.isArray(data.content) ||
      typeof data.totalElements !== "number" || !Number.isSafeInteger(data.totalElements) || data.totalElements < 0) {
      throw new Error("စာမျက်နှာ အချက်အလက်ပုံစံ မမှန်ပါ။");
    }
    for (const item of data.content) {
      const row = decodeStock(item);
      rows.set(stockKey(row), row);
    }
    if ((page + 1) * size >= data.totalElements && rows.size === data.totalElements) {
      return [...rows.values()].sort((a, b) => a.productName.localeCompare(b.productName) || a.batch.localeCompare(b.batch));
    }
    if (!data.content.length || (page + 1) * size >= data.totalElements) break;
  }
  throw new Error("စတော့စာရင်း အပြည့်မရပါ။ ပြန်တင်ကြည့်ပါ။");
}

type Production = Awaited<ReturnType<typeof historyPage>>["content"][number];
type ProductValue = {
  key: string; name: string; barcode: string; unit: string;
  quantity: bigint; value: bigint; minPrice?: bigint; maxPrice?: bigint; batches: number; pricedBatches: number; missing: number;
};
const scale = BigInt(1_000_000);
const zero = BigInt(0);

function decimal(raw: unknown) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw);
  if (!/^\d{1,24}(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"));
}

function fixed(value: bigint, places: number) {
  const divisor = BigInt(10) ** BigInt(places);
  const fraction = (value % divisor).toString().padStart(places, "0").replace(/0+$/, "");
  return `${(value / divisor).toLocaleString("en-US")}${fraction ? "." + fraction : ""}`;
}

async function readConfirmedProduction(signal: AbortSignal) {
  const rows = new Map<number, Production>();
  for (let page = 0; page < 10_000; page++) {
    signal.throwIfAborted();
    const result = await historyPage(page, "CONFIRMED");
    for (const row of result.content) {
      if (row.status !== "CONFIRMED" || rows.has(row.id)) throw new Error("ထုတ်လုပ်မှုမှတ်တမ်း မကိုက်ညီပါ။");
      rows.set(row.id, row);
    }
    if (page + 1 >= result.totalPages && rows.size === result.totalElements) return [...rows.values()];
    if (!result.content.length || page + 1 >= result.totalPages) break;
  }
  throw new Error("ထုတ်လုပ်မှုစာရင်း အပြည့်မရပါ။");
}

function groupProducts(records: Production[], currency: string) {
  const products = new Map<string, ProductValue>();
  for (const row of records) {
    if (row.currency !== currency) continue;
    const key = JSON.stringify([row.costingSheetId, row.costingItemId, row.saleUnit]);
    const product = products.get(key) ?? {
      key, name: row.snapshot.productName, barcode: row.barcode, unit: row.saleUnit,
      quantity: zero, value: zero, batches: 0, pricedBatches: 0, missing: 0,
    };
    products.set(key, product);
    product.batches++;
    const quantity = decimal(row.actualOutputQuantity);
    const price = decimal(row.snapshot.calculation?.values?.price);
    product.quantity += quantity ?? zero;
    if (quantity === null || (quantity !== zero && price === null)) {
      product.missing++;
      continue;
    }
    if (price !== null) {
      if (product.minPrice === undefined || price < product.minPrice) product.minPrice = price;
      if (product.maxPrice === undefined || price > product.maxPrice) product.maxPrice = price;
    }
    product.value += quantity * (price ?? zero);
    product.pricedBatches++;
  }
  return [...products.values()].sort((a, b) => a.value === b.value
    ? a.name.localeCompare(b.name) : a.value > b.value ? -1 : 1);
}

function ProductValuesTable({ products, currency }: { products: ProductValue[]; currency: string }) {
  return (
    <table className="w-full min-w-[560px] text-left text-sm">
      <thead className="border-b bg-muted/50"><tr>
        {["ပစ္စည်း / Barcode", "မှတ်တမ်း", "ထုပ်ပိုးပြီး ပမာဏ", "တစ်ယူနစ် ရောင်းဈေး", "စုစုပေါင်းတန်ဖိုး"].map((label) => (
          <th key={label} scope="col" className="px-3 py-3 font-medium last:text-right">{label}</th>
        ))}
      </tr></thead>
      <tbody className="divide-y">
        {products.map((product) => (
          <tr key={product.key}>
            <th scope="row" className="px-3 py-3 font-medium">{product.name}<span className="block text-xs text-muted-foreground">{product.barcode}</span></th>
            <td className="px-3 py-3 tabular-nums">{product.batches}</td>
            <td className="px-3 py-3 tabular-nums">{fixed(product.quantity, 6)} {product.unit}{product.missing > 0 && "*"}</td>
            <td className="px-3 py-3 tabular-nums">
              {product.minPrice === undefined ? "—" : (
                <>
                  {fixed(product.minPrice, 6)}
                  {product.maxPrice !== undefined && product.maxPrice !== product.minPrice && `–${fixed(product.maxPrice, 6)}`}
                  {" "}{currency}
                </>
              )}
            </td>
            <td className="px-3 py-3 text-right font-semibold tabular-nums">
              {product.pricedBatches ? `${fixed(product.value, 12)} ${currency}` : "—"}
              {product.missing > 0 && <span className="block text-xs text-amber-700 dark:text-amber-300">တန်ဖိုး မပြည့်စုံပါ</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const chartNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const chartPageSize = 8;

function ProductValueChart({ products, currency }: { products: ProductValue[]; currency: string }) {
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState("");
  const gradientId = useId();
  const ranked = products.filter((product) => product.pricedBatches > 0);
  const lastPage = Math.max(0, Math.ceil(ranked.length / chartPageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * chartPageSize;
  const max = Math.max(1, Number(ranked[0]?.value ?? zero) / Number(scale * scale));
  const chart = ranked.slice(start, start + chartPageSize).map((product, index) => ({
    ...product, rank: start + index + 1, amount: Number(product.value) / Number(scale * scale),
  }));
  const selected = chart.find((product) => product.key === selectedKey) ?? chart[0];

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm" aria-labelledby="packing-value-chart">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <h2 id="packing-value-chart" className="text-base font-semibold sm:text-lg">ပစ္စည်းအလိုက် ထုပ်ပိုးတန်ဖိုး</h2>
        <span className="rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground">{currency}</span>
      </header>
      {selected ? (
        <>
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(230px,0.37fr)]">
            <div className="min-w-0 px-3 py-4 sm:px-5" style={{ height: 295 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart key={currentPage} data={chart}
                  margin={{ top: 12, right: 20, bottom: 6, left: 0 }} accessibilityLayer
                  onClick={(state) => {
                    const product = chart.find((row) => row.key === state?.activeLabel);
                    if (product) setSelectedKey(product.key);
                  }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.34} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="3 5" />
                  <XAxis dataKey="key" interval={0} padding={{ left: 12, right: 10 }}
                    tickFormatter={(key: string) => `#${chart.find((row) => row.key === key)?.rank ?? ""}`}
                    tickLine={false} axisLine={false} tick={{ fill: "currentColor", fontSize: 11 }} />
                  <YAxis type="number" domain={[0, max]} tickCount={5} width={64}
                    tickFormatter={(value: number) => chartNumber.format(value)}
                    tickLine={false} axisLine={false} tick={{ fill: "currentColor", fontSize: 11 }} />
                  <Tooltip cursor={{ stroke: "currentColor", strokeOpacity: 0.25, strokeDasharray: "4 4" }} content={({ active, label }) => {
                    const row = chart.find((product) => product.key === label);
                    return active && row ? (
                      <div className="max-w-56 rounded-xl border bg-card p-3 text-sm text-foreground shadow-md">
                        <p className="break-words">{row.name}</p>
                        <p className="font-semibold tabular-nums">{fixed(row.value, 12)} {currency}</p>
                        {row.missing > 0 && <p className="text-xs text-muted-foreground">တန်ဖိုး မပြည့်စုံပါ</p>}
                      </div>
                    ) : null;
                  }} />
                  <Area dataKey="amount" type="linear" baseValue={0} stroke="#6366f1" strokeWidth={2.5}
                    fill={`url(#${gradientId})`} fillOpacity={1}
                    dot={{ r: 3.5, fill: "#6366f1", strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: "#4f46e5", stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="min-w-0 space-y-3 border-t bg-muted/25 p-4 lg:border-l lg:border-t-0 sm:p-5">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">ပစ္စည်းအသေးစိတ်</span>
                <select className="h-10 w-full rounded-lg border bg-background px-2"
                  value={selected.key} onChange={(event) => setSelectedKey(event.target.value)}>
                  {chart.map((product) => <option key={product.key} value={product.key}>#{product.rank} · {product.name}{product.barcode ? ` · ${product.barcode}` : ""}</option>)}
                </select>
              </label>
              <dl className="space-y-2 text-sm">
                <div><dt className="text-muted-foreground">ထုပ်ပိုးပြီးတန်ဖိုး</dt>
                  <dd className="break-words text-lg font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fixed(selected.value, 12)} {currency}</dd></div>
                <div><dt className="text-muted-foreground">ထုပ်ပိုးပြီးပမာဏ</dt>
                  <dd className="font-medium tabular-nums">{fixed(selected.quantity, 6)} {selected.unit}</dd></div>
              </dl>
              {selected.missing > 0 && <p className="text-xs leading-6 text-amber-800 dark:text-amber-300">တန်ဖိုးမပြည့်စုံသော မှတ်တမ်း {selected.missing} ကြောင်း</p>}
            </div>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-6">
            <p className="text-sm text-muted-foreground">တန်ဖိုးအလိုက် {start + 1}–{start + chart.length} / {ranked.length} မျိုး</p>
            {lastPage > 0 && (
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>နောက်သို့</Button>
                <Button type="button" variant="outline" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>ရှေ့သို့</Button>
              </div>
            )}
          </footer>
        </>
      ) : <p role="status" className="p-6 text-sm text-muted-foreground">ပြသနိုင်သော တန်ဖိုး မရှိသေးပါ။</p>}
    </section>
  );
}

function PackingDates({ ids, dates }: { ids: number[]; dates: Map<number, string> }) {
  const values = [...new Set(ids.flatMap((id) => {
    const date = dates.get(id);
    return date ? [date] : [];
  }))].sort();
  return (
    <>
      {values.map((date) => <time key={date} dateTime={date} className="block tabular-nums">{date}</time>)}
      {(!values.length || ids.some((id) => !dates.has(id))) &&
        <span className="block text-xs text-muted-foreground">ရက်စွဲ မရရှိပါ</span>}
    </>
  );
}

function StockTable({ rows, dates, offset = 0 }: { rows: Stock[]; dates: Map<number, string>; offset?: number }) {
  return (
    <table className="packing-table w-full min-w-[860px] text-left text-sm">
      <thead className="border-b bg-muted/50 text-muted-foreground">
        <tr>
          {["စဉ်", "ပစ္စည်း / Barcode", "Batch", "ထုပ်ပိုးရက်", "ဂိုဒေါင် / နေရာ", "လက်ကျန်", "ဖယ်ထား", "အသုံးပြုနိုင်"].map((label, index) => (
            <th scope="col" key={label} className={`px-3 py-3 font-medium ${index >= 5 ? "text-right" : ""}`}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((row, index) => (
          <tr key={stockKey(row)}>
            <td className="px-3 py-3 tabular-nums">{offset + index + 1}</td>
            <th scope="row" className="px-3 py-3 font-medium">
              {row.productName}
              <span className="block font-mono text-xs text-muted-foreground">{row.barcode}</span>
            </th>
            <td className="px-3 py-3">{row.batch || "—"}</td>
            <td className="px-3 py-3"><PackingDates ids={row.productionIds ?? []} dates={dates} /></td>
            <td className="px-3 py-3">#{row.warehouseId} / #{row.locationId}</td>
            {quantityFields.map((field) => (
              <td key={field} className="px-3 py-3 text-right tabular-nums">
                {formatQuantity(row[field])} {row.saleUnit}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const printStyles = `
  @media screen { #office-packing-report { display: none; } }
  @page { size: A4 landscape; margin: 13mm; }
  @media print {
    body { margin: 0 !important; background: white !important; }
    body:has(> #office-packing-report) > :not(#office-packing-report) { display: none !important; }
    #office-packing-report { display: block; color: #172338; background: white; font: 10pt/1.6 "Noto Sans Myanmar", "Myanmar Text", Padauk, sans-serif; }
    #office-packing-report header { border-bottom: 2px solid #203b59; padding-bottom: 10px; margin-bottom: 12px; }
    #office-packing-report h1 { font-size: 19pt; font-weight: 700; margin: 3px 0; }
    #office-packing-report p { margin: 0; overflow-wrap: anywhere; }
    #office-packing-report table { min-width: 0; width: 100%; border-collapse: collapse; }
    #office-packing-report thead { display: table-header-group; }
    #office-packing-report tr { break-inside: avoid; }
    #office-packing-report th, #office-packing-report td { padding: 5px 7px; border-bottom: 1px solid #bac6d3; color: #172338; vertical-align: top; overflow-wrap: anywhere; }
    #office-packing-report thead th { border-top: 1px solid #203b59; font-weight: 700; }
    #office-packing-report span { color: #42546a; }
  }
`;

export default function OfficePackingPage() {
  const { data, status } = useSession();
  if (status === "loading") return <p role="status" className="p-5">စစ်ဆေးနေပါသည်…</p>;
  if (status !== "authenticated") return <p role="alert" className="p-5">စာရင်းကြည့်ရန် ဝင်ရောက်ပေးပါ။</p>;

  const user = data?.user as { shopId?: string; id?: string; userId?: string; email?: string | null } | undefined;
  return <PackingStock key={JSON.stringify([user?.shopId, user?.id ?? user?.userId ?? user?.email])} />;
}

function PackingStock() {
  const [rows, setRows] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [production, setProduction] = useState<Production[]>([]);
  const [productionLoading, setProductionLoading] = useState(true);
  const [productionError, setProductionError] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void readStock(controller.signal).then((stock) => {
      if (controller.signal.aborted) return;
      setRows(stock);
      setLoadedAt(new Date());
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "စတော့စာရင်း ရယူ၍မရပါ။");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    void readConfirmedProduction(controller.signal).then((records) => {
      if (!controller.signal.aborted) setProduction(records);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setProductionError(reason instanceof Error ? reason.message : "ထုတ်လုပ်မှုစာရင်း ရယူ၍မရပါ။");
    }).finally(() => {
      if (!controller.signal.aborted) setProductionLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  const dates = new Map(production.map((row) => [row.id, row.productionDate]));
  const currencies = [...new Set(production.map((row) => row.currency))].sort();
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0] ?? "";
  const products = groupProducts(production, currency);
  const productSearch = productQuery.trim().toLocaleLowerCase();
  const visibleProducts = products.filter((product) =>
    [product.name, product.barcode].some((value) => value.toLocaleLowerCase().includes(productSearch)));
  const batchCount = products.reduce((sum, product) => sum + product.batches, 0);
  const missing = products.reduce((sum, product) => sum + product.missing, 0);
  const total = products.reduce((sum, product) => sum + product.value, zero);
  const hasValue = products.some((product) => product.pricedBatches > 0);
  const totalText = hasValue ? `${fixed(total, 12)} ${currency}` : "—";
  const canPrintValues = !productionLoading && !productionError && products.length > 0;

  const search = query.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    if (![row.productName, row.barcode, row.batch].some((value) => value.toLocaleLowerCase().includes(search))) return false;
    if (filter === "available") return BigInt(row.availableQuantity) > BigInt(0);
    if (filter === "reserved") return BigInt(row.reservedQuantity) > BigInt(0);
    return true;
  });
  const start = page * pageSize;
  const canPrintStock = !loading && !error && filtered.length > 0;
  const canPrint = canPrintStock || canPrintValues;

  return (
    <main lang="my" className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold sm:text-2xl">ထုပ်ပိုးပြီး ပစ္စည်းတန်ဖိုး</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/factory/office/orders" className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm hover:bg-muted">အော်ဒါစာရင်း</Link>
          <Button variant="outline" disabled={loading || productionLoading} onClick={() => {
            setLoading(true);
            setError("");
            setProductionLoading(true);
            setProductionError("");
            setPage(0);
            setRevision((value) => value + 1);
          }}>ပြန်တင်ရန်</Button>
          <Button disabled={!canPrint} onClick={() => window.print()}>Print / PDF ထုတ်ရန်</Button>
        </div>
      </header>
      <div className="grid gap-3 md:grid-cols-[1.65fr_1fr_1fr]">
        <section className="min-w-0 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/25">
          <h2 className="text-sm font-semibold">ထုပ်ပိုးပြီး စုစုပေါင်းတန်ဖိုး</h2>
          <p className="mt-2 break-words text-2xl font-bold tabular-nums text-indigo-800 dark:text-indigo-300">
            {productionLoading || productionError ? "—" : totalText}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">အတည်ပြုပြီး ထုတ်လုပ်ပမာဏ × ထုတ်လုပ်ချိန် ရောင်းဈေး</p>
        </section>
        {[
          { label: "ပစ္စည်းအမျိုးအစား", value: products.length },
          { label: "အတည်ပြုပြီး ထုတ်လုပ်မှတ်တမ်း", value: batchCount },
        ].map(({ label, value }) => (
          <section key={label} className="min-w-0 rounded-2xl border bg-card p-4">
            <h2 className="text-sm font-semibold">{label}</h2>
            <p className="mt-2 text-2xl font-bold tabular-nums">{productionLoading || productionError ? "—" : value.toLocaleString()}</p>
          </section>
        ))}
      </div>
      {productionLoading && <p role="status" className="text-sm">တန်ဖိုးစာရင်း ရယူနေပါသည်…</p>}
      {productionError && <p role="alert" className="text-sm text-destructive">{productionError}</p>}
      {!productionLoading && !productionError && (missing > 0 || !products.length) && (
        <p className="text-sm leading-6 text-muted-foreground">
          {missing > 0 ? `တန်ဖိုးတွက်ချက်ရာတွင် ဈေး သို့မဟုတ် ပမာဏ မပြည့်စုံသော မှတ်တမ်း ${missing} ကြောင်း ကျန်ရှိပါသည်။` : "အတည်ပြုပြီး ထုတ်လုပ်မှတ်တမ်း မတွေ့ပါ။"}
        </p>
      )}
      {canPrintValues && (
        <>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="ထုပ်ပိုးတန်ဖိုးစာရင်း ရှာရန်" placeholder="ပစ္စည်းအမည်၊ Barcode ရှာရန်"
              className="h-11 min-w-48 flex-1 sm:max-w-sm" value={productQuery}
              onChange={(event) => setProductQuery(event.target.value)} />
            <select aria-label="တန်ဖိုးပြသမည့် ငွေကြေး" className="h-11 rounded-lg border bg-background px-3 text-sm"
              value={currency} onChange={(event) => setSelectedCurrency(event.target.value)}>
              {currencies.map((code) => <option key={code}>{code}</option>)}
            </select>
          </div>
          {visibleProducts.length ? (
            <>
              <ProductValueChart key={JSON.stringify([currency, productSearch])} products={visibleProducts} currency={currency} />
              <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="packing-product-values">
                <h2 id="packing-product-values" className="px-4 py-3 font-semibold">ပစ္စည်းတစ်မျိုးချင်း တန်ဖိုးစာရင်း</h2>
                <div className="overflow-x-auto"><ProductValuesTable products={visibleProducts} currency={currency} /></div>
                {visibleProducts.some((product) => product.missing > 0) &&
                  <p className="px-4 py-2 text-xs text-muted-foreground">* အချို့မှတ်တမ်းတွင် ဈေး သို့မဟုတ် ပမာဏ မပြည့်စုံပါ။</p>}
              </section>
            </>
          ) : <p role="status" className="rounded-xl border bg-card p-5 text-sm">ကိုက်ညီသော ပစ္စည်း မတွေ့ပါ။</p>}
        </>
      )}
      <h2 className="text-lg font-semibold">လက်ရှိ ထုပ်ပိုးပြီး စတော့</h2>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="စတော့ရှာရန်" placeholder="ပစ္စည်း၊ Barcode၊ Batch ရှာရန်"
          className="h-11 min-w-48 flex-1 sm:max-w-sm" value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
        <select aria-label="စတော့အခြေအနေ" className="h-11 rounded-md border bg-background px-3 text-sm"
          value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}>
          {filters.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>


      {loading ? <p role="status" className="rounded-xl border p-5">စတော့စာရင်း ရယူနေပါသည်…</p>
        : error ? <p role="alert" className="rounded-xl border p-5 text-destructive">{error}</p>
        : !filtered.length ? <p role="status" className="rounded-xl border p-5">ကိုက်ညီသော စတော့ မတွေ့ပါ။</p>
        : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto">
              <StockTable dates={dates} rows={filtered.slice(start, start + pageSize)} offset={start} />
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm">
              <span>{start + 1}–{Math.min(start + pageSize, filtered.length)} / {filtered.length}</span>
              <div className="flex gap-2">
                <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>နောက်သို့</Button>
                <Button variant="outline" disabled={start + pageSize >= filtered.length} onClick={() => setPage(page + 1)}>ရှေ့သို့</Button>
              </div>
            </footer>
          </div>
        )}

      {canPrint && createPortal(
        <article id="office-packing-report" lang="my">
          <style>{printStyles}</style>
          <header>
            <p>Binhlaig Factory · Office</p>
            <h1>ထုပ်ပိုးပြီး ပစ္စည်းတန်ဖိုးနှင့် စတော့စာရင်း</h1>
            <p>စာရင်းရယူချိန် · {loadedAt?.toLocaleString()}</p>
            <p>စစ်ထုတ်မှု · {filters.find((item) => item.value === filter)?.label} · စာရင်း {filtered.length.toLocaleString()} ကြောင်း</p>
            {query.trim() && <p>ရှာဖွေထားသော စာသား · {query.trim()}</p>}
          </header>
          {canPrintValues && (
            <section className="mb-5">
              <h2 className="font-semibold">ပစ္စည်းအားလုံး၏ ထုပ်ပိုးပြီးတန်ဖိုး · {totalText}</h2>
              <p>အတည်ပြုပြီး ထုတ်လုပ်ပမာဏ × ထုတ်လုပ်ချိန် ရောင်းဈေး</p>
              {missing > 0 && <p>* တန်ဖိုးမပြည့်စုံသော မှတ်တမ်း {missing} ကြောင်း</p>}
              <ProductValuesTable products={products} currency={currency} />
            </section>
          )}
          {canPrintStock && <StockTable dates={dates} rows={filtered} />}
        </article>,
        document.body,
      )}
    </main>
  );
}
