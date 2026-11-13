"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Customer = { id: string; name: string; code: string; type: string };
type Order = {
  orderId: string; orderNumber: string; customer: Customer;
  deliveryDate: string; currency: string; total: string;
  fulfillmentStatus: string; phone?: string; address?: string;
  lines: {
    orderLineReference: string; productName: string; orderedQuantity: string;
    dispatchedQuantity: string; remainingToDispatchQuantity: string;
    batch: string; saleUnit: string;
  }[];
};

function strings(value: unknown, keys: string[]) {
  return object(value) && keys.every((key) => typeof value[key] === "string");
}

function decodeOrder(value: unknown): Order {
  if (!object(value) ||
    !strings(value, ["orderId", "orderNumber", "deliveryDate", "currency", "total", "fulfillmentStatus"]) ||
    value.orderStatus !== "CONFIRMED" ||
    !strings(value.customer, ["id", "name", "code", "type"]) ||
    !Array.isArray(value.lines) ||
    !value.lines.every((line: unknown) => strings(line, [
      "orderLineReference", "productName", "orderedQuantity", "dispatchedQuantity",
      "remainingToDispatchQuantity", "batch", "saleUnit",
    ]))) {
    throw new Error("အော်ဒါ API မှ ရရှိသော အချက်အလက်ပုံစံ မမှန်ပါ။");
  }
  return value as unknown as Order;
}

