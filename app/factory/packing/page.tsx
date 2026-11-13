"use client";
import * as React from "react";
import { useSession } from "next-auth/react";
import { useZxing } from "react-zxing";
import JsBarcode from "jsbarcode";
import { Barcode, Camera, Package, RefreshCw, ChevronLeft, ChevronRight, AlertCircle, Printer, ShoppingCart, Plus, Trash2, Save, Store, UserRound, UserPlus, Check, Copy, ArrowRight, Info, Minus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxInputGroup, ComboboxInput, ComboboxTrigger, ComboboxPortal, ComboboxPositioner, ComboboxPopup, ComboboxEmpty, ComboboxList, ComboboxItem, ComboboxItemIndicator } from "@/components/ui/combobox";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter, DrawerClose } from "@/components/ui/drawer";
import { motion } from "motion/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { historyPage, type Production } from "@/lib/production/factory-production-api";
import { requestJson, decodeBalances, decodePlaces, type Balance, type Place } from "@/lib/warehouse/factory-stock-api";
import { sheetRequest, type CostingSheet } from "@/lib/costing-api";
// Packing API owns accepted quotes, server orders and reservations. Production records supply detail only.
type Price = { value: number | null; discounted: number | null; currency: string; current: boolean };
type Product = {
  key: string; records: Production[]; sample: Production; produced: bigint;
  quote?: PackingQuote; remaining: string | null; stockWarning: string; price: Price;
};
type Data = { products: Product[]; warehouses: Place[]; warnings: string[]; updatedAt: string };
const PAGE_SIZE = 10;
function identity(itemId: number, version: number, warehouse: number, location: number, batch: string) {
  return JSON.stringify([itemId, version, warehouse, location, batch.trim().toUpperCase()]);
}
function productionKey(p: Production) {
  return identity(p.costingItemId, p.sourceVersion, p.warehouseId, p.locationId, p.outputBatch);
}
function balanceKey(b: Balance) {
  return identity(b.itemId, b.sourceVersion, b.warehouseId, b.locationId, b.batch);
}
function whole(value: string | null): bigint {
  if (value === null || !/^\d+(?:\.0+)?$/.test(value)) throw new Error("ထုတ်လုပ်ပြီး အထုပ်အရေအတွက် ပုံစံမမှန်ပါ။");
  return BigInt(value.split(".")[0]);
}
function amount(value: string | bigint | null) {
  if (value === null) return "မရသေးပါ";
  return (typeof value === "bigint" ? value : whole(value)).toLocaleString("en-US");
}
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function priceOf(p: Production, sheet?: CostingSheet): Price {
  const item = sheet?.status === "FINALIZED" ? sheet.items.find(i => i.id === p.costingItemId) : undefined;
  // Current finalized Costing prices take priority. Historical snapshots are labelled.
  const values = item?.calculation.ready ? item.calculation.values : p.snapshot.calculation?.values;
  return {
    value: numeric(values?.price), discounted: numeric(values?.discountedPrice),
    currency: item ? sheet!.currencyCode : p.currency, current: !!item && item.calculation.ready,
  };
}
function money(value: number | null, currency: string) {
  if (value === null) return "ဈေးမရသေးပါ";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: currency === "MMK" ? 0 : 2 }).format(value)} ${currency === "MMK" ? "ကျပ်" : currency}`;
}
function packageSize(p: Production) {
  const s = p.snapshot;
  const unit = s.packageSizeUnit === "unit" && ["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(s.productType)
    ? s.bulk?.baseUnit || s.packageSizeUnit : s.packageSizeUnit;
  return `${s.packageSize} ${unit}`;
}
function groupProducts(productions: Production[], balances: Balance[], sheets: Map<number, CostingSheet>, balanceAvailable: boolean): Product[] {
  const groups = new Map<string, Production[]>();
  const stock = new Map<string, Balance[]>();
  const ids = new Set<number>();
  for (const p of productions) {
    if (p.status !== "CONFIRMED" || ids.has(p.id)) continue;
    ids.add(p.id);
    const key = productionKey(p);
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  for (const b of balances) stock.set(balanceKey(b), [...(stock.get(balanceKey(b)) || []), b]);
  return [...groups].map(([key, records]) => {
    records.sort((a, b) => b.productionDate.localeCompare(a.productionDate) || b.id - a.id);
    const sample = records[0];
    const rows = stock.get(key) || [];
    // Some older stock queries repeat the same balance for multiple Receiving rows.
    // Never sum duplicate balances or assume a missing balance means zero.
    const quantities = new Set(rows.map(r => whole(r.quantity).toString()));
    const remaining = quantities.size === 1 ? [...quantities][0] : null;
    const stockWarning = !balanceAvailable ? "Warehouse လက်ကျန် ရယူမရပါ။"
      : quantities.size > 1 ? "တူညီသော Batch အတွက် လက်ကျန်များ မကိုက်ပါ။"
        : !rows.length ? "Warehouse မှ ဤ Production Batch ၏ လက်ကျန် မရသေးပါ။" : "";
    return { key, records, sample, produced: records.reduce((n, p) => n + whole(p.actualOutputQuantity), BigInt(0)), remaining, stockWarning, price: priceOf(sample, sheets.get(sample.costingSheetId)) };
  }).sort((a, b) => b.sample.productionDate.localeCompare(a.sample.productionDate) || b.sample.id - a.sample.id);
}
async function readProductions(signal: AbortSignal) {
  const records: Production[] = [];
  for (let page = 0; ; page++) {
    if (signal.aborted) throw new Error("Cancelled");
    const result = await historyPage(page, "CONFIRMED");
    records.push(...result.content);
    if (page + 1 >= result.totalPages) return records;
    if (page >= 9999) throw new Error("Production စာရင်းအလွန်များနေပါသည်။ Server search လိုအပ်ပါသည်။");
  }
}
async function readBalances(signal: AbortSignal) {
  const result: Balance[] = [];
  for (let page = 0; ; page++) {
    const part = decodeBalances(await requestJson(`/api/factory/stock/balances?page=${page}&size=100`, { signal }));
    if (part.page !== page || part.size !== 100) throw new Error("Warehouse pagination မမှန်ပါ။");
    result.push(...part.content);
    if ((page + 1) * 100 >= part.totalElements) return result;
    if (!part.content.length || page >= 9999) throw new Error("Warehouse စာရင်းအပြည့် မရပါ။");
  }
}
type PackingQuote = {
  costingSheetId: number; costingItemId: number; sourceVersion: number;
  warehouseId: number; locationId: number; batch: string; productionIds: number[];
  productName: string; barcode: string; packageSize: number; packageSizeUnit: string; saleUnit: string;
  currency: string; unitPrice: string | null; pricingVersion: number | null;
  onHandQuantity: string; reservedQuantity: string; availableQuantity: string; orderable: boolean;
};
class PackingError extends Error {
  constructor(public status: number, public code: string, public details: unknown, public uncertain = false) {
    super(({ STOCK_SHORTAGE: "လက်ရှိ ရောင်းနိုင်သော Stock မလုံလောက်ပါ။ စာရင်းပြန်တင်ပြီး အရေအတွက်ပြင်ပါ။", PRICE_CHANGED: "ရောင်းဈေး / Pricing version ပြောင်းထားပါသည်။ ဈေးအသစ်ကို စစ်ပြီး အတည်ပြုပါ။", STALE_VERSION: "အော်ဒါကို အခြားနေရာမှ ပြင်ထားပါသည်။ မှတ်တမ်းမှ ပြန်ဖွင့်ပါ။", CONSTRAINT_CONFLICT: "ID ရှိပြီးသား သို့မဟုတ် အချက်အလက် မကိုက်ပါ။", INVALID_STATUS: "ဤအော်ဒါအခြေအနေတွင် ဆက်လုပ်၍မရပါ။", PRICE_UNAVAILABLE: "လက်ရှိ Costing ဈေး မရသေးပါ။", AUTH_REQUIRED: "Login ပြန်ဝင်ပါ။" } as Record<string,string>)[code] || code);
  }
}
async function packingRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/factory/packing-gateway/${path}`, { ...options, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }, signal: options.signal ?? AbortSignal.timeout(30000) }); }
  catch { throw new PackingError(0, "ဆက်သွယ်မှု မပြည့်စုံပါ။ မူလ Request ကိုသာ ပြန်စမ်းပါ။", null, true); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new PackingError(response.status, payload?.code || payload?.message || (response.status === 401 ? "AUTH_REQUIRED" : `API error ${response.status}`), payload?.details, response.status >= 500);
  if (!payload) throw new PackingError(502, "Server response ဖတ်မရပါ။", null, true);
  return payload as T;
}
async function packingPages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < 10000; page++) {
    const p = await packingRequest<{content:T[]; page:number; size:number; totalElements:number}>(`${path}${path.includes("?") ? "&" : "?"}page=${page}&size=100`, { signal });
    if (!Array.isArray(p.content) || p.page !== page || p.size !== 100 || !Number.isSafeInteger(p.totalElements) || p.totalElements < 0) throw new Error("Server pagination မမှန်ပါ။");
    all.push(...p.content);
    if (all.length >= p.totalElements) return all;
    if (!p.content.length) throw new Error("Server စာရင်း အပြည့်မရပါ။");
  }
  throw new Error("စာရင်းအလွန်များနေပါသည်။ Server filter လိုအပ်ပါသည်။");
}
function checkQuote(q: PackingQuote): PackingQuote {
  if (![q.costingSheetId,q.costingItemId,q.warehouseId,q.locationId].every(n=>Number.isSafeInteger(n)&&n>0) || !Number.isSafeInteger(q.sourceVersion) || q.sourceVersion < 0 || typeof q.batch !== "string" || typeof q.orderable !== "boolean") throw new Error("Packing stock identity မမှန်ပါ။");
  const physical = whole(q.onHandQuantity), reserved = whole(q.reservedQuantity), available = whole(q.availableQuantity);
  if (physical - reserved !== available) throw new Error("Packing stock အရေအတွက် မကိုက်ပါ။");
  if (q.unitPrice !== null) orderPrice(q.unitPrice);
  if (q.orderable && (q.unitPrice === null || !Number.isSafeInteger(q.pricingVersion) || Number(q.pricingVersion)<0)) throw new Error("Packing price quote မပြည့်စုံပါ။");
  return q;
}
async function load(signal: AbortSignal): Promise<Data> {
  const [productions, quotes, places] = await Promise.all([
    readProductions(signal), packingPages<PackingQuote>("packing/products", signal),
    requestJson("/api/factory/receivings/warehouses", { signal }).then(decodePlaces),
  ]);
  const groups = groupProducts(productions, [], new Map(), false);
  const quoteMap = new Map(quotes.map(checkQuote).map(q => [identity(q.costingItemId,q.sourceVersion,q.warehouseId,q.locationId,q.batch),q]));
  const products = groups.filter(p=>quoteMap.has(p.key)).map(p=>{
    const q=quoteMap.get(p.key)!;
    return { ...p, quote:q, remaining:q.availableQuantity, stockWarning:"", price:{value:q.unitPrice===null?null:Number(q.unitPrice), discounted:null, currency:q.currency, current:q.orderable} };
  });
  if (products.length !== quotes.length) throw new Error("Production အသေးစိတ်နှင့် Packing စာရင်း မကိုက်သေးပါ။ Refresh ပြန်လုပ်ပါ။");
  return { products, warehouses:places, warnings:[], updatedAt:new Date().toISOString() };
}

