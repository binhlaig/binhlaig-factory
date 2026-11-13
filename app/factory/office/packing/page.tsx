"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

async function readPackingDates(rows: Stock[], signal: AbortSignal) {
  const pending = new Set(rows.flatMap((row) => row.productionIds ?? []));
  const dates = new Map<number, string>();
  for (let page = 0; pending.size && page < 10000; page++) {
    if (signal.aborted) return dates;
    const result = await historyPage(page, "CONFIRMED");
    for (const record of result.content) {
      if (record.status === "CONFIRMED" && pending.delete(record.id) &&
        /^\d{4}-\d{2}-\d{2}$/.test(record.productionDate)) {
        dates.set(record.id, record.productionDate);
      }
    }
    if (page + 1 >= result.totalPages || !result.content.length) return dates;
  }
  return dates;
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
  const [dates, setDates] = useState(new Map<number, string>());
  const [dateError, setDateError] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void readStock(controller.signal).then(async (stock) => {
      if (controller.signal.aborted) return;
      setRows(stock);
      setLoadedAt(new Date());
      try {
        const nextDates = await readPackingDates(stock, controller.signal);
        if (!controller.signal.aborted) setDates(nextDates);
      } catch {
        if (!controller.signal.aborted) {
          setDates(new Map());
          setDateError(true);
        }
      }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "စတော့စာရင်း ရယူ၍မရပါ။");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  const search = query.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    if (![row.productName, row.barcode, row.batch].some((value) => value.toLocaleLowerCase().includes(search))) return false;
    if (filter === "available") return BigInt(row.availableQuantity) > BigInt(0);
    if (filter === "reserved") return BigInt(row.reservedQuantity) > BigInt(0);
    return true;
  });
  const start = page * pageSize;
  const canPrint = !loading && !error && filtered.length > 0;

  return (
    <main lang="my" className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold sm:text-2xl">ထုပ်ပိုးပြီး စတော့စာရင်း</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/factory/office/orders" className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm hover:bg-muted">အော်ဒါစာရင်း</Link>
          <Button variant="outline" disabled={loading} onClick={() => {
            setLoading(true);
            setError("");
            setDateError(false);
            setPage(0);
            setRevision((value) => value + 1);
          }}>ပြန်တင်ရန်</Button>
          <Button disabled={!canPrint} onClick={() => window.print()}>Print / PDF ထုတ်ရန်</Button>
        </div>
      </header>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="စတော့ရှာရန်" placeholder="ပစ္စည်း၊ Barcode၊ Batch ရှာရန်"
          className="h-11 min-w-48 flex-1 sm:max-w-sm" value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
        <select aria-label="စတော့အခြေအနေ" className="h-11 rounded-md border bg-background px-3 text-sm"
          value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}>
          {filters.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {dateError && <p role="status" className="text-sm text-muted-foreground">ထုပ်ပိုးရက် မှတ်တမ်း ရယူ၍မရပါ။</p>}
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
            <h1>ထုပ်ပိုးပြီး စတော့စာရင်း</h1>
            <p>စာရင်းရယူချိန် · {loadedAt?.toLocaleString()}</p>
            <p>စစ်ထုတ်မှု · {filters.find((item) => item.value === filter)?.label} · စာရင်း {filtered.length.toLocaleString()} ကြောင်း</p>
            {query.trim() && <p>ရှာဖွေထားသော စာသား · {query.trim()}</p>}
          </header>
          <StockTable dates={dates} rows={filtered} />
        </article>,
        document.body,
      )}
    </main>
  );
}