async function readOrders(signal: AbortSignal) {
  const orders = new Map<string, Order>();
  const size = 100;
  for (let page = 0; page < 10000; page++) {
    const response = await fetch(`/api/factory/dispatches/sources?page=${page}&size=${size}`, {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
    if (response.status === 401) throw new Error("ဝင်ရောက်မှု သက်တမ်းကုန်ပါပြီ။ ပြန်ဝင်ပေးပါ။");
    if (response.status === 403) throw new Error("အော်ဒါစာရင်း ကြည့်ခွင့် မရှိပါ။");
    if (!response.ok) throw new Error(`အော်ဒါစာရင်း ရယူ၍မရပါ။ (${response.status})`);
    const data: unknown = await response.json();
    if (!object(data) || !Array.isArray(data.content) ||
      data.page !== page || data.size !== size ||
      typeof data.totalElements !== "number" || !Number.isSafeInteger(data.totalElements) ||
      data.totalElements < 0) throw new Error("စာမျက်နှာ အချက်အလက် မမှန်ပါ။");
    for (const item of data.content) {
      const order = decodeOrder(item);
      orders.set(order.orderId, order);
    }
    if ((page + 1) * size >= data.totalElements && orders.size === data.totalElements) {
      return [...orders.values()].sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
    }
    if (!data.content.length || (page + 1) * size >= data.totalElements) break;
  }
  throw new Error("အော်ဒါစာရင်း မပြည့်စုံပါ။ ပြန်တင်ကြည့်ပါ။");
}

const statusLabels: Record<string, string> = {
  NOT_DISPATCHED: "ပို့ရန်ကျန်",
  PARTIALLY_DISPATCHED: "တစ်စိတ်တစ်ပိုင်း ပို့ပြီး",
  DISPATCHED: "ပို့ပြီး",
};

const statusColors: Record<string, string> = {
  DISPATCHED: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800",
  PARTIALLY_DISPATCHED: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800",
  NOT_DISPATCHED: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800",
};

function DeliveryStatus({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusColors[status] ?? "bg-muted text-muted-foreground ring-border"}`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {statusLabels[status] ?? "အခြေအနေ မရရှိသေးပါ"}
    </span>
  );
}

function localDateKey() {
  const date = new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-");
}

function DeliveryDate({ order, today }: { order: Order; today: string }) {
  const { deliveryDate, fulfillmentStatus } = order;
  const parsed = new Date(deliveryDate);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) &&
    Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === deliveryDate;
  if (!validDate) return <span className="text-muted-foreground">—</span>;

  const pending = fulfillmentStatus === "NOT_DISPATCHED" || fulfillmentStatus === "PARTIALLY_DISPATCHED";
  const timing = fulfillmentStatus === "DISPATCHED" ? "completed" :
    !pending || !today ? "unknown" :
    deliveryDate < today ? "overdue" : deliveryDate === today ? "today" : "upcoming";

  const styles = {
    completed: { label: "ပို့ပြီး", color: "text-emerald-700 dark:text-emerald-300" },
    today: { label: "ယနေ့ပို့ရန်", color: "text-amber-800 dark:text-amber-300" },
    upcoming: { label: "နောက်ရက်ပို့ရန်", color: "text-sky-700 dark:text-sky-300" },
    overdue: { label: "ပို့ရက်ကျော်", color: "text-red-700 dark:text-red-300" },
    unknown: { label: "", color: "text-muted-foreground" },
  };
  const { label, color } = styles[timing];

  return (
    <div className={`space-y-0.5 whitespace-nowrap ${color}`}>
      <time dateTime={deliveryDate} className="font-semibold tabular-nums">{deliveryDate}</time>
      {label && <p className="text-xs">{label}</p>}
    </div>
  );
}

const amount = (order: Order) => {
  const [whole, fraction] = order.total.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? "." + fraction : ""} ${order.currency === "MMK" ? "ကျပ်" : order.currency}`;
};

function escapePrintText(value: unknown): string {
  return (typeof value === "string" ? value : "—")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function openOrderPrint(order: Order): boolean {
  const preview = window.open("", "_blank", "popup,width=900,height=760");
  if (!preview) return false;
  preview.opener = null;
  const safe = escapePrintText;
  const rows = order.lines.map((line, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${safe(line.productName)}</td>
      <td>${safe(line.batch || "—")}</td>
      <td class="numeric">${safe(line.orderedQuantity)} ${safe(line.saleUnit)}</td>
    </tr>`).join("");

  preview.document.open();
  preview.document.write(`<!doctype html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Order ${safe(order.orderNumber)}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172132; background: #eef2f6; font: 13px/1.8 "Noto Sans Myanmar", "Myanmar Text", "Padauk", sans-serif; }
    main { width: min(100%, 210mm); min-height: 270mm; margin: 16px auto; padding: clamp(16px, 5vw, 42px); background: white; }
    header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; border-bottom: 2px solid #213b59; padding-bottom: 16px; }
    h1, h2, p, dl, dd { margin: 0; }
    h1 { font-size: 21px; }
    h2 { font-size: 14px; margin-bottom: 8px; }
    .muted { color: #45566a; }
    .details { margin: 20px 0; }
    dl { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px 18px; }
    dt { color: #45566a; } dd { font-weight: 600; overflow-wrap: anywhere; }
    .address { grid-column: 1 / -1; white-space: pre-wrap; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th, td { padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #edf2f7; }
    .numeric { text-align: right; font-variant-numeric: tabular-nums; }
    .total { width: fit-content; margin: 16px 0 0 auto; padding: 8px 16px; border: 1px solid #8493a6; font-weight: 700; break-inside: avoid; }
    .toolbar { width: min(100%, 210mm); margin: 12px auto; padding: 0 12px; text-align: right; }
    button { padding: 8px 16px; min-height: 44px; border: 0; border-radius: 6px; color: white; background: #213b59; font: inherit; cursor: pointer; }
    @media print {
      body { background: white; }
      main { width: auto; min-height: 0; margin: 0; padding: 0; }
      .toolbar { display: none; }
      tr, header, .details { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button id="print-order" type="button">Print / Save as PDF</button></div>
  <main>
    <header>
      <div><p class="muted">Binhlaig Factory</p><h1>အော်ဒါစာရွက်</h1></div>
      <div><p class="muted">အော်ဒါနံပါတ်</p><strong>${safe(order.orderNumber)}</strong></div>
    </header>
    <section class="details" aria-label="ဖောက်သည်နှင့် ပို့ဆောင်မှု">
      <dl>
        <div><dt>ဖောက်သည်</dt><dd>${safe(order.customer.name)} · ${safe(order.customer.code)}</dd></div>
        <div><dt>ပို့ဆောင်ရက်</dt><dd>${safe(order.deliveryDate)}</dd></div>
        <div><dt>ဖုန်း</dt><dd>${safe(order.phone || "—")}</dd></div>
        <div><dt>ပို့ဆောင်မှုအခြေအနေ</dt><dd>${safe(statusLabels[order.fulfillmentStatus] ?? order.fulfillmentStatus)}</dd></div>
        <div class="address"><dt>ပို့ဆောင်လိပ်စာ</dt><dd>${safe(order.address || "—")}</dd></div>
      </dl>
    </section>
    <h2>မှာယူထားသော ပစ္စည်းများ</h2>
    <table>
      <thead><tr>
        <th style="width:10%" scope="col">စဉ်</th>
        <th style="width:42%" scope="col">ပစ္စည်းအမည်</th>
        <th style="width:21%" scope="col">Batch</th>
        <th style="width:27%" scope="col" class="numeric">ပမာဏ</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="total">စုစုပေါင်း အော်ဒါတန်ဖိုး · ${safe(amount(order))}</p>
  </main>
</body>
</html>`);
  preview.document.close();
  preview.document.getElementById("print-order")?.addEventListener("click", () => {
    void preview.document.fonts.ready.then(() => preview.print());
  });
  return true;
}

function openTodayOrdersPrint(orders: Order[], date: string): boolean {
  const preview = window.open("", "_blank", "popup,width=1000,height=760");
  if (!preview) return false;
  preview.opener = null;
  const safe = escapePrintText;
  const rows = orders.map((order, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${safe(order.orderNumber)}</td>
      <td>${safe(order.customer.name)}<small>${safe(order.customer.code)}</small></td>
      <td>${safe(order.phone || "—")}<small>${safe(order.address || "—")}</small></td>
      <td>${safe(statusLabels[order.fulfillmentStatus] ?? "အခြေအနေ မရရှိသေးပါ")}</td>
      <td class="amount">${safe(amount(order))}</td>
    </tr>`).join("");

  preview.document.open();
  preview.document.write(`<!doctype html>
<html lang="my">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delivery orders - ${safe(date)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef2f6; color: #172132; font: 13px/1.7 "Noto Sans Myanmar", "Myanmar Text", Padauk, sans-serif; }
  main { width: min(100%, 297mm); margin: 12px auto; padding: 24px; background: white; }
  header { border-bottom: 2px solid #203b59; padding-bottom: 10px; margin-bottom: 14px; }
  h1, p { margin: 0; } h1 { font-size: 22px; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  th, td { border-bottom: 1px solid #bfcbd8; padding: 7px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #edf2f7; }
  tr, header { break-inside: avoid; }
  small { display: block; color: #46576b; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .toolbar { padding: 12px; text-align: right; }
  button { border: 0; border-radius: 6px; padding: 10px 16px; background: #203b59; color: white; font: inherit; cursor: pointer; }
  @media print {
    body { background: white; }
    main { width: auto; margin: 0; padding: 0; }
    .toolbar { display: none; }
  }
</style>
</head>
<body>
<div class="toolbar"><button type="button" id="print-orders">Print / Save as PDF</button></div>
<main>
  <header>
    <p>Binhlaig Factory · Office</p>
    <h1>ယနေ့ ပို့ဆောင်မည့် အော်ဒါစာရင်း</h1>
    <p>သတ်မှတ်ပို့ရက် · ${safe(date)} | အော်ဒါ ${orders.length.toLocaleString()} ခု</p>
  </header>
  <table>
    <thead><tr>
      <th scope="col">စဉ်</th><th scope="col">အော်ဒါနံပါတ်</th><th scope="col">ဖောက်သည်</th>
      <th scope="col">ဖုန်း / ပို့ဆောင်လိပ်စာ</th><th scope="col">ပို့ဆောင်မှု</th>
      <th scope="col" class="amount">အော်ဒါတန်ဖိုး</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</main>
</body>
</html>`);
  preview.document.close();
  preview.document.getElementById("print-orders")?.addEventListener("click", async () => {
    await preview.document.fonts.ready;
    preview.print();
  });
  return true;
}

function sessionScope(value: unknown): string | null {
  if (!object(value)) return null;
  const u = object(value.user) ? value.user : {}; let claims: Record<string, unknown> = {};
  if (typeof value.accessToken === "string") try {
    const p = value.accessToken.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    const parsed: unknown = JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,"="))); if (object(parsed)) claims = parsed;
  } catch { /* Claims scope local storage only; the BFF and Spring validate authentication. */ }
  const shop = u.shopId ?? value.shopId ?? claims.shopId ?? claims.shop_id;
  const account = u.id || u.userId || value.userId || claims.sub;
  return /^[1-9]\d*$/.test(String(shop ?? "")) && (typeof account === "number" || typeof account === "string") && String(account).trim()
    ? JSON.stringify([String(shop), String(u.accountType ?? claims.accountType ?? u.role ?? "ACCOUNT"), String(account)]) : null;
}

type View = "orders" | "customers";
type Tab = "items" | "dispatch" | "payments";
const pageSize = 12;

export function OfficeDirectory({ mode, customerId }: { mode: View; customerId?: string }) {
  const { status, data } = useSession();
  const scope = sessionScope(data);
  if (status === "loading") return <p role="status" className="p-5">စစ်ဆေးနေပါသည်…</p>;
  if (status !== "authenticated" || !scope) {
    return <p role="alert" className="p-5">ဆိုင်နှင့် ဝင်ရောက်မှု အချက်အလက်ကို ပြန်စစ်ပေးပါ။</p>;
  }
  return <Directory key={JSON.stringify([scope, customerId])} mode={mode} customerId={customerId} />;
}

function Directory({ mode, customerId }: { mode: View; customerId?: string }) {
  const [today, setToday] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printError, setPrintError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState<Order | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const isOrders = mode === "orders";

  useEffect(() => {
    const updateToday = () => setToday(localDateKey());
    updateToday();
    const timer = window.setInterval(updateToday, 60_000);
    window.addEventListener("focus", updateToday);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateToday);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void readOrders(controller.signal).then((rows) => {
      if (!controller.signal.aborted) setOrders(rows);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setOrders([]);
        setError(reason instanceof Error ? reason.message : "စာရင်း ရယူ၍မရပါ။");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  const customers = new Map<string, { customer: Customer; orders: Order[] }>();
  for (const row of orders) {
    const entry = customers.get(row.customer.id);
    if (entry) entry.orders.push(row);
    else customers.set(row.customer.id, { customer: row.customer, orders: [row] });
  }

  const matches = (...values: string[]) =>
    values.some((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const profile = customerId ? customers.get(customerId) : undefined;
  const latest = profile?.orders[0];
  const visibleOrders = (customerId ? profile?.orders ?? [] : orders).filter((row) =>
    (!filter || row.fulfillmentStatus === filter) &&
    matches(row.orderNumber, row.customer.name, row.customer.code, row.deliveryDate));
  const visibleCustomers = [...customers.values()].filter(({ customer: row }) =>
    (!filter || row.type === filter) && matches(row.name, row.code));
  const count = isOrders ? visibleOrders.length : visibleCustomers.length;
  const start = page * pageSize;
  const headers = isOrders
    ? ["အော်ဒါနံပါတ်", "ဖောက်သည်", "ပို့ရက်", "ပို့ဆောင်မှု", "အော်ဒါတန်ဖိုး", ...(customerId ? ["PDF"] : [])]
    : ["ဖောက်သည်", "ကုဒ်", "အမျိုးအစား", "အော်ဒါအရေအတွက်", "နောက်ဆုံးပို့ရက်"];

  function openOrder(row: Order) {
    setOrder(row);
    setTab("items");
  }

  const showTodayPrint = isOrders && !customerId;
  const todayCount = today ? orders.filter((row) => row.deliveryDate === today).length : 0;

  function printToday() {
    const date = localDateKey();
    const rows = orders.filter((row) => row.deliveryDate === date);
    if (!rows.length) {
      setToday(date);
      setPrintError("ယနေ့ သတ်မှတ်ပို့ရက်ရှိသော အော်ဒါ မတွေ့ပါ။");
      return;
    }
    setPrintError(openTodayOrdersPrint(rows, date) ? "" : "PDF preview ဖွင့်ရန် browser တွင် pop-up ခွင့်ပြုပေးပါ။");
  }

  function refresh() {
    setPrintError("");
    setLoading(true);
    setError("");
    setPage(0);
    setRevision((value) => value + 1);
  }

  return (
    <main lang="my" className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      {customerId && (
        <Link href="/factory/office/customers" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
          ← ဖောက်သည်စာရင်းသို့
        </Link>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            {customerId ? profile?.customer.name ?? "ဖောက်သည်အသေးစိတ်" : isOrders ? "အော်ဒါစာရင်း" : "ဖောက်သည်စာရင်း"}
          </h1>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">
            {customerId ? "ဖောက်သည်အချက်အလက်နှင့် အတည်ပြုပြီး အော်ဒါမှတ်တမ်း" : isOrders ? "အတည်ပြုပြီး ပို့ဆောင်မှုစာရင်းရှိ အော်ဒါများ" : "အတည်ပြုပြီး အော်ဒါရှိသော ဆိုင်နှင့် ဖောက်သည်များ"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={refresh} disabled={loading}>ပြန်တင်ရန်</Button>
          {showTodayPrint && (
            <Button type="button" onClick={printToday} disabled={loading || Boolean(error) || todayCount === 0}>
              ယနေ့စာရင်း Print / PDF ({todayCount})
            </Button>
          )}
        </div>
      </header>

      {profile && (
        <section aria-label="ဖောက်သည်အချက်အလက်" className="rounded-xl border bg-card p-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["ဖောက်သည်ကုဒ်", profile.customer.code],
              ["အမျိုးအစား", profile.customer.type === "SHOP" ? "ဆိုင်" : "ဖောက်သည်"],
              ["အတည်ပြုပြီး အော်ဒါ", profile.orders.length],
              ["နောက်ဆုံးအော်ဒါပါ ဖုန်း", latest?.phone],
              ["နောက်ဆုံးအော်ဒါပါ ပို့ဆောင်လိပ်စာ", latest?.address],
              ["နောက်ဆုံးသတ်မှတ်ထားသော ပို့ရက်", latest?.deliveryDate],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words font-medium">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {profile && <h2 className="text-lg font-semibold">အော်ဒါမှတ်တမ်း</h2>}
      {(!customerId || profile) && <div className="flex flex-wrap gap-2">
        <Input className="h-11 min-w-52 flex-1 sm:max-w-sm" aria-label="စာရင်းရှာရန်"
          placeholder={isOrders ? "အော်ဒါနံပါတ်၊ ဖောက်သည်၊ ပို့ရက် ရှာရန်" : "ဖောက်သည်အမည် သို့မဟုတ် ကုဒ် ရှာရန်"}
          value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
        <select aria-label={isOrders ? "ပို့ဆောင်မှု အခြေအနေ" : "ဖောက်သည် အမျိုးအစား"}
          className="h-11 rounded-md border bg-background px-3 text-sm"
          value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}>
          <option value="">အားလုံး</option>
          {Object.entries(isOrders ? statusLabels : { SHOP: "ဆိုင်", CUSTOMER: "ဖောက်သည်" })
            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>}

      {printError && <p role="alert" className="text-sm text-destructive">{printError}</p>}
      {loading ? <p role="status" className="rounded-xl border p-5">စာရင်း ရယူနေပါသည်…</p>
        : error ? <p role="alert" className="rounded-xl border p-5 text-destructive">{error}</p>
        : !count ? <p role="status" className="rounded-xl border p-5">{customerId && !profile ? "ဤဖောက်သည်အတွက် အတည်ပြုပြီး အော်ဒါမှတ်တမ်း မတွေ့ပါ။" : "ကိုက်ညီသော စာရင်း မတွေ့ပါ။"}</p>
        : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="border-b bg-muted/50 text-muted-foreground">
                  <tr>{headers.map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {isOrders ? visibleOrders.slice(start, start + pageSize).map((row) => (
                    <tr key={row.orderId} className="hover:bg-muted/30">
                      <td className="px-4"><Button variant="link" className="min-h-11 px-0" onClick={() => openOrder(row)}>{row.orderNumber}</Button></td>
                      <td className="px-4">{row.customer.name}</td>
                      <td className="px-4 py-2"><DeliveryDate order={row} today={today} /></td>
                      <td className="px-4 py-2"><DeliveryStatus status={row.fulfillmentStatus} /></td>
                      <td className="whitespace-nowrap px-4 tabular-nums">{amount(row)}</td>
                      {customerId && (
                        <td className="px-4 py-2">
                          <Button variant="outline" className="whitespace-nowrap" type="button"
                            aria-label={`${row.orderNumber} PDF ထုတ်ရန်`}
                            onClick={() => setPrintError(openOrderPrint(row) ? "" : "PDF preview ဖွင့်ရန် browser တွင် pop-up ခွင့်ပြုပေးပါ။")}>
                            PDF ထုတ်ရန်
                          </Button>
                        </td>
                      )}
                    </tr>
                  )) : visibleCustomers.slice(start, start + pageSize).map(({ customer: row, orders: history }) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-4"><Link href={`/factory/office/customers/${encodeURIComponent(row.id)}`} className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">{row.name}</Link></td>
                      <td className="px-4">{row.code}</td>
                      <td className="px-4">{row.type === "SHOP" ? "ဆိုင်" : "ဖောက်သည်"}</td>
                      <td className="px-4 tabular-nums">{history.length}</td>
                      <td className="whitespace-nowrap px-4">{history[0].deliveryDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm">
              <span>{start + 1}–{Math.min(start + pageSize, count)} / {count}</span>
              <div className="flex gap-2">
                <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>နောက်သို့</Button>
                <Button variant="outline" disabled={start + pageSize >= count} onClick={() => setPage(page + 1)}>ရှေ့သို့</Button>
              </div>
            </div>
          </div>
        )}

      <Dialog open={Boolean(order)} onOpenChange={(open) => {
        if (!open) setOrder(null);
      }}>
        {order && (
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{order.orderNumber}</DialogTitle>
              <DialogDescription>
                {`${order.customer.name} · ${order.deliveryDate} · ${amount(order)}`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="အော်ဒါအသေးစိတ်">
                {([["items", "ပစ္စည်းများ"], ["dispatch", "ထုပ်ပိုး / ပို့ဆောင်မှု"], ["payments", "ငွေပေးချေမှု"]] as const)
                  .map(([value, label]) => (
                    <Button key={value} aria-pressed={tab === value} variant={tab === value ? "default" : "outline"}
                      onClick={() => setTab(value)}>{label}</Button>
                  ))}
              </div>
              {tab === "payments" ? (
                <div className="space-y-2 rounded-xl border p-4 text-sm">
                  <p>အော်ဒါတန်ဖိုး · {amount(order)}</p>
                  <p className="text-muted-foreground">လက်ခံရရှိငွေနှင့် ရရန်ကျန်ငွေစာရင်း ရယူနိုင်သည့် API ချိတ်ဆက်ရန် ကျန်ပါသည်။</p>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  {tab === "dispatch" && (
                    <p className="rounded-lg bg-muted p-3 leading-7">
                      {statusLabels[order.fulfillmentStatus] ?? order.fulfillmentStatus} · ထုပ်ပိုးပြီးပမာဏစာရင်း ချိတ်ဆက်ရန် ကျန်ပါသည်။
                    </p>
                  )}
                  {order.lines.map((line) => (
                    <div key={line.orderLineReference} className="rounded-lg border p-3 leading-7">
                      <p className="font-medium">{line.productName} · {line.orderedQuantity} {line.saleUnit}</p>
                      {line.batch && <p className="text-muted-foreground">Batch · {line.batch}</p>}
                      {tab === "dispatch" && <p>ပို့ပြီး {line.dispatchedQuantity} · ကျန် {line.remainingToDispatchQuantity} {line.saleUnit}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </main>
  );
}