type LabelSize = "60x40" | "80x50";
type LabelValues = { name: string; weight: string; price: string; batch: string; barcode: string };
const LABEL_SIZES: Record<LabelSize, { width: number; height: number }> = {
  "60x40": { width: 60, height: 40 }, "80x50": { width: 80, height: 50 },
};
function labelCount(raw: string): number | null {
  return /^[1-9]\d{0,2}$/.test(raw) && Number(raw) <= 500 ? Number(raw) : null;
}
function escapeLabel(value: string): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, character => entities[character]);
}
function labelValues(product: Product, discounted: boolean): LabelValues {
  const p = product.sample;
  const value = discounted ? product.price.discounted : product.price.value;
  if (value === null || !Number.isFinite(value) || value < 0) throw new Error("ရောင်းဈေးမရသေးပါ။ Costing ကို အရင်စစ်ပါ။");
  if (!p.snapshot.productName.trim() || !p.outputBatch.trim()) throw new Error("ပစ္စည်းအမည်နှင့် Batch လိုအပ်ပါသည်။");
  if (!Number.isFinite(Number(p.snapshot.packageSize)) || Number(p.snapshot.packageSize) <= 0) throw new Error("တစ်ထုပ်ပါပမာဏ မမှန်ပါ။ Production ကို ပြန်စစ်ပါ။");
  if (!/^FC-[1-9]\d*-[1-9]\d*$/.test(p.barcode)) throw new Error("Costing Barcode (FC-12-34 ပုံစံ) မမှန်ပါ။");
  return { name: p.snapshot.productName, weight: packageSize(p), price: product.quote?.unitPrice != null && !discounted ? orderMoney(orderPrice(product.quote.unitPrice),product.quote.currency) : money(value, product.price.currency), batch: p.outputBatch, barcode: p.barcode };
}
function labelDocument(values: LabelValues, svg: string, size: LabelSize, copies: number, fontCSS = ""): string {
  const { width, height } = LABEL_SIZES[size];
  const label = `<article class="label"><div class="name fit">${escapeLabel(values.name)}</div><div class="weight fit">တစ်ထုပ်ပါပမာဏ · ${escapeLabel(values.weight)}</div><div class="price fit">${escapeLabel(values.price)}</div><div class="batch fit">Batch: ${escapeLabel(values.batch)}</div><div class="barcode">${svg}</div><div class="code fit">${escapeLabel(values.barcode)}</div></article>`;
  // All product text is escaped. SVG is generated locally by JsBarcode, never API HTML.
  return `<!doctype html><html lang="my"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Packing labels</title><style>
${fontCSS}
@page{size:${width}mm ${height}mm;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:"Myanmar Text","Noto Sans Myanmar",Pyidaungsu,Arial,sans-serif}
.toolbar{padding:12px;max-width:600px;font-size:13px;line-height:1.8;background:#f1f5f9}
.toolbar button{font:inherit;padding:8px 18px;margin-right:8px;cursor:pointer}.print-error{color:#b91c1c}
.label{width:${width}mm;height:${height}mm;padding:2mm;display:flex;flex-direction:column;align-items:stretch;break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always;background:white;color:black;overflow:hidden}
.label:last-child{break-after:auto;page-break-after:auto}
.fit{flex-shrink:0;overflow:hidden}.name{font-size:${size === "60x40" ? 11 : 14}px;font-weight:700;line-height:1.5;height:3em;overflow-wrap:anywhere;text-align:center}
.weight{font-size:${size === "60x40" ? 9 : 11}px;line-height:1.6;white-space:nowrap;text-align:center}
.price{font-size:${size === "60x40" ? 16 : 21}px;font-weight:800;line-height:1.45;white-space:nowrap;text-align:center}
.batch{font-size:${size === "60x40" ? 9 : 11}px;line-height:1.5;white-space:nowrap;text-align:center}
.barcode{margin-top:auto;flex-shrink:0;width:100%;height:${size === "60x40" ? 9 : 12}mm;background:#fff}
.barcode svg{display:block;width:100%;height:100%;background:#fff}
.code{font-family:Arial,sans-serif;font-size:9px;line-height:1.4;white-space:nowrap;text-align:center;letter-spacing:.2px}
@media screen{.label{outline:1px dashed #94a3b8;margin:12px auto}.toolbar{margin:0 auto}}
@media print{.toolbar{display:none!important}.label{margin:0;outline:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="toolbar"><button id="print-labels" type="button">Print / ပုံနှိပ်မည်</button><span>${copies} labels · ${width} × ${height} mm</span><p>Printer paper size ကို ${width} × ${height} mm၊ Scale 100%၊ Margins None၊ Headers/Footers Off ထားပါ။</p><p id="print-error" class="print-error" role="alert"></p></div>${Array.from({ length: copies }, () => label).join("")}</body></html>`;
}
function copiedFontCSS(): string {
  // Reuse only font-face rules already loaded by the project. No CDN is needed.
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) if (rule.type === CSSRule.FONT_FACE_RULE) {
        css += rule.cssText.replace(/url\(["']?([^)'"\s]+)["']?\)/g, (_, url: string) => `url("${new URL(url, sheet.href || document.baseURI).href}")`) + "\n";
      }
    } catch { /* Cross-origin styles cannot be inspected; system Myanmar fonts remain available. */ }
  }
  return css + `\nbody{font-family:${getComputedStyle(document.body).fontFamily},"Myanmar Text","Noto Sans Myanmar",sans-serif}`;
}
async function readyLabelDocument(doc: Document): Promise<void> {
  // Wait for Myanmar font loading before measuring or opening Print.
  void doc.body.offsetHeight;
  await Promise.race([doc.fonts.ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Font ရယူချိန်ကြာနေပါသည်။ ပြန်စမ်းပါ။")), 15000))]);
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>(".fit"))) {
    const minSize = element.classList.contains("name") ? 8 : element.classList.contains("price") ? 12 : 7;
    let fontSize = parseFloat(doc.defaultView!.getComputedStyle(element).fontSize);
    // Preserve the physical text box while reducing font size for long product names.
    const height = element.clientHeight;
    element.style.height = `${height}px`;
    while ((element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) && fontSize > minSize) {
      fontSize -= .5; element.style.fontSize = `${fontSize}px`;
    }
    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      throw new Error("စာသားရှည်လွန်းပါသည်။ 80 × 50 mm ရွေးပါ သို့မဟုတ် မူလပစ္စည်းအမည် / Batch ကို စစ်ပါ။");
  }
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>(".label")))
    if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)
      throw new Error("Label အတွင်း မဆံ့ပါ။ ပိုကြီးသော Label size ရွေးပါ။");
}
function PackingLabelDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [size, setSize] = React.useState<LabelSize>("80x50");
  const [copies, setCopies] = React.useState("1");
  const [discounted, setDiscounted] = React.useState(false);
  const [allowSnapshot, setAllowSnapshot] = React.useState(false);
  const [svg, setSvg] = React.useState("");
  const [barcodeError, setBarcodeError] = React.useState("");
  const [previewError, setPreviewError] = React.useState("");
  const [previewReady, setPreviewReady] = React.useState(false);
  const [printError, setPrintError] = React.useState("");
  const printing = React.useRef(false);
  const previewRevision = React.useRef(0);
  const count = labelCount(copies);
  let values: LabelValues | null = null, valueError = "";
  try { values = labelValues(product, discounted); }
  catch (e) { valueError = e instanceof Error ? e.message : "Label data မမှန်ပါ။"; }
  const valueKey = values ? JSON.stringify(values) : "";
  React.useEffect(() => {
    setSvg(""); setBarcodeError("");
    if (!valueKey) return;
    try {
      const data = JSON.parse(valueKey) as LabelValues;
      const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(element, data.barcode, { format: "CODE128", displayValue: false, width: 2, height: 50, margin: 0, marginLeft: 20, marginRight: 20, background: "#ffffff", lineColor: "#000000" });
      const pixelWidth = Number(element.getAttribute("width"));
      // Quiet zones are included. Refuse very narrow bars that would scan poorly.
      if ((LABEL_SIZES[size].width - 4) / (pixelWidth / 2) < .25)
        throw new Error("Barcode ရှည်လွန်းပါသည်။ ပိုကြီးသော Label size ရွေးပါ။");
      element.setAttribute("viewBox", `0 0 ${pixelWidth} ${element.getAttribute("height")}`);
      element.setAttribute("preserveAspectRatio", "none");
      element.setAttribute("aria-label", data.barcode);
      setSvg(new XMLSerializer().serializeToString(element));
    } catch (e) { setBarcodeError(e instanceof Error ? e.message : "Barcode ဖန်တီးမရပါ။"); }
  }, [valueKey, size]);
  const previewHTML = React.useMemo(() => {
    if (!svg || !valueKey) return "";
    return labelDocument(JSON.parse(valueKey) as LabelValues, svg, size, 1, copiedFontCSS()).replace("@media screen{", ".toolbar{display:none}@media screen{");
  }, [valueKey, svg, size]);
  React.useEffect(() => { setPreviewReady(false); setPreviewError(""); previewRevision.current++; }, [previewHTML]);
  const printLabels = async () => {
    if (printing.current || !values || !svg || !count || !previewReady || barcodeError || (!product.price.current && !allowSnapshot)) return;
    printing.current = true; setPrintError("");
    // Open directly inside the user click so tablet popup blockers can permit it.
    const popup = window.open("", "_blank");
    if (!popup) { printing.current = false; setPrintError("Print window ပိတ်ထားပါသည်။ Browser Pop-ups ကို Allow လုပ်ပြီး ပြန်နှိပ်ပါ။"); return; }
    try {
      popup.opener = null;
      popup.document.open();
      popup.document.write(labelDocument(values, svg, size, count, copiedFontCSS()));
      popup.document.close();
      const doc = popup.document;
      const printButton = doc.getElementById("print-labels") as HTMLButtonElement | null;
      if (printButton) printButton.disabled = true;
      await readyLabelDocument(doc);
      if (popup.closed) return;
      if (printButton) { printButton.disabled = false; printButton.onclick = () => { popup.focus(); popup.print(); }; }
      popup.focus(); popup.print();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Print ဖွင့်မရပါ။";
      setPrintError(message);
      if (!popup.closed) {
        const target = popup.document.getElementById("print-error");
        if (target) target.textContent = message;
      }
    } finally { printing.current = false; }
  };
  const canPrint = !!count && !!values && !!svg && previewReady && !barcodeError && (product.price.current || allowSnapshot);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>အထုပ်ကပ်တံဆိပ် ပုံနှိပ်ရန်</DialogTitle><DialogDescription>ပစ္စည်းအမည်၊ တစ်ထုပ်ပါပမာဏ၊ ရောင်းဈေး၊ Batch နှင့် Barcode</DialogDescription></DialogHeader>
    <div className="grid gap-5 md:grid-cols-[240px_1fr]"><div className="space-y-4">
      <div className="space-y-2"><Label htmlFor="label-size">Label အရွယ်အစား</Label><select id="label-size" value={size} onChange={e => setSize(e.target.value as LabelSize)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="80x50">80 × 50 mm</option><option value="60x40">60 × 40 mm</option></select></div>
      <div className="space-y-2"><Label htmlFor="label-copies">Label အရေအတွက်</Label><Input id="label-copies" type="number" min={1} max={500} step={1} inputMode="numeric" value={copies} onChange={e => setCopies(e.target.value)} aria-invalid={!count} /><p className="text-xs leading-6 text-muted-foreground">တစ်ကြိမ် ၁ မှ ၅၀၀ ရွက်အထိ</p>{!count && <p role="alert" className="text-sm text-destructive">၁ မှ ၅၀၀ အတွင်း အပြည့်ကိန်းဖြည့်ပါ။</p>}</div>
      {product.price.discounted !== null && product.price.value !== null && product.price.discounted < product.price.value && <label className="flex items-start gap-2 text-sm leading-7"><input type="checkbox" className="mt-2" checked={discounted} onChange={e => setDiscounted(e.target.checked)} />လျှော့ဈေးပြီး ရောင်းဈေးကို သုံးမည်</label>}
      {!product.price.current && <div className="rounded-xl bg-amber-50 p-3 text-sm leading-7 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><p>လက်ရှိ Costing ဈေးမရသေးပါ။ Snapshot ဈေးကိုသာ ရရှိထားပါသည်။</p><label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-2" checked={allowSnapshot} onChange={e => setAllowSnapshot(e.target.checked)} />ဤ Snapshot ဈေးကို စစ်ဆေးပြီး အသုံးပြုမည်</label></div>}
      <p className="text-xs leading-6 text-muted-foreground">Barcode သည် ပစ္စည်းကို ရှာရန်ဖြစ်သည်။ Batch ကို တံဆိပ်ပေါ်တွင် စာသားဖြင့် ဖော်ပြထားပါသည်။</p>
      <Button className="w-full" disabled={!canPrint} onClick={() => void printLabels()}><Printer className="mr-2 size-4" />{count || "—"} ရွက် ပုံနှိပ်မည်</Button>
    </div><div className="min-w-0 space-y-3"><p className="text-sm font-semibold">တံဆိပ်နမူနာ · {size.replace("x", " × ")} mm</p>
        {previewHTML ? <iframe title="Packing label preview" srcDoc={previewHTML} sandbox="allow-same-origin" className="h-[310px] w-full rounded-xl border bg-white" onLoad={async e => {
          const doc = e.currentTarget.contentDocument, revision = previewRevision.current;
          if (!doc) return;
          try { await readyLabelDocument(doc); if (revision === previewRevision.current) { setPreviewReady(true); setPreviewError(""); } }
          catch (e) { if (revision === previewRevision.current) { setPreviewReady(false); setPreviewError(e instanceof Error ? e.message : "Preview စစ်မရပါ။"); } }
        }} /> : <div className="rounded-xl border p-8 text-center text-muted-foreground">Label ပြင်ဆင်နေပါသည်…</div>}
        <p className="text-xs leading-6 text-muted-foreground">Printer တွင် တူညီသော Paper size၊ Scale 100%၊ Margin None နှင့် Header/Footer Off ရွေးပါ။</p>
        {[valueError, barcodeError, previewError, printError].filter(Boolean).map(message => <p key={message} role="alert" className="text-sm leading-7 text-destructive">{message}</p>)}
      </div></div>
  </DialogContent></Dialog>;
}
// Historical browser drafts are preserved for explicit import. Server orders carry separate ID/version/status.
type OrderBuyer = "SHOP" | "CUSTOMER";
type OrderLine = {
  key: string; costingSheetId: number; costingItemId: number; sourceVersion: number;
  warehouseId: number; locationId: number; batch: string; productionIds: number[];
  name: string; barcode: string; packageSize: string; saleUnit: string;
  pricingVersion?: number; quantity: string; unitPrice: string; currency: string; priceSource: "CURRENT_COSTING" | "PRODUCTION_SNAPSHOT";
};
type BrowserOrder = {
  serverId?: string; serverVersion?: number; serverStatus?: "DRAFT" | "CONFIRMED" | "CANCELLED"; orderNumber?: string;
  schema: 1; status: "BROWSER_DRAFT"; localId: string; revision: number; storageScope: string;
  buyerId?: string; buyerCode?: string; buyerType: OrderBuyer; buyerName: string; phone: string; address: string; deliveryDate: string; note: string;
  lines: OrderLine[]; updatedAt: string;
};
const ORDER_SCALE = BigInt(1000000);
const orderObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function orderSessionScope(value: unknown): string | null {
  if (!orderObject(value)) return null;
  const u = orderObject(value.user) ? value.user : {};
  let claims: Record<string, unknown> = {};
  // This scopes browser retry/legacy storage only. The backend authenticates every order operation.
  if (typeof value.accessToken === "string") try {
    const part = value.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (orderObject(decoded)) claims = decoded;
  } catch { /* An explicit session shop/account ID is preferred. */ }
  const shop = u.shopId ?? value.shopId ?? claims.shopId ?? claims.shop_id;
  const user = u.id || u.userId || value.userId || claims.sub;
  if (!/^[1-9]\d*$/.test(String(shop ?? "")) || typeof user !== "string" && typeof user !== "number" || !String(user).trim()) return null;
  return JSON.stringify([String(shop), String(u.accountType ?? claims.accountType ?? u.role ?? "ACCOUNT"), String(user)]);
}
function orderPrefix(scope: string) { return `binhlaig:factory:packing-orders:v1:${encodeURIComponent(scope)}:`; }
function newBrowserOrder(scope: string): BrowserOrder {
  const date = new Date();
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { schema: 1, status: "BROWSER_DRAFT", localId: crypto.randomUUID(), revision: 0, storageScope: scope, buyerType: "SHOP", buyerName: "", phone: "", address: "", deliveryDate: localDate, note: "", lines: [], updatedAt: "" };
}
function orderQuantity(raw: string): bigint | null { return /^[1-9]\d{0,23}$/.test(raw) ? BigInt(raw) : null; }
function orderPrice(raw: string): bigint {
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(raw)) throw new Error("အော်ဒါဈေးနှုန်း ပုံစံမမှန်ပါ။");
  const [w, f = ""] = raw.split("."); return BigInt(w) * ORDER_SCALE + BigInt(f.padEnd(6, "0"));
}
function exactOrderPrice(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value >= 1e12) throw new Error("ရောင်းဈေး ကန့်သတ်ချက်ကျော်နေပါသည်။");
  const raw = value.toFixed(6).replace(/\.?0+$/, "");
  const normalized = raw || "0";
  if (Number(normalized) !== value) throw new Error("ရောင်းဈေးသည် ဒဿမ ၆ နေရာထက်ကျော်နေပါသည်။");
  orderPrice(normalized); return normalized;
}
function orderMoney(value: bigint, currency: string): string {
  const w = value / ORDER_SCALE, f = String(value % ORDER_SCALE).padStart(6, "0").replace(/0+$/, "");
  return `${w.toLocaleString("en-US")}${f ? `.${f}` : ""} ${currency === "MMK" ? "ကျပ်" : currency}`;
}
function orderTotal(lines: OrderLine[]): bigint | null {
  let total = BigInt(0);
  for (const line of lines) { const q = orderQuantity(line.quantity); if (q === null) return null; total += orderPrice(line.unitPrice) * q; }
  return total;
}
function orderLineFrom(product: Product, quantity: string, discounted: boolean, allowSnapshot: boolean): OrderLine {
  if (!orderQuantity(quantity)) throw new Error("မှာယူမည့်အထုပ်အရေအတွက်ကို အပြည့်ကိန်း ဖြည့်ပါ။");
  if (!product.quote?.orderable || product.quote.unitPrice === null) throw new Error("လက်ရှိ Packing ဈေး မရသေးပါ။");
  if (product.remaining === null) throw new Error("Warehouse လက်ကျန် မရသေးပါ။ ပြန်တင်ပြီး စစ်ပါ။");
  if (!product.price.current && !allowSnapshot) throw new Error("Snapshot ဈေးကို စစ်ဆေးအတည်ပြုပါ။");
  const price = discounted ? product.price.discounted : product.price.value;
  if (price === null) throw new Error("Costing ရောင်းဈေး မရသေးပါ။");
  if (orderQuantity(quantity)! > whole(product.remaining)) throw new Error("လက်ရှိ Warehouse လက်ကျန်ထက် များနေပါသည်။");
  const p = product.sample;
  return { key: product.key, costingSheetId: p.costingSheetId, costingItemId: p.costingItemId, sourceVersion: p.sourceVersion, warehouseId: p.warehouseId, locationId: p.locationId, batch: p.outputBatch, productionIds: product.records.map(r => r.id), name: p.snapshot.productName, barcode: p.barcode, packageSize: packageSize(p), saleUnit: p.saleUnit, quantity, pricingVersion: product.quote?.pricingVersion ?? undefined, unitPrice: product.quote?.unitPrice ?? exactOrderPrice(price), currency: product.price.currency, priceSource: product.price.current ? "CURRENT_COSTING" : "PRODUCTION_SNAPSHOT" };
}
function mergeOrderLine(lines: OrderLine[], next: OrderLine, available: string): OrderLine[] {
  if (lines.length && lines[0].currency !== next.currency) throw new Error("ငွေကြေးမတူသောပစ္စည်းကို အော်ဒါတစ်ခုထဲ ထည့်မရပါ။");
  const old = lines.find(l => l.key === next.key);
  if (old && (orderPrice(old.unitPrice) !== orderPrice(next.unitPrice) || old.pricingVersion !== next.pricingVersion || old.priceSource !== next.priceSource)) throw new Error("ဤပစ္စည်း၏ မူကြမ်းဈေးနှင့် ယခုရွေးသောဈေး မတူပါ။ မူလလိုင်းကို ဖယ်ပြီးမှ ပြန်ထည့်ပါ။");
  if (old && orderQuantity(old.quantity) === null) throw new Error("မူလလိုင်း၏ အရေအတွက်ကို အရင်ပြင်ပါ။");
  const q = orderQuantity(next.quantity)! + (old ? orderQuantity(old.quantity) : BigInt(0))!;
  if (q > whole(available)) throw new Error("အော်ဒါထဲရှိပမာဏနှင့် ပေါင်းလျှင် လက်ကျန်ထက် များနေပါသည်။");
  if (old && orderQuantity(old.quantity) === null) throw new Error("မူလလိုင်း၏ အရေအတွက်ကို အရင်ပြင်ပါ။");
  if (!old && lines.length >= 100) throw new Error("မူကြမ်းတစ်ခုတွင် ပစ္စည်းလိုင်း ၁၀၀ အထိသာ ထည့်နိုင်ပါသည်။");
  const line = { ...(old || next), quantity: q.toString() };
  return old ? lines.map(l => l.key === next.key ? line : l) : [...lines, line];
}
function orderLineIssue(line: OrderLine, products: Product[]): string {
  const quantity = orderQuantity(line.quantity);
  if (quantity === null) return "အထုပ်အရေအတွက်ကို အပေါင်းအပြည့်ကိန်း ဖြည့်ပါ။";
  const p = products.find(p => p.key === line.key);
  if (!p || p.remaining === null) return "ဤ Batch ၏ လက်ကျန်ကို ပြန်စစ်ရန်လိုပါသည်။";
  if (quantity > whole(p.remaining)) return `လက်ကျန် ${amount(p.remaining)} ${line.saleUnit} ထက် များနေပါသည်။`;
  return "";
}
function validateBrowserOrder(order: BrowserOrder, products: Product[]): string[] {
  const errors: string[] = [];
  if (!order.buyerId || !order.buyerCode) errors.push("ပို့မည့် ဆိုင် / Customer ကို အရင်ရွေးပါ။");
  if (!order.buyerName.trim()) errors.push("ဆိုင် / Customer အမည် ဖြည့်ပါ။");
  if (order.buyerName.length > 200 || order.phone.length > 50 || order.address.length > 2000 || order.note.length > 2000) errors.push("ဖြည့်ထားသောစာသား အရှည်ကန့်သတ်ချက်ကျော်နေပါသည်။");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.deliveryDate) || !Number.isFinite(Date.parse(order.deliveryDate)) || new Date(order.deliveryDate).toISOString().slice(0, 10) !== order.deliveryDate) errors.push("မှန်ကန်သော ပို့မည့်ရက် ဖြည့်ပါ။");
  if (!order.lines.length) errors.push("ပစ္စည်း အနည်းဆုံးတစ်မျိုး ထည့်ပါ။");
  if (new Set(order.lines.map(l => l.currency)).size > 1) errors.push("အော်ဒါထဲတွင် ငွေကြေးအမျိုးအစား မတူပါ။");
  for (const line of order.lines) { const issue = orderLineIssue(line, products); if (issue) errors.push(`${line.name}: ${issue}`); }
  return errors;
}
function decodeBrowserOrder(raw: string, scope: string): BrowserOrder {
  const v: unknown = JSON.parse(raw);
  if (!orderObject(v) || v.schema !== 1 || v.status !== "BROWSER_DRAFT" || v.storageScope !== scope || typeof v.localId !== "string" || !/^[a-f0-9-]{36}$/i.test(v.localId) || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1 || !["SHOP", "CUSTOMER"].includes(String(v.buyerType)) || !["buyerName", "phone", "address", "deliveryDate", "note", "updatedAt"].every(k => typeof v[k] === "string") || !Array.isArray(v.lines) || v.lines.length > 100) throw new Error("Browser မူကြမ်းပုံစံ မမှန်ပါ။ မူလမှတ်တမ်းကို မဖျက်ဘဲ စစ်ပါ။");
  if ((v.buyerId !== undefined && (typeof v.buyerId !== "string" || !/^[a-f0-9-]{36}$/i.test(v.buyerId))) || (v.buyerCode !== undefined && (typeof v.buyerCode !== "string" || !validBuyerCode(v.buyerCode)))) throw new Error("မူကြမ်းဆိုင် / Customer ID မမှန်ပါ။");
  for (const l of v.lines) {
    if (!orderObject(l) || !["key", "batch", "name", "barcode", "packageSize", "saleUnit", "quantity", "unitPrice", "currency"].every(k => typeof l[k] === "string") || !["costingSheetId", "costingItemId", "warehouseId", "locationId"].every(k => Number.isSafeInteger(l[k]) && Number(l[k]) > 0) || !Number.isSafeInteger(l.sourceVersion) || Number(l.sourceVersion) < 0 || !Array.isArray(l.productionIds) || !l.productionIds.every(id => Number.isSafeInteger(id) && id > 0) || !["CURRENT_COSTING", "PRODUCTION_SNAPSHOT"].includes(String(l.priceSource)) || !orderQuantity(String(l.quantity)) || l.key !== identity(Number(l.costingItemId), Number(l.sourceVersion), Number(l.warehouseId), Number(l.locationId), String(l.batch))) throw new Error("မူကြမ်းပစ္စည်းစာရင်း ပုံစံမမှန်ပါ။");
    orderPrice(String(l.unitPrice));
  }
  if (new Set(v.lines.map(l => l.key)).size !== v.lines.length || new Set(v.lines.map(l => l.currency)).size > 1) throw new Error("မူကြမ်းလိုင်းများ မကိုက်ပါ။");
  return v as BrowserOrder;
}
function readBrowserOrders(scope: string): { orders: BrowserOrder[]; warning: string } {
  const orders: BrowserOrder[] = []; let invalid = 0;
  const prefix = orderPrefix(scope);
  for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) {
    try { const raw = localStorage.getItem(key); if (raw) { const draft = decodeBrowserOrder(raw, scope); if (key !== prefix + draft.localId) throw new Error("Draft key mismatch"); orders.push(draft); } } catch { invalid++; }
  }
  return { orders: orders.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), warning: invalid ? `ဖတ်မရသော Browser မူကြမ်း ${invalid} ခု ရှိပါသည်။ မူလ data ကို မဖျက်ထားပါ။` : "" };
}
function orderFingerprint(order: BrowserOrder) { return JSON.stringify(order); }
type ServerOrder = { id:string; orderNumber:string; status:"DRAFT"|"CONFIRMED"|"CANCELLED"; version:number; clientDraftId?:string; buyerId:string; customer:PackingBuyer; deliveryDate:string; phone:string; address:string; note:string; lines:(PackingQuote & {quantity:string; unitPrice:string})[] };
function fromServerOrder(o: ServerOrder, scope: string): BrowserOrder {
  return { schema:1,status:"BROWSER_DRAFT",localId:o.clientDraftId||o.id,revision:o.version+1,storageScope:scope,serverId:o.id,serverVersion:o.version,serverStatus:o.status,orderNumber:o.orderNumber,
    buyerId:o.buyerId,buyerCode:o.customer.code,buyerType:o.customer.type,buyerName:o.customer.name,phone:o.phone||"",address:o.address||"",deliveryDate:o.deliveryDate,note:o.note||"",updatedAt:new Date().toISOString(),
    lines:o.lines.map(l=>({key:identity(l.costingItemId,l.sourceVersion,l.warehouseId,l.locationId,l.batch),costingSheetId:l.costingSheetId,costingItemId:l.costingItemId,sourceVersion:l.sourceVersion,warehouseId:l.warehouseId,locationId:l.locationId,batch:l.batch,productionIds:l.productionIds,name:l.productName,barcode:l.barcode,packageSize:`${l.packageSize} ${l.packageSizeUnit}`,saleUnit:l.saleUnit,quantity:l.quantity,unitPrice:l.unitPrice,pricingVersion:l.pricingVersion??undefined,currency:l.currency,priceSource:"CURRENT_COSTING"})) };
}
type PackingCommand = { path:string; method:"POST"|"PUT"|"DELETE"; body:string; key:string; scope:string };
function pendingPackingCommand(prefix:string,scope:string):PackingCommand|null {
  for(const key of Object.keys(localStorage).filter(k=>k.startsWith(prefix+":")).sort()){
    const c=JSON.parse(localStorage.getItem(key)||"null") as PackingCommand;
    if(!c||c.scope!==scope||!/^orders(?:\/[a-f0-9-]{36}(?:\/(?:confirm|cancel|reprice))?)?$/.test(c.path)||!["POST","PUT","DELETE"].includes(c.method)||typeof c.body!=="string"||typeof c.key!=="string"||key!==`${prefix}:${c.key}`)throw new Error("Retry မှတ်တမ်းပုံစံ မမှန်ပါ။");
    JSON.parse(c.body);return c;
  }
  return null;
}
function usePackingOrder(scope: string | null, products: Product[], catalogReady: boolean) {
  const [draft,setDraft]=React.useState<BrowserOrder|null>(null), [saved,setSaved]=React.useState<BrowserOrder[]>([]), [base,setBase]=React.useState("");
  const [message,setMessage]=React.useState(""), [storageError,setStorageError]=React.useState(""), [saving,setSaving]=React.useState(false), [conflict,setConflict]=React.useState(false);
  const [pending,setPending]=React.useState<PackingCommand|null>(null);
  const scopeRef=React.useRef(scope); scopeRef.current=scope;
  const draftRef=React.useRef(draft), busy=React.useRef(false); draftRef.current=draft;
  const commandKey=scope ? `binhlaig:packing-api:pending:${encodeURIComponent(scope)}` : "";
  const install=(next:BrowserOrder)=>{draftRef.current=next;setDraft(next);setBase(orderFingerprint(next));setConflict(false);};
  const refreshSaved=React.useCallback(async()=>{
    if (!scope) return;
    const captured=scope;
    try { const list=await packingPages<ServerOrder>("orders"); if(scopeRef.current===captured) {setSaved(list.map(o=>fromServerOrder(o,captured)));setStorageError("");} }
    catch(e){if(scopeRef.current===captured)setStorageError(e instanceof Error?e.message:"Server အော်ဒါစာရင်း မရပါ။");}
  },[scope]);
  React.useEffect(()=>{
    setSaved([]);setMessage("");setConflict(false);setSaving(false);setPending(null);
    if(scope) install(newBrowserOrder(scope)); else {draftRef.current=null;setDraft(null);setBase("");}
    if(scope)try{const c=pendingPackingCommand(commandKey,scope);if(c){setPending(c);setMessage("မပြီးဆုံးသေးသော Request ရှိပါသည်။ မူလ Request ကို ပြန်စမ်းပါ။");}}catch(e){setStorageError(e instanceof Error?e.message:"Retry မှတ်တမ်းကို ဖတ်မရပါ။");}

    void refreshSaved();
  },[scope,refreshSaved]);
  const active=!!scope&&draft?.storageScope===scope;
  const locked=!!draft?.serverStatus&&draft.serverStatus!=="DRAFT";
  const dirty=!!draft&&orderFingerprint(draft)!==base;
  const patch=(update:Partial<BrowserOrder>)=>{const d=draftRef.current;if(!d||d.storageScope!==scopeRef.current||busy.current||pending||locked)return;const next={...d,...update};draftRef.current=next;setDraft(next);setMessage("");};
  const errors=draft?validateBrowserOrder(draft,products):["Login အချက်အလက် မရသေးပါ။"];
  const open=async(order:BrowserOrder|null)=>{
    if(!scope||busy.current||pending)return;
    if(!order?.serverId){install(newBrowserOrder(scope));setMessage("");return;}
    const captured=scope;busy.current=true;setSaving(true);
    try{const o=await packingRequest<ServerOrder>(`orders/${order.serverId}`);if(scopeRef.current===captured){install(fromServerOrder(o,captured));setMessage("");}}
    catch(e){if(scopeRef.current===captured)setMessage(e instanceof Error?e.message:"အော်ဒါ ဖွင့်မရပါ။");}finally{busy.current=false;if(scopeRef.current===captured)setSaving(false);}
  };
  const execute=async(command:PackingCommand)=>{
    if(busy.current||scopeRef.current!==command.scope)return;
    busy.current=true;setSaving(true);setMessage("");
    const storageKey=`${commandKey}:${command.key}`;
    let persisted=false;
    const settle=()=>{try{if(localStorage.getItem(storageKey)===JSON.stringify(command))localStorage.removeItem(storageKey);setPending(pendingPackingCommand(commandKey,command.scope));}catch{setPending(command);setStorageError("Retry မှတ်တမ်းကို မရှင်းနိုင်သေးပါ။ Browser Storage ကို စစ်ပါ။");}};
    try {
      // Persist exact bytes BEFORE a write. A lost response must reuse this request/key.
      const previous=localStorage.getItem(storageKey);
      if(previous&&previous!==JSON.stringify(command))throw new Error("မူလ Request နှင့် မကိုက်ပါ။");
      localStorage.setItem(storageKey,JSON.stringify(command));persisted=true;setPending(command);
      const o=await packingRequest<ServerOrder & {deleted?:boolean}>(command.path,{method:command.method,body:command.body,headers:{"Idempotency-Key":command.key}});
      if(scopeRef.current!==command.scope)return;
      if(command.method==="DELETE"){
        const sent=JSON.parse(command.body);
        if(o.deleted!==true||o.id!==command.path.split("/")[1]||o.version!==sent.version+1)throw new PackingError(502,"Deletion response could not be verified. Retry the original request.",null,true);
        settle();install(newBrowserOrder(command.scope));setMessage("Draft deleted. This cannot be undone through the UI.");
        await refreshSaved();window.dispatchEvent(new Event("factory-packing-changed"));return;
      }
      settle();install(fromServerOrder(o,command.scope));
      setMessage(o.status==="CONFIRMED"?"အော်ဒါ အတည်ပြုပြီးပါပြီ။ Stock ကို ကြိုဖယ်ထားပြီး ဖြစ်ပါသည်။":o.status==="CANCELLED"?"အော်ဒါ ပယ်ဖျက်ပြီးပါပြီ။ ကြိုဖယ်ထားသော Stock ပြန်လွတ်ပါပြီ။":"Server တွင် အော်ဒါမူကြမ်း သိမ်းပြီးပါပြီ။ Stock မဖယ်ထားသေးပါ။");
      void refreshSaved();window.dispatchEvent(new Event("factory-packing-changed"));
    } catch(e) {
      if(scopeRef.current!==command.scope)return;
      if(!persisted){setMessage("Retry မှတ်တမ်းကို Browser တွင် မသိမ်းနိုင်သဖြင့် Server သို့ မပို့ရသေးပါ။ Storage ကို စစ်ပါ။");return;}
      // PUT has no idempotency. Resolve its current version before allowing any retry.
      if(command.method==="PUT"&&e instanceof PackingError&&e.uncertain){
        try{const o=await packingRequest<ServerOrder>(command.path);const sent=JSON.parse(command.body);if(o.version>sent.version){settle();install(fromServerOrder(o,command.scope));setMessage("Server မှ နောက်ဆုံးအော်ဒါကို ပြန်ဖတ်ပြီးပါပြီ။ ပြင်ဆင်မှုကို စစ်ပါ။");void refreshSaved();return;}}
        catch{/* retain original PUT for safe version-checked retry */}
      }
      if(!(e instanceof PackingError)||!e.uncertain){settle();if(e instanceof PackingError&&e.code==="STALE_VERSION")setConflict(true);}
      if(e instanceof PackingError && ["PRICE_CHANGED","STOCK_SHORTAGE"].includes(e.code)) window.dispatchEvent(new Event("factory-packing-changed"));
      if(command.method==="DELETE"&&e instanceof PackingError){
        const messages:Record<number,string>={401:"Sign in again before retrying deletion.",403:"You do not have permission to delete this order.",404:"Order unavailable. Refresh the list; the current draft has been kept.",409:"Order changed or cannot be deleted. Reopen it from the server list before trying again."};
        setMessage(e.uncertain?"Deletion result is uncertain. Your draft and original request are retained. Retry to verify the result.":messages[e.status]||e.message);void refreshSaved();return;
      }
      setMessage(e instanceof Error?e.message:"အော်ဒါ သိမ်းမရပါ။");
    } finally {busy.current=false;if(scopeRef.current===command.scope)setSaving(false);}
  };
  const save=async()=>{
    const d=draftRef.current;if(!scope||!d||!active||locked||pending||busy.current)return;
    if(!catalogReady||errors.length){setMessage(errors[0]||"စာရင်းကို ပြန်တင်ပါ။");return;}
    if(d.lines.some(l=>!Number.isSafeInteger(l.pricingVersion))){setMessage("ပစ္စည်းဈေးအသစ်ကို ရွေးပြီးမှ သိမ်းပါ။");return;}
    const body={buyerId:d.buyerId,deliveryDate:d.deliveryDate,phone:d.phone.trim(),address:d.address.trim(),note:d.note.trim(),...(d.serverId?{version:d.serverVersion}:{clientDraftId:d.localId}),lines:d.lines.map(l=>({costingSheetId:l.costingSheetId,costingItemId:l.costingItemId,sourceVersion:l.sourceVersion,warehouseId:l.warehouseId,locationId:l.locationId,batch:l.batch,productionIds:l.productionIds,quantity:l.quantity,unitPrice:l.unitPrice,pricingVersion:l.pricingVersion,currency:l.currency}))};
    await execute({path:d.serverId?`orders/${d.serverId}`:"orders",method:d.serverId?"PUT":"POST",body:JSON.stringify(body),key:crypto.randomUUID(),scope});
  };
  const deleteDraft=async()=>{
    const d=draftRef.current;if(!scope||!d?.serverId||d.serverStatus!=="DRAFT"||busy.current||pending||dirty||conflict)return;
    if(!Number.isSafeInteger(d.serverVersion)||Number(d.serverVersion)<0){setMessage("Reopen the order to load its current version.");return;}
    await execute({path:"orders/"+d.serverId,method:"DELETE",body:JSON.stringify({version:d.serverVersion}),key:crypto.randomUUID(),scope});
  };
  const transition=async(action:"confirm"|"cancel"|"reprice")=>{
    const d=draftRef.current;if(!scope||!d?.serverId||busy.current||pending||dirty)return;
    let body:object={version:d.serverVersion};
    if(action==="reprice"){
      const lines=[];
      for(const l of d.lines){const q=products.find(p=>p.key===l.key)?.quote;if(!q?.orderable||q.unitPrice===null){setMessage(`${l.name}: လက်ရှိရောင်းဈေး မရပါ။`);return;}lines.push({costingItemId:l.costingItemId,sourceVersion:l.sourceVersion,warehouseId:l.warehouseId,locationId:l.locationId,batch:l.batch,pricingVersion:q.pricingVersion,unitPrice:q.unitPrice,currency:q.currency});}
      body={version:d.serverVersion,lines};
    }
    await execute({path:`orders/${d.serverId}/${action}`,method:"POST",body:JSON.stringify(body),key:crypto.randomUUID(),scope});
  };
  const add=(product:Product,qty:string,discounted:boolean,allowSnapshot:boolean)=>{
    const d=draftRef.current;if(!active||!d||!d.buyerId||!d.buyerCode)throw new Error("ဆိုင် / Customer ကို အရင်ရွေးပါ။");
    if(locked||pending||busy.current)throw new Error("မူကြမ်းအသစ်ဖွင့်ပြီးမှ ပစ္စည်းထည့်ပါ။");
    if(!catalogReady||!product.quote?.orderable)throw new Error("လက်ရှိဈေးနှင့် Stock ကို ပြန်စစ်ပါ။");
    const line=orderLineFrom(product,qty,false,false);patch({lines:mergeOrderLine(d.lines,line,product.remaining!)});
  };
  const importLocal=(old:BrowserOrder)=>{
    const d=draftRef.current;if(!scope||!d?.buyerId||busy.current||pending||locked){setMessage("Server ဆိုင် / Customer ကို အရင်ရွေးပါ။");return;}
    try{
      const lines=old.lines.map(l=>{const p=products.find(p=>p.key===l.key);if(!p)throw new Error(`${l.name}: လက်ရှိ Batch မတွေ့ပါ။`);return orderLineFrom(p,l.quantity,false,false);});
      const next={...old,localId:old.localId,revision:0,storageScope:scope,serverId:undefined,serverVersion:undefined,serverStatus:undefined,orderNumber:undefined,buyerId:d.buyerId,buyerCode:d.buyerCode,buyerType:d.buyerType,buyerName:d.buyerName,phone:d.phone,address:d.address,lines};
      draftRef.current=next;setDraft(next);setBase("");setMessage("ယခင်မူကြမ်းကို လက်ရှိဈေးဖြင့် ယူထားပါသည်။ စစ်ပြီး Server မူကြမ်းသိမ်းပါ။ မူလ Browser data ကို မဖျက်ထားပါ။");
    }catch(e){setMessage(e instanceof Error?e.message:"မူကြမ်း ယူမရပါ။");}
  };
  return { importLocal, draft:active?draft:null,saved,dirty,errors,message,storageError,conflict,saving,locked,pending,patch,add,open,save,refreshSaved,transition,deleteDraft,retry:()=>pending?execute(pending):Promise.resolve() };
}

type PackingBuyer = { id:string; type:OrderBuyer; name:string; code:string; phone:string; address:string; active:boolean; version:number };
type BuyerOption = { value: string; label: string };
function buyerCode(raw: string): string { return raw.trim().toUpperCase(); }
function validBuyerCode(raw: string): boolean { return /^[A-Z0-9][A-Z0-9._:-]{0,99}$/.test(raw) && !raw.startsWith("FC-"); }
function usePackingBuyers(scope: string | null) {
  const [items,setItems]=React.useState<PackingBuyer[]>([]),[message,setMessage]=React.useState("");
  const current=React.useRef(scope);current.current=scope;
  const refresh=React.useCallback(async()=>{
    if(!scope){setItems([]);return;}
    try{const rows=await packingPages<PackingBuyer>("customers?active=true");if(current.current===scope){setItems(rows);setMessage("");}}
    catch(e){if(current.current===scope)setMessage(e instanceof Error?e.message:"Customer စာရင်းမရပါ။");}
  },[scope]);
  React.useEffect(()=>{setItems([]);setMessage("");void refresh();},[refresh]);
  const add=async(input:{type:OrderBuyer;name:string;code:string;phone:string;address:string}):Promise<PackingBuyer>=>{
    if(!scope)throw new Error("Login ဆိုင်နှင့် အကောင့် ID လိုအပ်ပါသည်။");
    const code=buyerCode(input.code)||`CU-${crypto.randomUUID().replace(/-/g,"").toUpperCase()}`;
    if(!validBuyerCode(code))throw new Error("Customer ID ပုံစံမမှန်ပါ။");
    // Check exact code before POST; repeating after a lost response safely resolves it.
    const lookup=await packingRequest<{results:{type:string;customer?:PackingBuyer}[]}>(`packing/lookup?barcode=${encodeURIComponent(code)}`);
    const existing=lookup.results.find(r=>r.type==="CUSTOMER")?.customer;
    if(existing){
      if(current.current!==scope)throw new Error("အကောင့်ပြောင်းထားပါသည်။");
      if(existing.type===input.type&&existing.name===input.name.trim()&&(existing.phone||"")===input.phone.trim()&&(existing.address||"")===input.address.trim()){
        if(current.current!==scope)throw new Error("အကောင့်ပြောင်းထားပါသည်။");setItems(old=>[...old.filter(b=>b.id!==existing.id),existing]);void refresh();return existing;
      }
      void refresh();throw new Error("ဤ ID ရှိပြီးသားပါ။ စာရင်းမှ ရွေးပါ။");
    }
    const result=await packingRequest<PackingBuyer>("customers",{method:"POST",body:JSON.stringify({...input,code,name:input.name.trim(),phone:input.phone.trim(),address:input.address.trim(),active:true})});
    if(current.current!==scope)throw new Error("အကောင့်ပြောင်းထားပါသည်။");
    setItems(old=>[...old.filter(b=>b.id!==result.id),result]);void refresh();return result;
  };
  return {items,message,add,refresh};
}

function PackingBuyerPicker({ items, selectedId, onSelect, onAdd, disabled = false }: { items: PackingBuyer[]; selectedId?: string; onSelect: (buyer: PackingBuyer) => void; onAdd: () => void; disabled?: boolean }) {
  const options: BuyerOption[] = items.map(b => ({ value: b.id, label: `${b.name} · ${b.code}${b.phone ? ` · ${b.phone}` : ""}` }));
  const selected = options.find(option => option.value === selectedId) || null;
  const [expanded, setExpanded] = React.useState(false);
  const filterId = `buyer-goo-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return <motion.div className="relative h-12 max-w-full" initial={false} animate={{ width: expanded ? 360 : 150 }} transition={{ type: "spring", duration: .4, bounce: .25 }}>
    <svg aria-hidden="true" className="absolute size-0"><defs><filter id={filterId} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" /><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="goo" /><feComposite in="SourceGraphic" in2="goo" operator="atop" /></filter></defs></svg>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ filter: `url(#${filterId})` }}>
      <motion.span className="absolute left-0 top-1 size-10 rounded-full bg-foreground" animate={{ scale: expanded ? 1 : .85 }} transition={{ type: "spring", duration: .4, bounce: .25 }} />
      <motion.span className="absolute inset-y-0 right-0 rounded-full bg-foreground" animate={{ left: expanded ? 44 : 0 }} transition={{ type: "spring", duration: .4, bounce: .25 }} />
    </div>
    <span aria-hidden="true" className="pointer-events-none absolute left-0 top-1 z-30 flex size-10 items-center justify-center text-background"><Search className="size-4 shrink-0" strokeWidth={2.25} /></span>
    {!expanded ? (
      <button type="button" disabled={disabled} onClick={() => setExpanded(true)} aria-label="Shop ရွေးရန်" aria-haspopup="listbox" aria-expanded={false}
        className="absolute inset-0 z-10 flex w-full items-center rounded-full bg-transparent pl-10 pr-3 text-left text-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        <span className="truncate">Shop ရွေးရန်</span>
      </button>
    ) : (
      <Combobox<BuyerOption> items={options} value={selected} disabled={disabled} open={expanded} onOpenChange={open => setExpanded(open)} itemToStringLabel={item => item.label} isItemEqualToValue={(a, b) => a.value === b.value} onValueChange={option => { const buyer = items.find(b => b.id === option?.value); if (buyer) { onSelect(buyer); setExpanded(false); } }}>
        <div className="relative ml-11">
          <ComboboxInputGroup className="min-h-12 rounded-full border-0 !bg-transparent !text-background shadow-none ring-0">
            <ComboboxInput autoFocus id="packing-buyer-select" placeholder="ဆိုင် / Customer အမည်၊ ID ရှာရန်…" aria-label="ဆိုင် / Customer အမည်၊ ID၊ ဖုန်းဖြင့် ရှာရန်" className="h-12 min-w-0 rounded-full !bg-transparent !text-background placeholder:!text-background/70" />
            <ComboboxTrigger className="!border-0 !bg-transparent !text-background !shadow-none hover:!bg-transparent hover:!text-background active:!bg-transparent data-[popup-open]:!bg-transparent data-[popup-open]:!text-background" aria-label="ဆိုင် / Customer စာရင်းဖွင့်ရန်" />
          </ComboboxInputGroup>
        </div>
        <ComboboxPortal><ComboboxPositioner className="z-[70]"><ComboboxPopup className="min-w-72"><ComboboxEmpty>ဆိုင် / Customer မတွေ့ပါ။ Add Customer မှ ထည့်ပါ။</ComboboxEmpty><ComboboxList>{(option: BuyerOption) => { const buyer = items.find(b => b.id === option.value); if (!buyer) return null; return <ComboboxItem key={option.value} value={option} className="gap-3 py-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{buyer.type === "SHOP" ? <Store className="size-4" /> : <UserRound className="size-4" />}</span><span className="min-w-0"><span className="block truncate font-medium">{buyer.name}</span><span className="block text-xs leading-6 text-muted-foreground">{buyer.code} · {buyer.type === "SHOP" ? "ဆိုင်" : "Customer"}{buyer.phone ? ` · ${buyer.phone}` : ""}</span></span><ComboboxItemIndicator /></ComboboxItem>; }}</ComboboxList><div className="border-t p-2"><Button type="button" variant="ghost" className="w-full justify-start gap-2" onClick={() => { setExpanded(false); onAdd(); }}><UserPlus className="size-4" />Add Customer</Button></div></ComboboxPopup></ComboboxPositioner></ComboboxPortal>
      </Combobox>
    )}
  </motion.div>;
}
function AddPackingBuyer({ initialCode = "", onSave, onClose }: { initialCode?: string; onSave: (input: { type: OrderBuyer; name: string; code: string; phone: string; address: string }) => Promise<void>; onClose: () => void }) {
  const [type, setType] = React.useState<OrderBuyer>("SHOP"), [name, setName] = React.useState(""), [code, setCode] = React.useState(initialCode), [phone, setPhone] = React.useState(""), [address, setAddress] = React.useState("");
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""); const locked = React.useRef(false); const autoCode = React.useRef("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (locked.current) return; locked.current = true; setBusy(true); setError("");
    try { if(!autoCode.current) autoCode.current=`CU-${crypto.randomUUID().replace(/-/g,"").toUpperCase()}`; const stableCode=code.trim()||autoCode.current; setCode(stableCode); await onSave({ type, name, code:stableCode, phone, address }); }
    catch (e) { setError(e instanceof DOMException && e.name === "QuotaExceededError" ? "Browser Storage ပြည့်နေသဖြင့် Customer မသိမ်းနိုင်ပါ။" : e instanceof Error ? e.message : "သိမ်းမရပါ။"); }
    finally { locked.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>ဆိုင် / Customer အသစ်ထည့်ရန်</DialogTitle><DialogDescription>တစ်ကြိမ်သိမ်းပြီးနောက် ID scan သို့မဟုတ် စာရင်းမှ အမြန်ရွေးနိုင်ပါမည်။</DialogDescription></DialogHeader><form onSubmit={e => void submit(e)} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
    <div className="grid grid-cols-2 gap-2">{(["SHOP", "CUSTOMER"] as const).map(value => <Button key={value} type="button" variant={type === value ? "default" : "outline"} onClick={() => setType(value)}>{value === "SHOP" ? <Store className="mr-2 size-4" /> : <UserRound className="mr-2 size-4" />}{value === "SHOP" ? "ဆိုင်" : "Customer"}</Button>)}</div>
    <div className="space-y-2"><Label htmlFor="buyer-add-name">{type === "SHOP" ? "ဆိုင်အမည်" : "Customer အမည်"} *</Label><Input autoFocus required id="buyer-add-name" value={name} maxLength={200} onChange={e => setName(e.target.value)} placeholder="အမည်ဖြည့်ပါ" /></div>
    <div className="space-y-2"><Label htmlFor="buyer-add-code">ID / Barcode</Label><Input id="buyer-add-code" value={code} maxLength={100} onChange={e => setCode(e.target.value)} placeholder="အလွတ်ထားလျှင် ID အလိုအလျောက် ထုတ်ပေးမည်" className="font-mono" /><p className="text-xs leading-6 text-muted-foreground">ရှိပြီးသား ID ကတ် Barcode ကို Scan / ရိုက်ထည့်နိုင်ပါသည်။</p></div>
    <div className="space-y-2"><Label htmlFor="buyer-add-phone">ဖုန်း</Label><Input id="buyer-add-phone" type="tel" value={phone} maxLength={100} onChange={e => setPhone(e.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="buyer-add-address">ပို့မည့်လိပ်စာ</Label><textarea id="buyer-add-address" value={address} rows={3} maxLength={1000} onChange={e => setAddress(e.target.value)} className="w-full rounded-xl border bg-background p-3 text-sm" /></div>
    {error && <p role="alert" className="text-sm leading-7 text-destructive">{error}</p>}<p className="text-xs leading-6 text-muted-foreground">Server ၏ ဆိုင် / Customer စာရင်းထဲ သိမ်းပါမည်။</p><Button type="submit" className="w-full" disabled={!name.trim() || busy}><Check className="mr-2 size-4" />{busy ? "သိမ်းနေသည်…" : "သိမ်းပြီး ရွေးမည်"}</Button>
  </fieldset></form></DialogContent></Dialog>;
}
function PackingBuyerBarcode({ buyer, onClose }: { buyer: PackingBuyer; onClose: () => void }) {
  const [error, setError] = React.useState(""), [copied, setCopied] = React.useState(false);
  const ref = React.useCallback((node: SVGSVGElement | null) => { if (!node) return; try { JsBarcode(node, buyer.code, { format: "CODE128", width: 2, height: 60, margin: 20, displayValue: false }); } catch { setError("ID Barcode ဖန်တီးမရပါ။"); } }, [buyer.code]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{buyer.name}</DialogTitle><DialogDescription>ဆိုင် / Customer ရွေးရန် Scan ဖတ်နိုင်သော ID Barcode</DialogDescription></DialogHeader><div className="overflow-x-auto rounded-2xl border bg-white p-4"><svg ref={ref} role="img" aria-label={buyer.code} className="mx-auto h-24 max-w-none" /></div><p className="break-all text-center font-mono text-lg font-semibold">{buyer.code}</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button variant="outline" onClick={() => { if (!navigator.clipboard) { setError("Copy မရပါ။ အထက်ပါ ID ကို ရွေးပြီး ကူးယူပါ။"); return; } void navigator.clipboard.writeText(buyer.code).then(() => setCopied(true)).catch(() => setError("Copy မရပါ။ အထက်ပါ ID ကို ရွေးပြီး ကူးယူပါ။")); }}>{copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}{copied ? "ID ကူးယူပြီး" : "Copy ID"}</Button></DialogContent></Dialog>;
}

function PackingOrderDrawer({ order, products, catalogReady, buyerReady, onClose }: { order: ReturnType<typeof usePackingOrder>; products: Product[]; catalogReady: boolean; buyerReady: boolean; onClose: () => void }) {
  const [selectedDraft, setSelectedDraft] = React.useState("");
  React.useEffect(() => { if (!order.draft?.serverId) setSelectedDraft(""); }, [order.draft?.serverId]);
  const [legacy,setLegacy]=React.useState<BrowserOrder[]>([]),[legacyId,setLegacyId]=React.useState("");
  React.useEffect(()=>{try{setLegacy(order.draft?readBrowserOrders(order.draft.storageScope).orders:[]);}catch{setLegacy([]);}},[order.draft?.storageScope]);
  const [pending, setPending] = React.useState<{ kind: "open"; draft: BrowserOrder | null } | { kind: "remove"; key: string } | { kind: "confirm" | "cancel" | "reprice" | "delete" } | {kind:"import";draft:BrowserOrder} | null>(null);
  const d = order.draft, total = d ? orderTotal(d.lines) : null;
  const choose = (next: BrowserOrder | null) => { if (order.dirty) setPending({ kind: "open", draft: next }); else order.open(next); };
  const bump = (line: OrderLine, step: number) => {
    const qty = orderQuantity(line.quantity); if (!d || qty === null) return;
    const next = qty + BigInt(step), live = products.find(p => p.key === line.key);
    if (next < BigInt(1) || !live || live.remaining === null || next > whole(live.remaining)) return;
    order.patch({ lines: d.lines.map(l => l.key === line.key ? { ...l, quantity: next.toString() } : l) });
  };
  return <><Drawer open swipeDirection="right" onOpenChange={open => { if (!open) onClose(); }}><DrawerContent side="right" className="w-full sm:w-[34rem]" showHandle={false}>
    <DrawerHeader className="border-b pb-4 text-left"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShoppingCart className="size-5" /></span><div><DrawerTitle>အော်ဒါ Cart</DrawerTitle><DrawerDescription>{d?.lines.length || 0} မျိုး · {d?.orderNumber || "မူကြမ်းအသစ်"} · {d?.serverStatus || "မသိမ်းရသေး"}</DrawerDescription></div></div><DrawerClose aria-label="Cart ပိတ်ရန်" /></div></DrawerHeader>
    <DrawerBody className="space-y-4 px-4 py-4 sm:px-6">
    {!d ? <p role="alert" className="rounded-xl bg-destructive/5 p-4 text-sm leading-7 text-destructive">Login ဆိုင်နှင့် အကောင့် ID မရသေးပါ။</p> : <fieldset disabled={order.saving || !!order.pending} className="min-w-0 space-y-5">
      <div className="flex gap-2"><select aria-label="Server အော်ဒါမှတ်တမ်း" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-2 text-sm" value={selectedDraft} onChange={e => setSelectedDraft(e.target.value)}><option value="">Server အော်ဒါရွေးရန်</option>{order.saved.map(s => <option key={s.localId} value={s.localId}>{s.buyerName} · {`${s.orderNumber || s.localId.slice(0, 8)} · ${s.serverStatus || "DRAFT"}`}</option>)}</select><Button variant="outline" disabled={!selectedDraft} onClick={() => { const found = order.saved.find(s => s.localId === selectedDraft); if (found) choose(found); }}>ဖွင့်မည်</Button><Button variant="outline" onClick={() => choose(null)} aria-label="အော်ဒါမူကြမ်းအသစ်"><Plus className="size-4" /></Button></div>
      {!!legacy.length && <div className="space-y-2 rounded-xl border border-amber-200 p-3"><p className="text-xs leading-6">ယခင် Browser မူကြမ်းများ · Server Customer ကို အရင်ရွေးပါ။</p><div className="flex gap-2"><select aria-label="ယခင် Browser မူကြမ်း" value={legacyId} onChange={e=>setLegacyId(e.target.value)} className="min-w-0 flex-1 rounded-lg border bg-background p-2 text-xs"><option value="">မူကြမ်းရွေးရန်</option>{legacy.map(l=><option key={l.localId} value={l.localId}>{l.buyerName} · {l.localId.slice(0,8)}</option>)}</select><Button variant="outline" disabled={!legacyId||!buyerReady||order.locked} onClick={()=>{const old=legacy.find(l=>l.localId===legacyId);if(old)setPending({kind:"import",draft:old});}}>ယူမည်</Button></div></div>}
      <div className="rounded-2xl border bg-muted/30 p-4"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background">{d.buyerType === "SHOP" ? <Store className="size-5 text-primary" /> : <UserRound className="size-5 text-primary" />}</span><div className="min-w-0"><p className="text-xs text-muted-foreground">ပို့မည့် {d.buyerType === "SHOP" ? "ဆိုင်" : "Customer"}</p><p className="mt-1 truncate font-semibold">{d.buyerName || "မရွေးရသေးပါ"}</p><p className="mt-1 text-xs text-muted-foreground">{d.buyerCode || "စာမျက်နှာအပေါ်တွင် ရွေးပါ"}</p></div></div>{!buyerReady && <p role="status" className="mt-3 text-xs leading-6 text-amber-700 dark:text-amber-300">ဤမူကြမ်းအတွက် ဆိုင် / Customer ကို အပေါ်ဘက်စာရင်းမှ ရွေးရန်လိုပါသည်။</p>}</div>
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">ရွေးထားသောပစ္စည်းများ</h3><Badge variant="outline">{order.dirty ? "မသိမ်းရသေး" : d.revision ? "သိမ်းထားပြီး" : "မူကြမ်းအသစ်"}</Badge></div>
      {!d.lines.length && <div className="rounded-2xl border border-dashed px-4 py-10 text-center"><Package className="mx-auto mb-3 size-9 text-muted-foreground" /><p className="text-sm font-medium">Cart ထဲ ပစ္စည်းမရှိသေးပါ</p><p className="mt-2 text-xs leading-6 text-muted-foreground">ဆိုင်ရွေးပြီး Card ကို တစ်ချက်နှိပ်လျှင် ၁ ထုပ်ထည့်ပေးပါမည်။</p></div>}
      {d.lines.map((line, index) => { const issue = orderLineIssue(line, products), qty = orderQuantity(line.quantity), live = products.find(p => p.key === line.key); let changedPrice = live?.quote?.pricingVersion !== line.pricingVersion; try { changedPrice = changedPrice || !!live?.price.current && live.price.value !== null && orderPrice(exactOrderPrice(live.price.value)) !== orderPrice(line.unitPrice) && (live.price.discounted === null || orderPrice(exactOrderPrice(live.price.discounted)) !== orderPrice(line.unitPrice)); } catch { /* Preserve the frozen draft price. */ }
        return <div key={line.key} className="space-y-3 rounded-2xl border p-3"><div className="flex items-start gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground">{String(index + 1).padStart(2, "0")}</div><div className="min-w-0 flex-1"><p className="font-semibold leading-7">{line.name}</p><p className="text-xs leading-6 text-muted-foreground">{line.packageSize} · {line.batch}</p><p className="text-xs leading-6 text-muted-foreground">ဂိုဒေါင် #{line.warehouseId} / #{line.locationId}</p></div><Button variant="ghost" disabled={order.locked} onClick={() => setPending({ kind: "remove", key: line.key })} aria-label={`${line.name} အော်ဒါမှဖယ်ရန်`}><Trash2 className="size-4 text-destructive" /></Button></div>
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center rounded-xl border"><Button variant="ghost" disabled={order.locked || qty === null || qty <= BigInt(1)} onClick={() => bump(line, -1)} aria-label={`${line.name} အရေအတွက်လျှော့ရန်`}><Minus className="size-3.5" /></Button><Label htmlFor={`order-qty-${index}`} className="sr-only">{line.name} အရေအတွက်</Label><Input id={`order-qty-${index}`} disabled={order.locked} className="h-9 w-20 rounded-none border-0 px-1 text-center shadow-none" type="number" min={1} step={1} inputMode="numeric" value={line.quantity} aria-invalid={!!issue} onChange={e => order.patch({ lines: d.lines.map(l => l.key === line.key ? { ...l, quantity: e.target.value } : l) })} /><Button variant="ghost" disabled={order.locked || qty === null || !live || live.remaining === null || qty >= whole(live.remaining)} onClick={() => bump(line, 1)} aria-label={`${line.name} အရေအတွက်တိုးရန်`}><Plus className="size-3.5" /></Button></div><div className="text-right"><p className="text-xs text-muted-foreground">{orderMoney(orderPrice(line.unitPrice), line.currency)} / {line.saleUnit}</p><p className="mt-1 font-bold text-primary">{qty === null ? "—" : orderMoney(orderPrice(line.unitPrice) * qty, line.currency)}</p></div></div>
          {issue && <p role="alert" className="text-xs leading-6 text-destructive">{issue}</p>}{changedPrice && <p className="text-xs leading-6 text-amber-700 dark:text-amber-300">Costing ဈေးပြောင်းထားပါသည်။ မူကြမ်းထဲက ဈေးကို ထိန်းထားပါသည်။ ဈေးအသစ်သုံးရန် ဈေးပြန်သတ်မှတ်မည် ကိုနှိပ်ပါ။</p>}{line.priceSource === "PRODUCTION_SNAPSHOT" && <p className="text-xs text-amber-700 dark:text-amber-300">Production snapshot ဈေး</p>}
        </div>;
      })}
      <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="order-delivery-date">ပို့မည့်ရက်</Label><Input id="order-delivery-date" disabled={order.locked} type="date" value={d.deliveryDate} onChange={e => order.patch({ deliveryDate: e.target.value })} /></div><div className="space-y-2"><Label htmlFor="order-phone">ဖုန်း</Label><Input id="order-phone" disabled={order.locked} type="tel" maxLength={50} value={d.phone} onChange={e => order.patch({ phone: e.target.value })} /></div></div>
      <div className="space-y-2"><Label htmlFor="order-address">ပို့မည့်လိပ်စာ</Label><textarea id="order-address" disabled={order.locked} maxLength={1000} rows={2} className="w-full rounded-xl border bg-background p-3 text-sm" value={d.address} onChange={e => order.patch({ address: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="order-note">မှတ်ချက်</Label><textarea id="order-note" disabled={order.locked} maxLength={2000} rows={2} className="w-full rounded-xl border bg-background p-3 text-sm" value={d.note} onChange={e => order.patch({ note: e.target.value })} /></div>
      {!order.locked && order.errors.length > 0 && <div className="space-y-1 text-xs leading-6 text-destructive">{order.errors.slice(0, 4).map(e => <p key={e}>{e}</p>)}</div>}
      {!catalogReady && <p role="status" className="text-xs leading-6 text-amber-700 dark:text-amber-300">လက်ရှိပစ္စည်းစာရင်းကို ပြန်စစ်ပြီးမှ သိမ်းနိုင်ပါမည်။</p>}{order.conflict && <p role="alert" className="text-sm leading-7 text-destructive">အခြား Tab မှ ဤမူကြမ်းကို ပြောင်းထားပါသည်။ မှတ်တမ်းမှ ပြန်ဖွင့်ပါ။</p>}
    </fieldset>}
    {order.storageError && <p role="alert" className="text-sm leading-7 text-destructive">{order.storageError}</p>}{order.message && <p role="status" className="rounded-xl bg-muted p-3 text-sm leading-7">{order.message}</p>}
    </DrawerBody><DrawerFooter className="flex-col gap-3 bg-background sm:flex-col"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">ပစ္စည်းစုစုပေါင်း</p><p className="mt-1 text-2xl font-bold">{total === null ? "—" : orderMoney(total, d?.lines[0]?.currency || "MMK")}</p></div><Button variant="outline" onClick={onClose}>ဆက်ရွေးမည်</Button></div>{!order.locked && <Button className="w-full" disabled={!d || order.locked || !!order.pending || order.saving || !order.dirty || !catalogReady || !buyerReady || !!order.errors.length || order.conflict} onClick={() => void order.save()}><Save className="mr-2 size-4" />{order.saving ? "သိမ်းနေသည်…" : "Server မူကြမ်းသိမ်းမည်"}</Button>}{order.locked && <Button onClick={()=>choose(null)} disabled={order.saving||!!order.pending}><Plus className="mr-2 size-4"/>အော်ဒါမူကြမ်းအသစ်</Button>}{order.pending && <Button variant="outline" disabled={order.saving} onClick={()=>void order.retry()}>မူလ Request ပြန်စမ်းမည်</Button>}
      {d?.serverId && <div className="flex flex-wrap gap-2">
        {d.serverStatus==="DRAFT" && <><Button disabled={order.saving||order.dirty||!!order.pending||!catalogReady} onClick={()=>setPending({kind:"confirm"})}><Check className="mr-2 size-4"/>အော်ဒါ အတည်ပြုမည်</Button><Button variant="outline" disabled={order.saving||order.dirty||!!order.pending||!catalogReady} onClick={()=>setPending({kind:"reprice"})}>ဈေးပြန်သတ်မှတ်မည်</Button></>}
        {d.serverStatus==="DRAFT" && <Button variant="destructive" disabled={order.saving||order.dirty||!!order.pending||order.conflict} onClick={()=>setPending({kind:"delete"})}>{order.saving ? "Deleting…" : "Delete draft"}</Button>}
        {d.serverStatus!=="CANCELLED" && <Button variant="outline" disabled={order.saving||order.dirty||!!order.pending} onClick={()=>setPending({kind:"cancel"})}>အော်ဒါ ပယ်ဖျက်မည်</Button>}
      </div>}
      <p className="text-[11px] leading-5 text-muted-foreground">မူကြမ်းသိမ်းလျှင် Stock မပြောင်းပါ။ အော်ဒါ အတည်ပြုလျှင်သာ Stock ကြိုဖယ်ထားမည်။ ပို့ဆောင်မှု မချိတ်ရသေးပါ။</p></DrawerFooter>
  </DrawerContent></Drawer>
  <Dialog open={!!pending} onOpenChange={open => { if (!open && !order.saving) setPending(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{pending?.kind === "delete" ? `Delete ${d?.orderNumber || "draft"}?` : pending?.kind === "remove" ? "အော်ဒါမှ ပစ္စည်းဖယ်မလား။" : pending?.kind === "confirm" ? "အော်ဒါ အတည်ပြုပြီး Stock ကြိုဖယ်ထားမလား။" : pending?.kind === "cancel" ? "အော်ဒါ ပယ်ဖျက်မလား။" : pending?.kind === "reprice" ? "လက်ရှိ Costing ဈေးကို သုံးမလား။" : pending?.kind === "import" ? "ယခင် Browser မူကြမ်းကို Server အတွက် ယူမလား။" : "မသိမ်းရသေးသော ပြင်ဆင်မှုကို ပယ်ပြီး ဖွင့်မလား။"}</DialogTitle><DialogDescription>{pending?.kind === "delete" ? `Delete draft ${d?.orderNumber || ""}? This cannot be undone through the UI. The historical record will be retained.` : pending?.kind === "remove" ? "ဤမူကြမ်းမှသာ ဖယ်မည်။ Warehouse Stock မပြောင်းပါ။" : pending?.kind === "confirm" ? "Server တွင် စစ်ပြီး အော်ဒါထဲက Stock ကို ကြိုဖယ်ထားပါမည်။" : pending?.kind === "cancel" ? "အော်ဒါကို ပယ်ဖျက်ပြီး ကြိုဖယ်ထားသော Stock ကို ပြန်လွှတ်ပါမည်။" : pending?.kind === "open" ? "ပြင်ဆင်မှုများကို သိမ်းလိုပါက အရင်ပြန်သွားပြီး သိမ်းပါ။" : "ရောင်းဈေးနှင့် ပို့မည့်သူကို စစ်ပြီးမှ အတည်ပြုပါ။"}</DialogDescription></DialogHeader>
    {(pending?.kind==="reprice"||pending?.kind==="import") && <div className="max-h-64 space-y-2 overflow-y-auto text-sm"><p className="leading-7">အောက်ပါ လက်ရှိဈေးများကို သုံးပါမည်။{pending.kind==="import" && ` ပို့မည့်သူမှာ ${d?.buyerName} ဖြစ်ပါမည်။ မူလ Browser မှတ်တမ်းကို မဖျက်ပါ။`}</p>{(pending.kind==="import"?pending.draft.lines:d?.lines||[]).map(l=>{const q=products.find(p=>p.key===l.key)?.quote;return <div className="rounded-lg border p-2" key={l.key}><p>{l.name} · {l.batch}</p><p className="text-xs">{q?.unitPrice!==null&&q?.unitPrice!==undefined?orderMoney(orderPrice(q.unitPrice),q.currency):"ဈေးမရသေးပါ"} / {l.saleUnit}</p></div>;})}</div>}
    <div className="flex flex-wrap justify-end gap-2"><Button disabled={order.saving} variant="outline" onClick={() => setPending(null)}>ပြန်သွားမည်</Button><Button disabled={order.saving||!!order.pending} onClick={() => { if(pending?.kind === "delete"){void order.deleteDraft().then(()=>setPending(null));return;} if (pending?.kind === "open") order.open(pending.draft); else if (pending?.kind === "remove" && d) order.patch({ lines: d.lines.filter(l => l.key !== pending.key) }); else if(pending?.kind === "import") order.importLocal(pending.draft); else if (pending && ["confirm","cancel","reprice"].includes(pending.kind)) void order.transition(pending.kind as "confirm"|"cancel"|"reprice"); setPending(null); }}>{pending?.kind === "delete" && order.saving ? "Deleting…" : "အတည်ပြုမည်"}</Button></div></DialogContent></Dialog></>;
}

function ProductImage({ p, large = false }: { p: Production; large?: boolean }) {
  const [failed, setFailed] = React.useState(false);
  const src = `/api/factory/costings/${p.costingSheetId}/items/${p.costingItemId}/images/PACKAGED?v=${p.sourceVersion}`;
  React.useEffect(() => setFailed(false), [src]);
  return <div className={`${large ? "aspect-square w-full max-w-56" : "size-16"} mx-auto flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted`}>
    {failed ? <Package className="size-8 text-muted-foreground" /> : <img src={src} alt={p.snapshot.productName} loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />}
  </div>;
}
function PackingCamera({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const locked = React.useRef(false);
  const [paused, setPaused] = React.useState(false);
  const [error, setError] = React.useState("");
  const { ref } = useZxing({
    paused, formats: ["code_128"], trySkew: true, timeBetweenDecodingAttempts: 250,
    constraints: { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    onDecodeResult(result) {
      const value = result.rawValue?.trim();
      if (!value || locked.current) return;
      locked.current = true; setPaused(true); onScan(value);
    },
    onError() { setError("Camera ဖွင့်မရပါ။ HTTPS နှင့် Camera permission ကို စစ်ပါ။"); },
  });
  React.useEffect(() => {
    const hidden = () => { if (document.hidden) onClose(); };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [onClose]);
  return <div className="space-y-3"><video ref={ref} autoPlay muted playsInline aria-label="Packing barcode camera" className="aspect-video w-full rounded-xl bg-black object-cover" />{error && <p role="alert" className="text-sm leading-7 text-destructive">{error}</p>}</div>;
}
export default function PackingPage() {
  const { data: session, status } = useSession();
  const scope = orderSessionScope(session);
  const [data, setData] = React.useState<Data | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
  const [revision, setRevision] = React.useState(0), [search, setSearch] = React.useState(""), [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null), [camera, setCamera] = React.useState<"PRODUCT" | "BUYER" | null>(null);
  const [labelProduct, setLabelProduct] = React.useState<Product | null>(null), [orderOpen, setOrderOpen] = React.useState(false);
  const [addBuyerOpen, setAddBuyerOpen] = React.useState(false), [newBuyerCode, setNewBuyerCode] = React.useState("");
  const [buyerProblem, setBuyerProblem] = React.useState("");
  const [scanResult, setScanResult] = React.useState<string | null>(null);
  const [pendingBuyer, setPendingBuyer] = React.useState<PackingBuyer | null>(null), [buyerIdOpen, setBuyerIdOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<{ text: string; error: boolean; id: number } | null>(null);
  const inFlight = React.useRef(false), sequence = React.useRef(0);
  const closeCamera = React.useCallback(() => setCamera(null), []);
  React.useEffect(() => {
    setData(null); setOrderOpen(false); setSelected(null); setCamera(null); setLabelProduct(null); setSearch(""); setPage(0); setAddBuyerOpen(false); setPendingBuyer(null); setScanResult(null); setBuyerIdOpen(false); setBuyerProblem(""); setNotice(null);
  }, [scope, status]);
  React.useEffect(() => {
    if (status !== "authenticated") return;
    let active = true; const controller = new AbortController(); inFlight.current = true; setBusy(true); setError("");
    void load(controller.signal).then(value => { if (active) setData(value); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "စာရင်းရယူမရပါ။"); }).finally(() => { if (active) { setBusy(false); inFlight.current = false; } });
    return () => { active = false; controller.abort(); inFlight.current = false; };
  }, [scope, status, revision]);
  React.useEffect(() => {
    if (status !== "authenticated") return;
    const refresh = () => { if (!document.hidden && !inFlight.current) setRevision(v => v + 1); };
    const timer = window.setInterval(refresh, 30000); window.addEventListener("focus", refresh); window.addEventListener("factory-packing-changed", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("factory-packing-changed", refresh); };
  }, [status]);
  React.useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 3500); return () => window.clearTimeout(timer); }, [notice?.id]);
  const products = data?.products || [], catalogReady = !!data && !busy && !error && Date.now() - Date.parse(data.updatedAt) < 90000;
  const order = usePackingOrder(scope, products, catalogReady), buyers = usePackingBuyers(scope);
  const selectedBuyer = buyers.items.find(b => b.id === order.draft?.buyerId);
  const filtered = products.filter(row => { const p = row.sample, needle = search.trim().toLowerCase(); return !needle || [p.snapshot.productName, p.barcode, p.outputBatch, ...row.records.map(r => r.productionNumber)].some(v => v.toLowerCase().includes(needle)); });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1), visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const scanCode = scanResult?.trim() || "";
  const scanBuyerMatch = buyers.items.find(b => b.code === buyerCode(scanCode));
  const scanProducts = scanCode ? products.filter(p => p.sample.barcode.trim().toUpperCase() === scanCode.toUpperCase()) : [];
  const detail = products.find(p => p.key === selected), total = order.draft ? orderTotal(order.draft.lines) : null;
  const units = order.draft?.lines.reduce((sum, line) => sum + (orderQuantity(line.quantity) || BigInt(0)), BigInt(0)) || BigInt(0);
  const warehouseName = (id: number) => data?.warehouses.find(w => w.id === id)?.name || `ဂိုဒေါင် #${id}`;
  const changeSearch = (value: string) => { setSearch(value); setPage(0); };
  const tell = (text: string, isError = false) => setNotice({ text, error: isError, id: ++sequence.current });
  const applyBuyer = (buyer: PackingBuyer) => {
    order.patch({ buyerId: buyer.id, buyerCode: buyer.code, buyerType: buyer.type, buyerName: buyer.name, phone: buyer.phone, address: buyer.address }); setBuyerProblem(""); setPendingBuyer(null); tell(`${buyer.name} ကို ရွေးထားပါပြီ။`);
  };
  const chooseBuyer = (buyer: PackingBuyer) => {
    if(order.locked || order.pending || order.saving) return;
    if (!order.draft) { setBuyerProblem("Login ဆိုင်နှင့် အကောင့် ID မရသေးပါ။"); return; }
    setBuyerProblem(""); 
    if (order.draft.buyerId === buyer.id) return;
    if (order.draft.lines.length && order.draft.buyerName) setPendingBuyer(buyer); else applyBuyer(buyer);
  };
  const addOne = (product: Product) => {
    if (!selectedBuyer || buyerProblem || pendingBuyer || order.saving || order.locked || order.pending) { setBuyerProblem("ပို့မည့် ဆိုင် / Customer ကို အရင်ရွေးပါ။"); return; }
    try { order.add(product, "1", false, false); tell(`${product.sample.snapshot.productName} · ၁ ${product.sample.saleUnit} ထည့်ပြီးပါပြီ။`); }
    catch (e) { tell(e instanceof Error ? e.message : "Cart ထဲ ထည့်မရပါ။", true); }
  };
  const blockedReason = (product: Product): string => {
    if (!order.draft) return "အကောင့်အချက်အလက် လိုအပ်ပါသည်";
    if(order.locked) return "အော်ဒါမူကြမ်းအသစ် ဖွင့်ပါ";
    if(order.pending) return "မူလ Request ကို အရင်ပြန်စမ်းပါ";
    if (!selectedBuyer) return "ဆိုင် / Customer အရင်ရွေးပါ";
    if (buyerProblem || pendingBuyer) return "ဆိုင် / Customer ID ကို အရင်စစ်ပါ";
    if (!catalogReady || order.saving) return "စာရင်းစစ်နေပါသည်";
    if (product.remaining === null) return "လက်ကျန်မရသေးပါ";
    const line = order.draft.lines.find(l => l.key === product.key), qty = line ? orderQuantity(line.quantity) : BigInt(0);
    if (qty === null) return "Cart အရေအတွက်ကို စစ်ပါ";
    if (whole(product.remaining) <= qty) return whole(product.remaining) === BigInt(0) ? "လက်ကျန်မရှိပါ" : "လက်ကျန်ပြည့်အောင် ထည့်ပြီးပါပြီ";
    if (!product.price.current || product.price.value === null) return "လက်ရှိ Costing ဈေး စစ်ရန်လိုသည်";
    return "";
  };
  if (status === "loading") return <p role="status" className="p-6">အကောင့်စစ်ဆေးနေပါသည်…</p>;
  if (status === "unauthenticated") return <p role="alert" className="p-6">Packing စာရင်းကြည့်ရန် Login ဝင်ပါ။</p>;
  return <main className="mx-auto w-full max-w-7xl space-y-6 p-4 pb-32 md:p-6 md:pb-32">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" /> Factory · Packing</div>
          <h1 className="text-2xl font-bold leading-relaxed sm:text-3xl">အော်ဒါအတွက် ပစ္စည်းရွေးရန်</h1>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">ဆိုင်ရွေးပါ။ ပစ္စည်း Card ကို နှိပ်ပါ။ Cart ထဲမှာ အော်ဒါစစ်ပါ။</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="ပို့မည့်ဆိုင် သို့မဟုတ် Customer ရွေးရန်">
      <PackingBuyerPicker items={buyers.items} selectedId={selectedBuyer?.id} disabled={!scope || order.saving || order.locked || !!order.pending} onSelect={chooseBuyer} onAdd={() => { setNewBuyerCode(""); setAddBuyerOpen(true); }} />
      {selectedBuyer && <div className="flex min-w-0 items-center gap-2">
        <Badge variant="secondary" className="max-w-full">
          <Check className="mr-1 size-3" />
          <span className="truncate">{selectedBuyer.name}</span>
          </Badge><Button variant="ghost" size="icon" onClick={() => setBuyerIdOpen(true)} aria-label="ရွေးထားသော ဆိုင် Customer ID Barcode ကြည့်ရန်"><Barcode className="size-4" /></Button></div>}
    </div><motion.button type="button" onClick={() => setCamera("PRODUCT")} initial="rest" animate="rest" whileHover="hover" whileTap={{ scale: .94 }} aria-label="ပစ္စည်း သို့မဟုတ် ဆိုင် Customer ID Camera Scan ဖတ်ရန်" className="group flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><motion.span variants={{ rest: { rotate: 0, scale: 1 }, hover: { rotate: -8, scale: 1.12 } }} transition={{ type: "spring", stiffness: 350, damping: 18 }}><Camera className="size-4" /></motion.span><span className="text-sm font-medium">Scan</span><motion.span variants={{ rest: { width: 0, opacity: 0 }, hover: { width: 16, opacity: 1 } }} className="overflow-hidden"><Barcode className="size-4" /></motion.span></motion.button><Button variant="outline" disabled={busy} onClick={() => setRevision(v => v + 1)} aria-label="ပစ္စည်းစာရင်း ပြန်တင်ရန်"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /></Button><Button variant="outline" className="rounded-full px-4" onClick={() => { order.refreshSaved(); setOrderOpen(true); }}><ShoppingCart className="mr-2 size-4" />Cart <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{order.draft?.lines.length || 0}</span></Button></div></header>
    {(buyerProblem || buyers.message) && <div role="alert" className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm leading-7 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p>{buyerProblem || buyers.message}</p>{buyerProblem && selectedBuyer && <Button variant="ghost" onClick={() => setBuyerProblem("")}>မူလဆိုင်နှင့် ဆက်လုပ်မည်</Button>}</div>}
    <section className="space-y-4" aria-label="ထုတ်လုပ်ထုပ်ပိုးပြီး ပစ္စည်းများ"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-muted text-sm font-bold">02</span><div><h2 className="font-semibold">ထုတ်လုပ်ထုပ်ပိုးပြီး ပစ္စည်းများ</h2><p className="text-xs leading-6 text-muted-foreground">တစ်ချက်နှိပ်လျှင် ၁ ထုပ် · ထပ်နှိပ်လျှင် အရေအတွက်တိုးမည်</p></div></div><div className="flex items-center gap-2"><Badge variant="outline">{filtered.length} မျိုး / Batch</Badge>{search && <Button variant="ghost" onClick={() => changeSearch("")}>အားလုံးပြရန်</Button>}</div></div>
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-7 text-destructive">{error}{data && " ယခင်ရရှိထားသောစာရင်းကိုသာ ပြထားပါသည်။"}</p>}{data?.warnings.map(w => <p key={w} role="status" className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{w}</p>)}
      {!visible.length ? <div role="status" className="rounded-3xl border border-dashed py-16 text-center text-muted-foreground"><Package className="mx-auto mb-3 size-10" /><p>{busy ? "စာရင်းရယူနေပါသည်…" : "ကိုက်ညီသော အတည်ပြုပြီးပစ္စည်း မတွေ့ပါ။"}</p></div> : <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5">{visible.map(row => {
        const p = row.sample, line = order.draft?.lines.find(l => l.key === row.key), qty = line ? orderQuantity(line.quantity) : BigInt(0), reason = blockedReason(row);
        return <Card key={row.key} className={`group relative gap-0 overflow-hidden rounded-2xl p-0 transition-shadow ${line ? "border-primary/50 ring-2 ring-primary/15" : "hover:shadow-md"}`}>
          <button type="button" disabled={!!reason} onClick={() => addOne(row)} aria-label={`${p.snapshot.productName} ${p.outputBatch} အော်ဒါထဲ ၁ ${p.saleUnit} ထည့်ရန်`} title={reason || "Cart ထဲ ၁ ထုပ်ထည့်ရန်"} className="w-full rounded-t-2xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed sm:p-4"><div className="relative mb-3 rounded-2xl bg-muted/40 py-4"><ProductImage p={p} />{line && <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground"><ShoppingCart className="size-3" />{qty === null ? "!" : amount(qty)}</span>}</div><h3 className="line-clamp-2 min-h-12 text-sm font-semibold leading-6">{p.snapshot.productName}</h3><p className="mt-1 text-xs text-muted-foreground">{packageSize(p)} / {p.saleUnit}</p><p className="mt-3 text-base font-bold text-primary sm:text-lg">{row.quote?.unitPrice!=null?orderMoney(orderPrice(row.quote.unitPrice),row.quote.currency):money(row.price.value,row.price.currency)}</p><div className="mt-3 flex items-center justify-between border-t pt-3"><span className="text-[11px] text-muted-foreground">လက်ကျန်</span><span className="text-sm font-semibold">{amount(row.remaining)} {row.remaining === null ? "" : p.saleUnit}</span></div><p className="mt-2 truncate text-[10px] text-muted-foreground">Batch · {p.outputBatch}</p><p className={`mt-2 min-h-8 text-[10px] leading-4 ${reason ? "text-amber-700 dark:text-amber-300" : "text-primary"}`}>{reason || "+ တစ်ချက်နှိပ်ပြီး Cart ထဲထည့်ပါ"}</p></button>
          <div className="grid grid-cols-2 gap-1 border-t bg-muted/10 p-2"><Button variant="ghost" className="h-8 px-1 text-xs" onClick={() => setSelected(row.key)} aria-label={`${p.snapshot.productName} ${p.outputBatch} အသေးစိတ်ကြည့်ရန်`}><Info className="mr-1 size-3.5" />အသေးစိတ်</Button><Button variant="ghost" className="h-8 px-1 text-xs" onClick={() => setLabelProduct(row)} aria-label={`${p.snapshot.productName} Label ထုတ်ရန်`}><Printer className="mr-1 size-3.5" />Label</Button></div>
        </Card>;
      })}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">စာမျက်နှာ {currentPage + 1} / {pages}{data && ` · နောက်ဆုံးစစ်ချိန် ${new Date(data.updatedAt).toLocaleTimeString("en-GB")}`}</p><div className="flex gap-2"><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="ယခင်စာမျက်နှာ"><ChevronLeft className="size-4" /></Button><Button variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} aria-label="နောက်စာမျက်နှာ"><ChevronRight className="size-4" /></Button></div></div>
    </section>
    <button type="button" onClick={() => { order.refreshSaved(); setOrderOpen(true); }} className="fixed bottom-5 right-4 z-40 flex items-center gap-4 rounded-2xl bg-primary px-5 py-3 text-primary-foreground shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6" aria-label="အော်ဒါ Cart ကြည့်ရန်"><span className="flex size-10 items-center justify-center rounded-xl bg-white/15"><ShoppingCart className="size-5" /></span><span className="text-left"><span className="block text-xs opacity-80">Cart · {amount(units)} ယူနစ်</span><span className="block font-bold">{total === null ? "—" : orderMoney(total, order.draft?.lines[0]?.currency || "MMK")}</span></span><ArrowRight className="size-4" /></button>
    {notice && !orderOpen && !addBuyerOpen && !buyerIdOpen && !pendingBuyer && !scanResult && !labelProduct && !camera && <div role={notice.error ? "alert" : "status"} className={`fixed bottom-24 left-1/2 z-[80] w-[min(90vw,28rem)] -translate-x-1/2 rounded-2xl border bg-background px-4 py-3 text-sm leading-7 shadow-lg ${notice.error ? "border-destructive/40 text-destructive" : "border-emerald-300 text-emerald-800 dark:text-emerald-300"}`}>{notice.error ? <AlertCircle className="mr-2 inline size-4" /> : <Check className="mr-2 inline size-4" />}{notice.text}</div>}
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle className="leading-8">{detail?.sample.snapshot.productName}</DialogTitle><DialogDescription>ထုတ်လုပ်ထုပ်ပိုးပြီး ပစ္စည်းအသေးစိတ်</DialogDescription></DialogHeader>{detail && <div className="grid gap-5 md:grid-cols-[220px_1fr]">
      <div className="space-y-3"><ProductImage p={detail.sample} large /><Button className="w-full" disabled={!!blockedReason(detail)} onClick={() => addOne(detail)}><Plus className="mr-2 size-4" />အော်ဒါထဲထည့်ရန်</Button><Button variant="outline" className="w-full" onClick={() => { setSelected(null); setLabelProduct(detail); }}><Printer className="mr-2 size-4" />Label ထုတ်ရန်</Button><Badge variant="secondary">Production အတည်ပြုပြီး</Badge><p className="break-all text-sm"><Barcode className="mr-2 inline size-4" />{detail.sample.barcode}</p></div>
      <div className="space-y-4"><div className="rounded-2xl bg-blue-50 p-4 dark:bg-blue-950/40"><p className="text-sm">တစ်{detail.sample.saleUnit} ရောင်းဈေး</p><p className="mt-2 text-2xl font-bold text-blue-700 dark:text-blue-300">{detail.quote?.unitPrice!=null?orderMoney(orderPrice(detail.quote.unitPrice),detail.quote.currency):money(detail.price.value,detail.price.currency)}</p><p className="mt-1 text-xs text-muted-foreground">{detail.price.current ? "လက်ရှိ FINALIZED Costing မှ" : "ထုတ်လုပ်ချိန် snapshot မှ — လက်ရှိရောင်းဈေးဖြစ်ကြောင်း မအတည်ပြုနိုင်ပါ"}</p>{detail.price.discounted !== null && detail.price.value !== null && detail.price.discounted < detail.price.value && <p className="mt-2 text-sm">လျှော့ဈေးပြီး · {money(detail.price.discounted, detail.price.currency)}</p>}</div>
        <dl className="grid grid-cols-2 gap-3 text-sm">{[
          ["တစ်ထုပ်ပါပမာဏ", packageSize(detail.sample)], ["ထုတ်လုပ်ပြီးစုစုပေါင်း", `${amount(detail.produced)} ${detail.sample.saleUnit}`],
          ["ရောင်းနိုင်သော Batch လက်ကျန်", `${amount(detail.remaining)} ${detail.remaining === null ? "" : detail.sample.saleUnit}`], ["Batch", detail.sample.outputBatch],
          ["အမှန်တကယ်ရှိသော Stock", amount(detail.quote?.onHandQuantity ?? null)], ["အော်ဒါအတွက် ကြိုဖယ်ထား", amount(detail.quote?.reservedQuantity ?? null)],
          ["ဂိုဒေါင်", warehouseName(detail.sample.warehouseId)], ["သိုလှောင်နေရာ", `#${detail.sample.locationId}`],
        ].map(([label, value]) => <div key={label} className="rounded-xl border p-3"><dt className="text-xs leading-6 text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-semibold leading-7">{value}</dd></div>)}</dl>
        {detail.stockWarning && <p role="status" className="text-sm leading-7 text-amber-700 dark:text-amber-300">{detail.stockWarning}</p>}
        {detail.records.length > 1 && <p className="text-xs leading-6 text-muted-foreground">တူညီသော ပစ္စည်း၊ Costing version၊ Batch နှင့် ဂိုဒေါင်နေရာရှိ Production များကို စုစည်းပြထားပါသည်။ လက်ကျန်သည် Batch တစ်ခုလုံး၏ လက်ကျန်ဖြစ်ပါသည်။</p>}
        <h3 className="font-semibold">သက်ဆိုင်ရာ Production မှတ်တမ်းများ</h3><div className="max-h-52 space-y-2 overflow-y-auto">{detail.records.map(p => <Card key={p.id} className="gap-0 p-0"><CardContent className="space-y-1 p-3 text-sm"><p className="font-semibold">{p.productionNumber}</p><p className="leading-7 text-muted-foreground">{p.productionDate} · {amount(whole(p.actualOutputQuantity))} {p.saleUnit} · {p.responsibleName || "တာဝန်ခံမရှိ"}</p>{p.note && <p className="whitespace-pre-wrap break-words leading-7">{p.note}</p>}</CardContent></Card>)}</div></div>
    </div>}</DialogContent></Dialog>

    {orderOpen && <PackingOrderDrawer order={order} products={products} catalogReady={catalogReady} buyerReady={!!selectedBuyer && !buyerProblem && !pendingBuyer} onClose={() => setOrderOpen(false)} />}
    {labelProduct && <PackingLabelDialog product={labelProduct} onClose={() => setLabelProduct(null)} />}
    {addBuyerOpen && <AddPackingBuyer initialCode={newBuyerCode} onClose={() => setAddBuyerOpen(false)} onSave={async input => { const buyer = await buyers.add(input); setAddBuyerOpen(false); chooseBuyer(buyer); }} />}
    {selectedBuyer && buyerIdOpen && <PackingBuyerBarcode buyer={selectedBuyer} onClose={() => setBuyerIdOpen(false)} />}
    <Dialog open={!!pendingBuyer} onOpenChange={open => { if (!open) setPendingBuyer(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>ပို့မည့်သူ ပြောင်းမလား။</DialogTitle><DialogDescription>Cart ထဲက ပစ္စည်းများကို {pendingBuyer?.name} အတွက် ပြောင်းသတ်မှတ်ပါမည်။ ပစ္စည်းနှင့် မူကြမ်းဈေးများကို ဆက်ထားပါမည်။</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPendingBuyer(null)}>မပြောင်းတော့ပါ</Button><Button onClick={() => { if (pendingBuyer) applyBuyer(pendingBuyer); }}>ပြောင်းမည်</Button></div></DialogContent></Dialog>
    <Dialog open={camera !== null} onOpenChange={open => { if (!open) closeCamera(); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Barcode Scan</DialogTitle><DialogDescription>ပစ္စည်း Barcode သို့မဟုတ် ဆိုင် / Customer ID ကို Camera ရှေ့တွင် ထားပါ။</DialogDescription></DialogHeader>{camera && <PackingCamera onClose={closeCamera} onScan={value => { closeCamera(); setScanResult(value); }} />}</DialogContent></Dialog>
    <Dialog open={scanResult !== null} onOpenChange={open => { if (!open) setScanResult(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Scan ရလဒ်ကို အတည်ပြုပါ</DialogTitle><DialogDescription>ဖတ်ရရှိသော Barcode ကို စစ်ပြီး သက်ဆိုင်ရာရလဒ်ကို ရွေးပါ။</DialogDescription></DialogHeader>
        <p className="break-all rounded-xl bg-muted p-3 font-mono text-sm">{scanCode}</p>
        <div className="space-y-3">
          {scanBuyerMatch && <div className="rounded-2xl border p-4"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{scanBuyerMatch.type === "SHOP" ? <Store className="size-5" /> : <UserRound className="size-5" />}</span><div className="min-w-0"><p className="text-xs text-muted-foreground">ဆိုင် / Customer</p><p className="break-words font-semibold">{scanBuyerMatch.name}</p><p className="break-all text-xs text-muted-foreground">{scanBuyerMatch.code}{scanBuyerMatch.phone ? ` · ${scanBuyerMatch.phone}` : ""}</p></div></div><Button className="mt-3 w-full" disabled={!order.draft || order.saving || order.locked || !!order.pending} onClick={() => { setScanResult(null); chooseBuyer(scanBuyerMatch); }}><Check className="mr-2 size-4" />ပို့မည့်သူအဖြစ် အတည်ပြုမည်</Button></div>}
          {scanProducts.length > 0 && <div className="rounded-2xl border p-4"><p className="font-semibold">ပစ္စည်း {scanProducts.length} Batch တွေ့ပါသည်</p><div className="mt-2 max-h-40 space-y-2 overflow-y-auto">{scanProducts.map(product => <div key={product.key} className="rounded-xl bg-muted/50 p-2 text-sm"><p className="break-words font-medium">{product.sample.snapshot.productName}</p><p className="text-xs text-muted-foreground">Batch · {product.sample.outputBatch} · လက်ကျန် {amount(product.remaining)} {product.remaining === null ? "" : product.sample.saleUnit}</p></div>)}</div><Button className="mt-3 w-full" variant={scanBuyerMatch ? "outline" : "default"} onClick={() => { changeSearch(scanCode); setScanResult(null); }}><Search className="mr-2 size-4" />ပစ္စည်းစာရင်း ပြမည်</Button></div>}
          {!scanBuyerMatch && !scanProducts.length && <div className="space-y-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"><p>{!data || busy || error ? "ပစ္စည်းစာရင်းကို အပြည့်အဝ မစစ်နိုင်သေးပါ။ စာရင်းပြန်တင်ပြီး ထပ်စမ်းပါ။" : "ဤ Barcode ကို ပစ္စည်းနှင့် ဆိုင် / Customer စာရင်းတွင် မတွေ့ပါ။"}</p>{validBuyerCode(buyerCode(scanCode)) && <Button variant="outline" disabled={!scope || order.saving || order.locked || !!order.pending} onClick={() => { setNewBuyerCode(buyerCode(scanCode)); setScanResult(null); setAddBuyerOpen(true); }}><UserPlus className="mr-2 size-4" />ဤ ID ဖြင့် Customer ထည့်ရန်</Button>}</div>}
        </div>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setScanResult(null)}>ပိတ်မည်</Button><Button variant="outline" onClick={() => { setScanResult(null); setCamera("PRODUCT"); }}>ထပ် Scan ဖတ်မည်</Button></div>
      </DialogContent>
    </Dialog>
  </main>;
}
