"use client";

import { LoadingScreen } from "@/components/loading-screen";

import * as React from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useZxing } from "react-zxing";
import {
  Camera,
  Search,
  MapPin,
  Clock3,
  Boxes,
  Database,
  Info,
  Cog,
  Warehouse,
  Package,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
  Link2,
  Wifi,
  Loader2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  StockError,
  requestJson as api,
  decodePlaces,
  decodeBalances,
  decodeMovements,
  decodeProducts,
  decodeReceiptOptions,
  type Place,
  type StockPage,
  type PosProduct,
  type ReceiptOption,
} from "@/lib/warehouse/factory-stock-api";
import { receivingRequest, decodeSource, photoOf } from "@/lib/receiving-api";

import {
  bulkBalances,
  decimal,
  bulkReceivingHistory,
  confirmedBulkReceipts,
  quantity,
  isPositive,
  packageRemainder,
  rowKey,
  stockKey,
  type WarehouseBalance as BulkBalance,
  type WarehouseMovement as Movement,
} from "@/lib/warehouse/factory-warehouse-bulk";

import type { Receipt } from "@/lib/receiving-bulk-api";

type Balance = BulkBalance & {
  productionConsumedQuantity?: string | null;
};
// V46 Bulk balance totals are exact decimal strings. A missing total is unknown,
// not zero; remaining stock has already been reduced by the backend.
// Display only: the API/storage unit remains kyattha. Never write converted balances.
function vissWeight(value: string): string {
  const exact = decimal(value);
  const negative = exact.startsWith("-");
  const [whole,fraction=""] = exact.replace(/^-/, "").split(".");
  const scale = BigInt(1000000);
  const amount = BigInt(whole) * scale + BigInt(fraction.padEnd(6,"0"));
  const viss = amount / (BigInt(100) * scale);
  const kyattha = amount % (BigInt(100) * scale);
  const digits = String(kyattha % scale).padStart(6,"0").replace(/0+$/,"");
  const remainder = `${kyattha / scale}${digits ? `.${digits}` : ""}`;
  const sign = negative && amount ? "−" : "";
  if (!amount) return "0 ပိဿာ";
  return `${sign}${viss ? `${viss.toLocaleString("en-US")} ပိဿာ${kyattha ? " " : ""}` : ""}${kyattha ? `${remainder} ကျပ်သား` : ""}`;
}
function warehouseAmount(value: string, unit: string): string {
  const exact = decimal(value);
  if (unit !== "ကျပ်သား") return `${quantity(exact)} ${unit}`;
  const display = vissWeight(exact);
  if (!display.includes("ပိဿာ")) return display;
  return `${display} (${quantity(exact)} ကျပ်သား)`;
}

function stockTotal(row: Record<string, unknown>, field: string): string | null {
  if (row[field] == null) return null;
  const value = decimal(row[field]);
  if (value.startsWith("-"))
    throw new StockError(`Bulk Stock ${field} ပမာဏ အနုတ်ဖြစ်နေပါသည်။`, 502);
  return value;
}
function warehouseBulkBalances(
  raw: unknown,
  receipts: Receipt[],
  filters: Filters,
  page: number,
  size: number,
): StockPage<Balance> {
  if (!Array.isArray(raw))
    throw new StockError("Bulk balance API မှ array response လိုအပ်ပါသည်။", 502);
  const rows: Record<string, unknown>[] = raw.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new StockError("Bulk Stock response ပုံစံ မမှန်ပါ။", 502);
    const row = value as Record<string, unknown>;
    return {
      ...row,
      // Prefer the explicit current balance; never subtract consumed quantity here.
      base_quantity: stockTotal(row, "remaining_quantity") ?? row.base_quantity ?? row.quantity,
    };
  });
  // The existing decoder validates every stock identity, conversion and balance.
  const result = bulkBalances(rows, receipts, filters, page, size);
  const byKey = new Map(rows.map(row => [stockKey({
    itemId: row.item_id as number,
    sourceVersion: row.source_version as number,
    warehouseId: row.warehouse_id as number,
    locationId: row.location_id as number,
    batch: row.batch as string,
  }), row]));
  return { ...result, content: result.content.map(balance => {
    const row = byKey.get(stockKey(balance))!;
    return {
      ...balance,
      // Use audited server totals, keeping immutable Receiving sums as a legacy fallback.
      receivedQuantity: stockTotal(row, "received_quantity") ?? balance.receivedQuantity,
      productionConsumedQuantity: stockTotal(row, "production_consumed_quantity"),
    };
  }) };
}

type StockKind = "BULK" | "FINISHED";
type ArchiveKey = {
  stockKind: StockKind; itemId: number; sourceVersion: number;
  warehouseId: number; locationId: number; batch: string;
};
type ArchiveRecord = { key: ArchiveKey; name: string; reason: string; archivedAt: string };
function archiveIdentity(row: Balance): ArchiveKey {
  return {stockKind:row.stockKind === "BULK" ? "BULK" : "FINISHED",itemId:row.itemId,sourceVersion:row.sourceVersion,
    warehouseId:row.warehouseId,locationId:row.locationId,batch:row.batch.trim().toUpperCase()};
}
function archiveKey(key: ArchiveKey): string {
  return JSON.stringify([key.stockKind,key.itemId,key.sourceVersion,key.warehouseId,key.locationId,key.batch.trim().toUpperCase()]);
}
function decodeArchives(raw: unknown): ArchiveRecord[] {
  if (!Array.isArray(raw)) throw new StockError("ဖယ်သိမ်းစာရင်း response မမှန်ပါ။",502);
  const keys = new Set<string>();
  return raw.map(value => {
    const r = value as ArchiveRecord;
    if (!r || !r.key || !["BULK","FINISHED"].includes(r.key.stockKind) ||
      ![r.key.itemId,r.key.warehouseId,r.key.locationId].every(n=>Number.isSafeInteger(n)&&n>0) ||
      !Number.isSafeInteger(r.key.sourceVersion)||r.key.sourceVersion<0||
      typeof r.key.batch!=="string"||!r.key.batch.trim()||typeof r.name!=="string"||
      typeof r.reason!=="string"||typeof r.archivedAt!=="string"||!Number.isFinite(Date.parse(r.archivedAt)))
      throw new StockError("ဖယ်သိမ်းထားသော ပစ္စည်းအချက်အလက် မမှန်ပါ။",502);
    const key=archiveKey(r.key);if(keys.has(key))throw new StockError("ဖယ်သိမ်းစာရင်း ထပ်နေပါသည်။",502);
    keys.add(key);return r;
  });
}
function visibleBulkRows(raw: unknown, archived: Set<string>): unknown {
  if(!Array.isArray(raw))return raw;
  return raw.filter(row=>!row||typeof row!=="object"||!archived.has(archiveKey({stockKind:"BULK",
    itemId:row.item_id,sourceVersion:row.source_version,warehouseId:row.warehouse_id,
    locationId:row.location_id,batch:typeof row.batch==="string"?row.batch:""})));
}
// Apply visibility before pagination, including for finished stock. History is untouched.
async function visibleFinishedBalances(q: URLSearchParams, page: number, archived: Set<string>, signal: AbortSignal): Promise<StockPage<Balance>> {
  if(!archived.size)return decodeBalances(await api(`/api/factory/stock/balances?${q}`,{signal}));
  const params=new URLSearchParams(q);params.set("size","100");
  const all: Balance[]=[];let template: StockPage<Balance>|null=null;
  for(let p=0;p<1000;p++){
    params.set("page",String(p));
    const data=decodeBalances(await api(`/api/factory/stock/balances?${params}`,{signal}));
    if(data.page!==p||data.size!==100||template&&data.totalElements!==template.totalElements)
      throw new StockError("Stock စာရင်း ပြောင်းနေပါသည်။ ပြန်တင်ပြီး စစ်ပါ။",409);
    template??=data;all.push(...data.content);
    if(all.length>=data.totalElements){
      const rows=all.filter(row=>!archived.has(archiveKey(archiveIdentity(row))));
      return {...template,page,size:SIZE,totalElements:rows.length,content:rows.slice(page*SIZE,(page+1)*SIZE)};
    }
    if(!data.content.length)break;
  }
  throw new StockError("Stock စာရင်း အပြည့်မရပါ။ Search ဖြင့် စာရင်းလျှော့ပြီး ပြန်စမ်းပါ။",502);
}

type Filters = {
  search: string;
  warehouseId: string;
  locationId: string;
  batch: string;
};
type Result =
  | { key: string; kind: "balances"; data: StockPage<Balance> }
  | { key: string; kind: "history"; data: StockPage<Movement> };
const emptyFilters: Filters = {
  search: "",
  warehouseId: "",
  locationId: "",
  batch: "",
};
const SIZE = 10;
const ACTIVITY_SIZE = 3;
const fieldClass =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const id = React.useId();
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id} className="text-xs leading-6">
        {label}
      </Label>
      {React.cloneElement(children, { id })}
    </div>
  );
}
function ProductImage({
  product,
  imageUrl,
  compact = false,
  tile = false,
}: {
  product: Balance | Movement;
  imageUrl?: string | null;
  compact?: boolean;
  tile?: boolean;
}) {
  const urls =
    product.stockKind === "BULK"
      ? (product.imageUrls ?? [])
      : imageUrl
        ? [imageUrl]
        : [];
  const urlsKey = JSON.stringify(urls);
  const [attempt, setAttempt] = React.useState({ key: urlsKey, index: 0 });
  const index = attempt.key === urlsKey ? attempt.index : 0;
  const src = urls[index];
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted/50 ${compact ? "size-14" : tile ? "h-28 w-full bg-transparent" : "aspect-square w-full"}`}
    >
      {src ? (
        // Native img supports API image hosts without Next.js remotePatterns configuration.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={product.name}
          loading="lazy"
          onError={() => setAttempt({ key: urlsKey, index: index + 1 })}
          className={`pointer-events-none absolute inset-0 h-full w-full select-none object-contain transition duration-300 group-hover:scale-105 ${compact ? "p-1" : tile ? "p-2" : "p-4"}`}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Package
            className={compact ? "size-6 opacity-40" : "size-14 opacity-40"}
          />
          {!compact && <span className="text-xs">ပုံမရှိသေးပါ</span>}
        </div>
      )}
    </div>
  );
}

function ProductDetail({
  product,
  imageUrl,
  warehouse,
  location,
}: {
  product: Balance | Movement;
  imageUrl?: string | null;
  warehouse: string;
  location: string;
}) {
  const [section, setSection] = React.useState("overview");
  const [fieldPage, setFieldPage] = React.useState(0);
  const fields = Object.entries(product);
  const fieldPages = Math.ceil(fields.length / 4);
  const facts = [
    ["Barcode", product.barcode],
    ["ဂိုဒေါင်", warehouse],
    ["နေရာ", location],
    ["Batch", product.batch || "—"],
    ["ပစ္စည်း ID", "itemId" in product ? String(product.itemId) : "—"],
    ["ယူနစ်", product.unit],
    ...(product.stockKind === "BULK"
      ? [
          [
            "မူလအထုပ်တစ်ခု",
            `${quantity(product.quantityPerPackage!)} ${product.unit} / ${product.packageUnit}`,
          ],
        ]
      : []),
  ];
  return (
    <div className="grid min-w-0 grid-cols-1 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] sm:gap-5">
      <div className="min-w-0 space-y-3">
        <div className="overflow-hidden rounded-xl border">
          <ProductImage product={product} imageUrl={imageUrl} />
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <p className="text-[11px] leading-6">
            {"quantity" in product ? "လက်ရှိလက်ကျန်" : "ဝင် / ထွက်ပမာဏ"}
          </p>
          <p className="break-all text-lg font-bold tabular-nums sm:text-2xl">
            {warehouseAmount("quantity" in product ? product.quantity : product.delta, product.unit)}
          </p>
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <Tabs value={section} onValueChange={setSection}>
          <TabsList className="h-auto w-full flex-wrap">
            <TabsTrigger value="overview" className="min-h-9 text-xs">
              အကျဉ်းချုပ်
            </TabsTrigger>
            <TabsTrigger value="all" className="min-h-9 text-xs">
              အချက်အလက်အားလုံး
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {section === "overview" ? (
          <>
            <dl className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 rounded-lg bg-muted/50 px-3 py-2"
                >
                  <dt className="text-[10px] leading-5 text-muted-foreground">
                    {label}
                  </dt>
                  <dd
                    title={value}
                    className="line-clamp-2 break-all text-xs font-medium leading-6"
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {"quantity" in product ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-blue-50 p-2 leading-6 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
                  မူလအဝင်
                  <p className="break-all font-bold">
                    {product.receivedQuantity == null
                      ? "—"
                      : warehouseAmount(product.receivedQuantity, product.unit)}
                  </p>
                </div>
                {product.stockKind === "BULK" && (
                  <div className="rounded-lg bg-amber-50 p-2 leading-6 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    Production ထုတ်ယူပြီး
                    <p className="break-all font-bold">
                      {product.productionConsumedQuantity == null ? "—" : warehouseAmount(product.productionConsumedQuantity, product.unit)}
                    </p>
                  </div>
                )}
                {product.stockKind === "BULK" ? (
                  <div className="rounded-lg bg-amber-50 p-2 leading-6 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    လက်ကျန်အထုပ်ညီမျှပမာဏ
                    <p className="break-all font-bold">
                      {packageRemainder(
                        product.quantity,
                        product.quantityPerPackage!,
                        product.packageUnit!,
                        product.unit,
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg bg-amber-50 p-2 leading-6 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    ရောင်းပြီး
                    <p className="break-all font-bold">
                      {product.soldQuantity == null
                        ? "—"
                        : warehouseAmount(product.soldQuantity, product.unit)}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-muted/50 p-2 text-xs leading-6">
                <p>
                  {product.type === "STOCK_IN"
                    ? "Receiving အဝင်"
                    : "Checkout အထွက်"}
                </p>
                <Stamp value={product.createdAt} />
              </div>
            )}
          </>
        ) : (
          <>
            <dl className="space-y-2">
              {fields
                .slice(fieldPage * 4, fieldPage * 4 + 4)
                .map(([key, value]) => {
                  const display =
                    value == null
                      ? "—"
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value);
                  return (
                    <div
                      key={key}
                      className="min-w-0 rounded-lg bg-muted/50 px-3 py-2"
                    >
                      <dt
                        className="truncate text-[10px] leading-5 text-muted-foreground"
                        title={key}
                      >
                        {key}
                      </dt>
                      <dd
                        className="line-clamp-2 break-all text-xs leading-6"
                        title={display}
                      >
                        {display}
                      </dd>
                    </div>
                  );
                })}
            </dl>
            <div className="flex items-center justify-between gap-2 text-xs">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="ယခင်အချက်အလက်"
                disabled={fieldPage === 0}
                onClick={() => setFieldPage((v) => v - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span>
                {fieldPage + 1} / {fieldPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="နောက်အချက်အလက်"
                disabled={fieldPage + 1 >= fieldPages}
                onClick={() => setFieldPage((v) => v + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stamp({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}
function useStockEvents(
  enabled: boolean,
  refresh: () => void,
  pollingOnly = false,
) {
  const [status, setStatus] = React.useState<
    "connecting" | "live" | "retrying" | "paused" | "polling"
  >("connecting");
  React.useEffect(() => {
    if (!enabled) return;
    let feed: EventSource | null = null,
      debounce: ReturnType<typeof setTimeout> | undefined,
      disposed = false;
    const invalidate = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = undefined;
        if (!disposed && document.visibilityState !== "hidden") refresh();
      }, 180);
    };
    const close = () => {
      feed?.close();
      feed = null;
      if (debounce) {
        clearTimeout(debounce);
        debounce = undefined;
      }
    };
    const start = () => {
      close();
      if (document.visibilityState === "hidden") {
        setStatus("paused");
        return;
      }
      if (pollingOnly || typeof EventSource === "undefined") {
        setStatus("polling");
        return;
      }
      setStatus("connecting");
      const current = new EventSource("/api/factory/stock/events");
      feed = current;
      current.onopen = () => {
        if (!disposed && feed === current) setStatus("live");
      };
      current.addEventListener("refresh", invalidate);
      current.addEventListener("stock-change", invalidate);
      current.onerror = () => {
        if (!disposed && feed === current) {
          setStatus("retrying");
          invalidate();
        }
      };
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        close();
        setStatus("paused");
      } else {
        refresh();
        start();
      }
    };
    const online = () => {
      refresh();
      start();
    };
    const offline = () => {
      close();
      setStatus("retrying");
    };
    const fallback = setInterval(() => {
      if (
        document.visibilityState !== "hidden" &&
        (!feed || feed.readyState !== 1)
      )
        invalidate();
    }, 5000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    start();
    return () => {
      disposed = true;
      close();
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [enabled, refresh, pollingOnly]);
  return status;
}
function WarehouseCameraScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const locked = React.useRef(false);
  const [paused, setPaused] = React.useState(false);
  const [cameraError, setCameraError] = React.useState("");
  const [invalidCode, setInvalidCode] = React.useState("");
  const { ref } = useZxing({
    paused,
    formats: ["code_128"],
    trySkew: true,
    timeBetweenDecodingAttempts: 250,
    constraints: {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    onDecodeResult(result) {
      if (locked.current) return;
      const code = result.rawValue?.trim().toUpperCase();
      if (!code) return;
      const match = /^FC-([1-9]\d*)-([1-9]\d*)$/.exec(code);
      if (
        !match ||
        ![Number(match[1]), Number(match[2])].every(Number.isSafeInteger)
      ) {
        setInvalidCode(
          "Costing barcode (FC-12-34 ပုံစံ) ကိုသာ ဖတ်ပါ။ ကင်မရာကို မှန်ကန်သော barcode ဆီ ရွှေ့ပါ။",
        );
        return;
      }
      locked.current = true;
      setPaused(true);
      onScan(code);
    },
    onError() {
      setCameraError(
        "Camera ဖွင့်မရပါ။ HTTPS ဖြင့်ဖွင့်ပြီး Camera permission ကို Allow လုပ်ပါ။ မရပါက code ကို စာရိုက်ထည့်နိုင်ပါသည်။",
      );
    },
  });
  React.useEffect(() => {
    const closeWhenHidden = () => {
      if (document.hidden) onClose();
    };
    document.addEventListener("visibilitychange", closeWhenHidden);
    return () =>
      document.removeEventListener("visibilitychange", closeWhenHidden);
  }, [onClose]);
  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
        <video
          ref={ref}
          autoPlay
          muted
          playsInline
          aria-label="Warehouse barcode camera"
          className="size-full object-cover"
        />
        <div className="pointer-events-none absolute inset-x-[6%] top-1/2 h-[42%] -translate-y-1/2 rounded-xl border-2 border-emerald-400 shadow-[0_0_0_999px_rgba(0,0,0,0.4)]" />
        <p className="pointer-events-none absolute inset-x-2 bottom-3 text-center text-xs font-medium text-white">
          FC barcode ကို အလျားလိုက် ဘောင်အတွင်းထားပါ
        </p>
      </div>
      {cameraError && (
        <p role="alert" className="text-sm leading-7 text-destructive">
          {cameraError}
        </p>
      )}
      {!cameraError && invalidCode && (
        <p
          role="status"
          className="text-xs leading-7 text-amber-700 dark:text-amber-300"
        >
          {invalidCode}
        </p>
      )}
    </div>
  );
}

export default function WarehousePage() {
  const { data, status } = useSession();
  const user = data?.user as
    | {
        id?: string | number;
        username?: string;
        shopId?: string | number;
        shopCode?: string;
      }
    | undefined;
  if (status !== "authenticated" || !user)
    return (
      <p role="status" className="p-6 text-sm">
        {status === "loading" ? "Login session စစ်နေသည်…" : "Login ပြန်ဝင်ပါ။"}
      </p>
    );
  return (
    <StockWorkspace
      key={`${user.id ?? user.username}:${user.shopId ?? user.shopCode}`}
    />
  );
}
function StockWorkspace() {
  const [filters, setFilters] = React.useState<Filters>(emptyFilters),
    [draft, setDraft] = React.useState<Filters>(emptyFilters),
    [stockKind, setStockKind] = React.useState<StockKind>("BULK"),
    [page, setPage] = React.useState(0),
    [revision, setRevision] = React.useState(0);
  const [result, setResult] = React.useState<Result | null>(null),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState(""),
    [updated, setUpdated] = React.useState(""),
    [authExpired, setAuthExpired] = React.useState(false);
  const [warehouses, setWarehouses] = React.useState<Place[]>([]),
    [locations, setLocations] = React.useState<Place[]>([]),
    [placeError, setPlaceError] = React.useState(""),
    [placeRevision, setPlaceRevision] = React.useState(0),
    [locationBusy, setLocationBusy] = React.useState(false);
  const [locationNames, setLocationNames] = React.useState<
    Record<number, string>
  >({});
  const [mappingOpen, setMappingOpen] = React.useState(false),
    [detail, setDetail] = React.useState<Balance | Movement | null>(null);
  const [archives,setArchives]=React.useState<ArchiveRecord[]>([]);
  const [archiveReady,setArchiveReady]=React.useState(false),[archiveError,setArchiveError]=React.useState("");
  const [archiveHistory,setArchiveHistory]=React.useState(false);
  const [archiveAction,setArchiveAction]=React.useState<{key:ArchiveKey;name:string;restore:boolean}|null>(null);
  const [archiveReason,setArchiveReason]=React.useState(""),[archiveConfirmation,setArchiveConfirmation]=React.useState("");
  const [archiveBusy,setArchiveBusy]=React.useState(false),[archiveMessage,setArchiveMessage]=React.useState("");
  const archiveLock=React.useRef(false),archiveMounted=React.useRef(true);
  React.useEffect(()=>{archiveMounted.current=true;return()=>{archiveMounted.current=false;};},[]);
  const beginArchive=(row:Balance)=>{if(archiveBusy||!archiveReady)return;setArchiveReason("");setArchiveConfirmation("");setArchiveMessage("");setArchiveAction({key:archiveIdentity(row),name:row.name,restore:false});};
  async function saveArchive(){
    const action=archiveAction;if(!action||archiveLock.current||!archiveReady||archiveConfirmation.trim()!==action.name.trim()||!action.restore&&!archiveReason.trim())return;
    archiveLock.current=true;setArchiveBusy(true);setArchiveMessage("");
    try{
      await api("/api/factory/warehouse/archives",{method:action.restore?"DELETE":"POST",body:JSON.stringify(action.restore?action.key:{key:action.key,name:action.name,reason:archiveReason.trim()})});
      if(!archiveMounted.current)return;
      // Read canonical visibility; never remove a card optimistically on an error.
      const current=decodeArchives(await api("/api/factory/warehouse/archives"));
      if(!archiveMounted.current)return;
      const present=current.some(r=>archiveKey(r.key)===archiveKey(action.key));
      setArchives(current);
      if(present===action.restore)throw new Error("Server အခြေအနေ ထပ်ပြောင်းထားပါသည်။ ဖယ်သိမ်းစာရင်းကို ပြန်စစ်ပါ။");
      setArchiveAction(null);setDetail(null);setSelectedKey(null);setPage(0);setRevision(v=>v+1);
      setArchiveMessage(action.restore?"Warehouse စာရင်းတွင် ပြန်ဖော်ပြီးပါပြီ။ Stock ပမာဏ မပြောင်းပါ။":"ရွေးထားသော Warehouse / နေရာ / Batch ကို စာရင်းမှဖယ်သိမ်းပြီးပါပြီ။ Stock နှင့် ယခင်မှတ်တမ်းများ မပြောင်းပါ။");
      window.dispatchEvent(new Event("factory-warehouse-archives-changed"));
    }catch(e){
      if(archiveMounted.current){setArchiveMessage(e instanceof Error?e.message:"ဖယ်သိမ်းခြင်း မအောင်မြင်ပါ။");setArchiveAction(null);setRevision(v=>v+1);}
    }finally{archiveLock.current=false;if(archiveMounted.current)setArchiveBusy(false);}
  }
  const refresh = React.useCallback(() => setRevision((v) => v + 1), []);
  const busyRef = React.useRef(false);
  const refreshFromEvents = React.useCallback(() => {
    if (!busyRef.current) refresh();
  }, [refresh]);
  const connection = useStockEvents(
    !authExpired,
    refreshFromEvents,
    stockKind === "BULK",
  );
  React.useEffect(()=>{const changed=()=>refresh();window.addEventListener("factory-warehouse-archives-changed",changed);return()=>window.removeEventListener("factory-warehouse-archives-changed",changed);},[refresh]);
  const queryKey = JSON.stringify({ filters, page, stockKind });
  const dataKey = JSON.stringify({ filters, stockKind });
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [cameraAttempt, setCameraAttempt] = React.useState(0);
  const closeCamera = React.useCallback(() => setCameraOpen(false), []);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const cameraWasOpen = React.useRef(cameraOpen);
  React.useEffect(() => {
    if (cameraWasOpen.current && !cameraOpen) searchRef.current?.focus();
    cameraWasOpen.current = cameraOpen;
  }, [cameraOpen]);
  const [activityPage, setActivityPage] = React.useState(0);
  const [bulkHistory, setBulkHistory] = React.useState<{
    key: string;
    receipts: Receipt[];
  } | null>(null);
  const [finishedHistory, setFinishedHistory] = React.useState<{
    key: string;
    data: StockPage<Movement>;
  } | null>(null);
  const [historyBusy, setHistoryBusy] = React.useState(false);
  const [historyError, setHistoryError] = React.useState("");
  const historyKey = JSON.stringify({ dataKey, activityPage });
  React.useEffect(() => {
    const c = new AbortController();
    let active = true;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setResult((r) => (r?.key === queryKey ? r : null));
    const q = new URLSearchParams({
      page: String(page),
      size: String(SIZE),
      search: filters.search,
    });
    if (filters.warehouseId) q.set("warehouseId", filters.warehouseId);
    if (filters.locationId) q.set("locationId", filters.locationId);
    if (filters.batch) q.set("batch", filters.batch);
    const load = async (): Promise<StockPage<Balance>> => {
      let archived: ArchiveRecord[]=[];
      try{
        archived=decodeArchives(await api("/api/factory/warehouse/archives",{signal:c.signal}));
        if(active){setArchives(archived);setArchiveReady(true);setArchiveError("");}
      }catch(e){
        if(c.signal.aborted)throw e;
        if(e instanceof StockError&&e.status===401)throw e;
        if(active){setArchiveReady(false);setArchiveError("ဖယ်သိမ်းခြင်း API မရသေးပါ။ Backend migration၊ Controller နှင့် Next.js route ကို ထည့်ပြီး ပြန်စမ်းပါ။ Stock စာရင်းကို ဆက်ပြထားပါသည်။");}
      }
      const archivedKeys=new Set(archived.map(row=>archiveKey(row.key)));
      if (stockKind === "BULK") {
        const [raw, receipts] = await Promise.all([
          api("/api/factory/warehouse/bulk-balances", { signal: c.signal }),
          confirmedBulkReceipts(c.signal),
        ]);
        // Validate the history payload before using it in the synchronous table renderer.
        bulkReceivingHistory(receipts, filters, 0, ACTIVITY_SIZE);
        const balances = warehouseBulkBalances(visibleBulkRows(raw,archivedKeys), receipts, filters, page, SIZE);
        if (active) setBulkHistory({ key: dataKey, receipts });
        return balances;
      }
      return visibleFinishedBalances(q,page,archivedKeys,c.signal);
    };
    void load()
      .then((data) => {
        if (data.page !== page || data.size !== SIZE)
          throw new StockError("Stock pagination response မမှန်ပါ။", 502);
        const pages = Math.ceil(data.totalElements / SIZE);
        if (page > 0 && page >= pages) {
          if (active) setPage(Math.max(0, pages - 1));
          return;
        }
        if (active) {
          setResult({ key: queryKey, kind: "balances", data });
          setUpdated(new Date().toISOString());
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "စတော့ရယူမရပါ။");
          if (e instanceof StockError && e.status === 401) setAuthExpired(true);
        }
      })
      .finally(() => {
        if (active) {
          busyRef.current = false;
          setBusy(false);
        }
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [filters, page, revision, queryKey, stockKind, dataKey]);
  React.useEffect(() => {
    let active = true;
    const c = new AbortController();
    void api("/api/factory/receivings/warehouses", { signal: c.signal })
      .then(decodePlaces)
      .then(async (v) => {
        if (!active) return;
        setWarehouses(v);
        setPlaceError("");
        const results = await Promise.allSettled(
          v.map((w) =>
            api(`/api/factory/receivings/warehouses/${w.id}/locations`, {
              signal: c.signal,
            }).then(decodePlaces),
          ),
        );
        if (!active) return;
        const names: Record<number, string> = {};
        for (const result of results)
          if (result.status === "fulfilled")
            for (const location of result.value)
              names[location.id] = location.name;
        setLocationNames(names);
        if (results.some((r) => r.status === "rejected"))
          setPlaceError(
            "အချို့သိုလှောင်နေရာအမည်များ ရယူမရပါ။ နေရာစာရင်းကို ပြန်တင်ပါ။",
          );
      })
      .catch((e) => {
        if (active) {
          setPlaceError(e instanceof Error ? e.message : "ဂိုဒေါင်စာရင်းမရပါ။");
          if (e instanceof StockError && e.status === 401) setAuthExpired(true);
        }
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [placeRevision]);
  React.useEffect(() => {
    setLocations([]);
    setLocationBusy(false);
    if (!draft.warehouseId) return;
    let active = true;
    const c = new AbortController();
    setLocationBusy(true);
    void api(
      `/api/factory/receivings/warehouses/${draft.warehouseId}/locations`,
      { signal: c.signal },
    )
      .then(decodePlaces)
      .then((v) => {
        if (active) setLocations(v);
      })
      .catch((e) => {
        if (active)
          setPlaceError(e instanceof Error ? e.message : "နေရာစာရင်းမရပါ။");
      })
      .finally(() => {
        if (active) setLocationBusy(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [draft.warehouseId, placeRevision]);
  React.useEffect(() => {
    if (stockKind !== "FINISHED") {
      setHistoryBusy(false);
      setHistoryError("");
      return;
    }
    const c = new AbortController();
    let active = true;
    setHistoryBusy(true);
    setHistoryError("");
    const q = new URLSearchParams({
      page: String(activityPage),
      size: String(ACTIVITY_SIZE),
      search: filters.search,
    });
    if (filters.warehouseId) q.set("warehouseId", filters.warehouseId);
    if (filters.locationId) q.set("locationId", filters.locationId);
    if (filters.batch) q.set("batch", filters.batch);
    void api(`/api/factory/stock/history?${q}`, { signal: c.signal })
      .then(decodeMovements)
      .then((data) => {
        if (data.page !== activityPage || data.size !== ACTIVITY_SIZE)
          throw new StockError("မှတ်တမ်း pagination မမှန်ပါ။", 502);
        if (active) setFinishedHistory({ key: historyKey, data });
      })
      .catch((e) => {
        if (active) {
          setHistoryError(e instanceof Error ? e.message : "မှတ်တမ်းရယူမရပါ။");
          if (e instanceof StockError && e.status === 401) setAuthExpired(true);
        }
      })
      .finally(() => {
        if (active) setHistoryBusy(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [stockKind, filters, activityPage, revision, historyKey]);
  const activity = React.useMemo(
    () =>
      stockKind === "BULK"
        ? bulkHistory?.key === dataKey
          ? bulkReceivingHistory(
              bulkHistory.receipts,
              filters,
              activityPage,
              ACTIVITY_SIZE,
            )
          : null
        : finishedHistory?.key === historyKey
          ? finishedHistory.data
          : null,
    [
      stockKind,
      bulkHistory,
      dataKey,
      filters,
      activityPage,
      finishedHistory,
      historyKey,
    ],
  );
  const activityPages = activity
    ? Math.ceil(activity.totalElements / ACTIVITY_SIZE)
    : 0;
  React.useEffect(() => {
    if (activity && activityPage > 0 && activityPage >= activityPages)
      setActivityPage(Math.max(0, activityPages - 1));
  }, [activity, activityPage, activityPages]);
  const current = result?.key === queryKey ? result : null;
  const [receivingPhotos, setReceivingPhotos] = React.useState<
    Record<string, string | null>
  >({});
  const [photoError, setPhotoError] = React.useState("");
  const photoBarcodes = JSON.stringify(
    [
      ...new Set([
        ...(current?.data.content.map((row) => row.barcode) ?? []),
        ...(detail ? [detail.barcode] : []),
        ...(activity?.content.map((r) => r.barcode) ?? []),
      ]),
    ].sort(),
  );
  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const barcodes = JSON.parse(photoBarcodes) as string[];
    setPhotoError("");
    if (stockKind === "BULK" || !barcodes.length) return;
    void Promise.allSettled(
      barcodes.map(async (barcode) => {
        // Use the same Source decoder and photo resolver as the Receiving page.
        const source = decodeSource(
          await receivingRequest(
            `/sources?${new URLSearchParams({ barcode })}`,
            { signal: controller.signal },
          ),
        );
        if (source.barcode !== barcode)
          throw new Error("Receiving barcode မကိုက်ညီပါ။");
        return [barcode, photoOf(source) || null] as const;
      }),
    ).then((results) => {
      if (!active) return;
      const photos: Record<string, string | null> = {};
      for (const result of results) {
        if (result.status === "fulfilled")
          photos[result.value[0]] = result.value[1];
      }
      setReceivingPhotos((previous) => ({ ...previous, ...photos }));
      if (results.some((result) => result.status === "rejected"))
        setPhotoError(
          "အချို့ပစ္စည်းပုံများကို Receiving မှ ရယူမရပါ။ ပြန်တင်ရန် နှိပ်ပြီး စမ်းပါ။",
        );
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [photoBarcodes, revision, stockKind]);
  React.useEffect(() => {
    if (!current) return;
    setDetail((previous) =>
      previous && "quantity" in previous
        ? (current.data.content.find((r) => rowKey(r) === rowKey(previous)) ??
          null)
        : previous,
    );
  }, [current]);
  const total = current?.data.totalElements;
  const totalPages = total === undefined ? 0 : Math.ceil(total / SIZE);
  const warehouseName = (id: number) =>
    warehouses.find((w) => w.id === id)?.name || `Warehouse #${id}`;
  const locationName = (id: number) =>
    locationNames[id] ||
    locations.find((l) => l.id === id)?.name ||
    `Location #${id}`;
  const skuCount = current
    ? new Set(current.data.content.map((r) => r.barcode)).size
    : null;
  const connectionText = authExpired
    ? "Login ပြန်ဝင်ရန်"
    : connection === "live"
      ? "တိုက်ရိုက်ချိတ်ဆက်ထား"
      : connection === "paused"
        ? "ယာယီရပ်ထား"
        : connection === "polling"
          ? "၅ စက္ကန့်တစ်ကြိမ် စစ်နေသည်"
          : connection === "retrying"
            ? "ပြန်ချိတ်နေသည် · ၅ စက္ကန့်တစ်ကြိမ် စစ်မည်"
            : "ချိတ်ဆက်နေသည်…";
  const balances = current?.kind === "balances" ? current.data.content : [];
  const selected =
    balances.find((r) => rowKey(r) === selectedKey) ?? balances[0] ?? null;
  const sourceReceipts =
    selected?.stockKind === "BULK" && bulkHistory?.key === dataKey
      ? bulkHistory.receipts.filter(
          (r) =>
            stockKey({
              itemId: r.costingItemId,
              sourceVersion: r.sourceVersion,
              warehouseId: r.warehouseId,
              locationId: r.locationId,
              batch: r.batch,
            }) === rowKey(selected),
        )
      : [];
  const sourceText = sourceReceipts.length
    ? sourceReceipts.map((r) => r.receivingNumber).join(", ")
    : "—";
  function applyFilters(next: Filters) {
    setDraft(next);
    setFilters({
      ...next,
      search: next.search.trim(),
      batch: next.batch.trim(),
    });
    setPage(0);
    setActivityPage(0);
    setSelectedKey(null);
  }
  function changeStockKind(value: string) {
    if (value !== "BULK" && value !== "FINISHED") return;
    setStockKind(value);
    setPage(0);
    setActivityPage(0);
    setSelectedKey(null);
    setDetail(null);
    setMappingOpen(false);
  }
  const stockTabs = (
    <Tabs value={stockKind} onValueChange={changeStockKind}>
      <TabsList
        className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border bg-muted/30 p-1"
        aria-label="စတော့အမျိုးအစား"
      >
        <TabsTrigger
          value="BULK"
          className="min-h-10 gap-2 rounded-lg border border-transparent px-2 py-2 text-xs data-[state=active]:border-blue-500 data-[state=active]:bg-background data-[state=active]:text-blue-600"
        >
          <Boxes className="size-4" />
          အထုပ်ကြီး Stock
        </TabsTrigger>
        <TabsTrigger
          value="FINISHED"
          className="min-h-10 gap-2 rounded-lg border border-transparent px-2 py-2 text-xs data-[state=active]:border-blue-500 data-[state=active]:bg-background data-[state=active]:text-blue-600"
        >
          <Package className="size-4" />
          Finished Stock
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
  return (
    <main
      lang="my"
      className="mx-auto min-h-[calc(100dvh-4rem)] min-w-0 max-w-[1480px] space-y-5 bg-gradient-to-br from-blue-50/60 via-background to-slate-50/60 p-3 text-foreground dark:from-blue-950/20 dark:to-background sm:p-5 lg:p-6"
      style={{
        fontFamily: '"Noto Sans Myanmar", "Myanmar Text", sans-serif',
      }}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-relaxed tracking-tight sm:text-3xl">
            ဂိုဒေါင်ပစ္စည်းစာရင်း
          </h1>
          <p className="mt-1 text-sm leading-7 text-muted-foreground">
            Warehouse <span className="px-2">•</span>
            {stockKind === "BULK"
              ? "အထုပ်ကြီး လက်ကျန်"
              : "ထုတ်လုပ်ပြီး လက်ကျန်"}
          </p>
        </div>
        <p
          role="status"
          className={`flex items-center gap-1.5 text-[11px] leading-6 ${authExpired ? "text-destructive" : "text-muted-foreground"}`}
        >
          {connection === "live" && !authExpired ? (
            <Wifi className="size-3.5 text-emerald-600" />
          ) : (
            <Clock3 className="size-3.5" />
          )}
          {connectionText}
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <p className="text-xs leading-6 text-muted-foreground">ဖယ်သိမ်းခြင်းသည် ဤ Warehouse / နေရာ / Batch ကို စာရင်းမှဖယ်ခြင်းသာဖြစ်ပြီး Stock ပမာဏ မပြောင်းပါ။</p>
        <Button type="button" variant="outline" disabled={!archiveReady||archiveBusy} onClick={()=>setArchiveHistory(true)}><Archive className="mr-2 size-4"/>ဖယ်သိမ်းစာရင်း ({archives.length})</Button>
      </div>
      {archiveError&&<p role="alert" className="rounded-xl border border-amber-300 p-3 text-xs leading-7 text-amber-800 dark:text-amber-300">{archiveError}</p>}
      {archiveMessage&&<p role="status" className="rounded-xl border p-3 text-sm leading-7">{archiveMessage}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters(draft);
        }}
        className="grid min-w-0 grid-cols-2 gap-3 min-[1100px]:grid-cols-[minmax(180px,1.8fr)_auto_minmax(140px,1fr)_minmax(150px,1fr)_auto]"
      >
        <div className="relative col-span-2 min-w-0 min-[1100px]:col-span-1">
          <Button
            type="submit"
            variant="ghost"
            aria-label="ရှာရန်"
            className="absolute inset-y-0 left-0 z-10 h-full w-11 px-0 text-muted-foreground"
          >
            <Search className="size-5" />
          </Button>
          <Input
            ref={searchRef}
            aria-label="ပစ္စည်းအမည် / Barcode"
            value={draft.search}
            maxLength={200}
            placeholder="ဘားကုဒ် သို့မဟုတ် ပစ္စည်းအမည် ရှာရန်…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) =>
              setDraft((f) => ({ ...f, search: e.target.value }))
            }
            className="h-12 bg-card pl-11 text-sm"
          />
        </div>
        <Button
          type="button"
          onClick={() => {
            setCameraAttempt((v) => v + 1);
            setCameraOpen(true);
          }}
          disabled={authExpired}
          className="h-12 gap-2 bg-blue-600 px-5 text-white hover:bg-blue-700"
          aria-label="Tablet camera ဖြင့် barcode scan ဖတ်ရန်"
        >
          <Camera className="size-5" />
          Scan
        </Button>
        <div className="relative min-w-0">
          <Warehouse className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <select
            aria-label="Warehouse"
            className={`${fieldClass} h-12 bg-card pl-10`}
            value={draft.warehouseId}
            onChange={(e) =>
              applyFilters({
                ...draft,
                warehouseId: e.target.value,
                locationId: "",
              })
            }
          >
            <option value="">ဂိုဒေါင်အားလုံး</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {!w.active ? " (ပိတ်ထားသည်)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="relative min-w-0">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <select
            aria-label="Location / Rack"
            className={`${fieldClass} h-12 bg-card pl-10`}
            value={draft.locationId}
            disabled={!draft.warehouseId || locationBusy}
            onChange={(e) =>
              applyFilters({ ...draft, locationId: e.target.value })
            }
          >
            <option value="">
              {locationBusy ? "ရယူနေသည်…" : "နေရာအားလုံး"}
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {!l.active ? " (ပိတ်ထားသည်)" : ""}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={authExpired}
          onClick={() => {
            setPlaceRevision((v) => v + 1);
            refresh();
          }}
          className="h-12 border-blue-500 bg-card px-4 text-blue-600"
        >
          <RefreshCw className={`size-5 ${busy ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </form>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs leading-6 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
            <Package className="size-5" />
            ဤစာမျက်နှာ: <strong>{skuCount ?? "—"}</strong> မျိုး
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-xs leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Database className="size-5" />
            {stockKind === "BULK" ? "အထုပ်ကြီး Stock" : "Finished Stock"}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <Clock3 className="size-5" />
            နောက်ဆုံးရယူချိန်{" "}
            <strong>
              {updated ? (
                <time dateTime={updated}>
                  {new Date(updated).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              ) : (
                "—"
              )}
            </strong>
          </div>
        </div>
        <details className="min-w-0 text-xs text-muted-foreground">
          <summary className="cursor-pointer py-2 leading-6">
            Batch ဖြင့်စစ်ရန် / Filter ရှင်းရန်
          </summary>
          <div className="mt-2 flex max-w-full flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
            <Field label="Batch (အတိအကျ)">
              <Input
                value={draft.batch}
                maxLength={100}
                onChange={(e) =>
                  setDraft((f) => ({ ...f, batch: e.target.value }))
                }
                className="w-40"
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              onClick={() => applyFilters(draft)}
              disabled={authExpired}
            >
              စစ်ရန်
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => applyFilters(emptyFilters)}
            >
              ရှင်းရန်
            </Button>
          </div>
        </details>
      </div>
      {placeError && (
        <p role="alert" className="text-xs leading-6 text-destructive">
          {placeError}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm leading-7 text-destructive"
        >
          <p>
            {error}
            {current
              ? " ပြထားသော data သည် နောက်ဆုံးရယူထားသည့်အခြေအနေ ဖြစ်ပါသည်။"
              : ""}
          </p>
          {!authExpired && (
            <Button variant="outline" onClick={refresh}>
              ပြန်စမ်းရန်
            </Button>
          )}
        </div>
      )}
      {photoError && (
        <p role="status" className="text-xs leading-6 text-amber-700">
          {photoError}
        </p>
      )}
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 space-y-5">
          {busy && !current && (
            <div
              className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground"
            ><LoadingScreen variant="section" title="စတော့စာရင်း ရယူနေသည်…" /></div>
          )}
          {!busy && !error && current && !balances.length && (
            <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
              <Package className="mx-auto mb-3 size-10 text-muted-foreground" />
              <p className="text-sm leading-7">
                ဒီစစ်ထုတ်မှုအတွက် လက်ကျန်စာရင်း မရှိသေးပါ။
              </p>
              <p className="mt-2 text-xs leading-7 text-muted-foreground">
                Stock ဝင်ရန် Receiving ကို အတည်ပြုပါ။
              </p>
            </div>
          )}
          <div
            className="grid min-w-0 gap-2.5"
            style={{
              gridTemplateColumns:
                "repeat(auto-fit,minmax(min(100%,150px),1fr))",
            }}
            aria-label="ဂိုဒေါင်ပစ္စည်းများ"
            aria-busy={busy}
          >
            {balances.map((r) => {
              const active = selected && rowKey(selected) === rowKey(r);
              return (
                <button
                  type="button"
                  key={rowKey(r)}
                  aria-label={`${r.name} အသေးစိတ်ကြည့်ရန်`}
                  aria-pressed={!!active}
                  onClick={() => {
                    setSelectedKey(rowKey(r));
                    if (window.matchMedia("(max-width: 1023px)").matches)
                      requestAnimationFrame(() =>
                        document
                          .getElementById("warehouse-product-detail")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                      );
                  }}
                  className={`group w-full max-w-[200px] min-w-0 overflow-hidden rounded-xl border bg-card p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-blue-600 bg-blue-50/70 ring-1 ring-blue-500 dark:bg-blue-950/30" : "hover:border-blue-300 hover:shadow-sm"}`}
                >
                  <ProductImage
                    product={r}
                    imageUrl={receivingPhotos[r.barcode]}
                    tile
                  />
                  <h2 className="mt-2 line-clamp-2 min-h-8 break-words text-sm font-semibold leading-6">
                    {r.name}
                  </h2>
                  <p
                    className={`mt-1 break-words text-sm font-semibold leading-6 ${active ? "text-blue-600 dark:text-blue-300" : "text-foreground"}`}
                  >
                    {r.stockKind === "BULK" && r.unit === "ကျပ်သား"
                      ? vissWeight(r.quantity)
                      : r.stockKind === "BULK"
                      ? packageRemainder(
                          r.quantity,
                          r.quantityPerPackage!,
                          r.packageUnit!,
                          r.unit,
                        )
                      : warehouseAmount(r.quantity, r.unit)}
                  </p>
                  {r.stockKind === "BULK" && (
                    <p className="text-xs font-medium leading-6 text-muted-foreground">
                      {quantity(r.quantity)} {r.unit}
                    </p>
                  )}
                  <p
                    className="mt-1 truncate text-[10px] leading-5 text-muted-foreground"
                    title={`${r.batch} · ${locationName(r.locationId)}`}
                  >
                    {r.batch} · {locationName(r.locationId)}
                  </p>
                </button>
              );
            })}
          </div>
          {total !== undefined && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {total.toLocaleString()} စာရင်း · {totalPages ? page + 1 : 0} /{" "}
                {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="ပစ္စည်း ယခင်စာမျက်နှာ"
                  disabled={page === 0 || busy || authExpired}
                  onClick={() => setPage((v) => v - 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="ပစ္စည်း နောက်စာမျက်နှာ"
                  disabled={
                    !totalPages || page + 1 >= totalPages || busy || authExpired
                  }
                  onClick={() => setPage((v) => v + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
          <section
            className="min-w-0 overflow-hidden rounded-2xl border bg-card p-3 sm:p-4"
            aria-label="Stock မှတ်တမ်း"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold leading-8">
                {stockKind === "BULK"
                  ? "လတ်တလော လက်ခံမှုမှတ်တမ်းများ"
                  : "လတ်တလော Stock လှုပ်ရှားမှုများ"}
              </h2>
              {(historyBusy || busy) && (
                <Loader2
                  aria-label="မှတ်တမ်း ပြန်ယူနေသည်"
                  className="size-4 animate-spin text-muted-foreground"
                />
              )}
            </div>
            {historyError && (
              <p
                role="alert"
                className="mb-3 text-xs leading-6 text-destructive"
              >
                {historyError}
              </p>
            )}
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="rounded-l-lg p-3 font-medium">Date</th>
                    <th className="p-3 font-medium">Item</th>
                    <th className="p-3 font-medium">Activity</th>
                    <th className="rounded-r-lg p-3 text-right font-medium">
                      Quantity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activity?.content.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap p-3 text-muted-foreground">
                        <time dateTime={r.createdAt}>
                          {new Date(r.createdAt).toLocaleDateString([], {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </time>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => setDetail(r)}
                          className="flex items-center gap-2 text-left hover:text-blue-600"
                          aria-label={`${r.name} မှတ်တမ်းအသေးစိတ်`}
                        >
                          <ProductImage
                            product={r}
                            imageUrl={receivingPhotos[r.barcode]}
                            compact
                          />
                          <span className="max-w-36 break-words leading-6">
                            {r.name}
                            <span className="block text-[10px] text-muted-foreground">
                              {r.batch}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`whitespace-nowrap border-0 px-2.5 py-1.5 font-normal ${r.type === "STOCK_IN" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"}`}
                        >
                          {r.type === "STOCK_IN" ? "Receiving" : "Checkout"}
                        </Badge>
                      </td>
                      <td
                        className={`whitespace-nowrap p-3 text-right text-sm font-semibold tabular-nums ${r.type === "STOCK_IN" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}
                      >
                        {isPositive(r.delta) ? "+" : ""}
                        {warehouseAmount(r.delta, r.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {activity && !activity.content.length && (
                <p className="p-6 text-center text-xs leading-7 text-muted-foreground">
                  ဤစစ်ထုတ်မှုအတွက် မှတ်တမ်းမရှိသေးပါ။
                </p>
              )}
              {!activity && !historyError && (
                <p className="p-6 text-center text-xs leading-7 text-muted-foreground">
                  မှတ်တမ်း ရယူနေသည်…
                </p>
              )}
            </div>
            <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] leading-6 text-muted-foreground">
              <p className="max-w-md">
                {stockKind === "BULK"
                  ? "အတည်ပြုပြီးသော Receiving အဝင်များကို ပြထားပါသည်။ လက်ကျန်ကို Server မှ တိုက်ရိုက်ရယူပါသည်။"
                  : "လက်ကျန်မှ ရောင်းပြီးပမာဏကို ထပ်မနုတ်ပါ။"}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="မှတ်တမ်း ယခင်စာမျက်နှာ"
                  disabled={
                    activityPage === 0 || busy || historyBusy || authExpired
                  }
                  onClick={() => setActivityPage((v) => v - 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="grid size-8 place-items-center rounded-md bg-blue-600 font-semibold text-white">
                  {activityPages ? activityPage + 1 : 0}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="မှတ်တမ်း နောက်စာမျက်နှာ"
                  disabled={
                    !activityPages ||
                    activityPage + 1 >= activityPages ||
                    busy ||
                    historyBusy ||
                    authExpired
                  }
                  onClick={() => setActivityPage((v) => v + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
                <span className="ml-2">
                  {activity?.totalElements ?? "—"} စာရင်း
                </span>
              </div>
            </footer>
          </section>
        </div>
        <aside
          id="warehouse-product-detail"
          aria-label="ပစ္စည်းအသေးစိတ်"
          className="min-w-0 scroll-mt-4 rounded-2xl border bg-card p-3 shadow-sm lg:sticky lg:top-4"
        >
          {stockTabs}
          <h2 className="mt-4 text-lg font-semibold leading-8">
            ပစ္စည်းအသေးစိတ်
          </h2>
          {selected ? (
            <>
              <div className="my-3 flex items-center gap-3">
                <div className="w-20 shrink-0">
                  <ProductImage
                    product={selected}
                    imageUrl={receivingPhotos[selected.barcode]}
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="break-words text-lg font-semibold leading-8">
                    {selected.name}
                  </h3>
                  <p className="break-all text-xs leading-6 text-muted-foreground">
                    Barcode: {selected.barcode}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <StockMetric
                  icon={<ArrowDownLeft className="size-5" />}
                  label="မူလလက်ခံဝင်"
                  value={
                    selected.receivedQuantity == null
                      ? "—"
                      : warehouseAmount(selected.receivedQuantity, selected.unit)
                  }
                  description={
                    selected.stockKind === "BULK" &&
                    selected.receivedQuantity != null
                      ? packageRemainder(
                          selected.receivedQuantity,
                          selected.quantityPerPackage!,
                          selected.packageUnit!,
                          selected.unit,
                        )
                      : undefined
                  }
                  color="blue"
                />
                {selected.stockKind === "BULK" ? (
                  <StockMetric
                    icon={<Cog className="size-5" />}
                    label="Production ထုတ်ယူပြီး"
                    value={selected.productionConsumedQuantity == null
                      ? "—"
                      : warehouseAmount(selected.productionConsumedQuantity, selected.unit)}
                    description={selected.productionConsumedQuantity == null
                      ? "API မှ production_consumed_quantity မပါသေးပါ"
                      : selected.productionConsumedQuantity === "0"
                        ? "ထုတ်ယူအတည်ပြုမှု မရှိသေးပါ"
                        : packageRemainder(selected.productionConsumedQuantity, selected.quantityPerPackage!, selected.packageUnit!, selected.unit)}
                    color="amber"
                  />
                ) : (
                  <StockMetric
                    icon={<ArrowUpRight className="size-5" />}
                    label="ရောင်းပြီး"
                    value={
                      selected.soldQuantity == null
                        ? "—"
                        : warehouseAmount(selected.soldQuantity, selected.unit)
                    }
                    color="amber"
                  />
                )}
                <StockMetric
                  icon={<Package className="size-6" />}
                  label="လက်ရှိလက်ကျန်"
                  value={warehouseAmount(selected.quantity, selected.unit)}
                  description={
                    selected.stockKind === "BULK"
                      ? packageRemainder(
                          selected.quantity,
                          selected.quantityPerPackage!,
                          selected.packageUnit!,
                          selected.unit,
                        )
                      : undefined
                  }
                  color="green"
                />
              </div>
              <dl className="mt-3 overflow-hidden rounded-xl border text-xs">
                {[
                  ["Batch No.", selected.batch],
                  ["Warehouse", warehouseName(selected.warehouseId)],
                  ["Location", locationName(selected.locationId)],
                  [
                    "Unit",
                    selected.stockKind === "BULK"
                      ? `${quantity(selected.quantityPerPackage!)} ${selected.unit} / ${selected.packageUnit}`
                      : selected.unit,
                  ],
                  ["Source", sourceText],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[90px_minmax(0,1fr)] border-b last:border-0"
                  >
                    <dt className="bg-muted/40 px-3 py-1.5 leading-5 text-muted-foreground">
                      {label}
                    </dt>
                    <dd
                      className="min-w-0 break-words px-3 py-1.5 leading-5"
                      title={value}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.unit === "ကျပ်သား" && <p className="mt-3 rounded-xl border p-3 text-xs leading-7 text-muted-foreground">1 ပိဿာ = 100 ကျပ်သား။ ပိဿာနှင့် ကျပ်သားသည် Stock တစ်ခုတည်းကို ဖော်ပြခြင်းဖြစ်ပါသည်။ ပိဿာပြထားသောပမာဏကို Stock ထဲ ထပ်မပေါင်းပါနှင့်။</p>}
              <div className="mt-3 flex gap-2 rounded-xl bg-blue-50 p-3 text-xs leading-6 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                <Info className="mt-1 size-4 shrink-0" />
                <p>
                  {selected.stockKind === "BULK"
                    ? "လက်ကျန်သည် Production ထုတ်ယူမှု နုတ်ပြီးသားဖြစ်၍ ထပ်မနုတ်ပါ။ အထုပ်နှင့် kg / L / ခု သည် Stock တစ်ခုတည်း၏ ဖော်ပြချက်နှစ်မျိုးဖြစ်ပါသည်။"
                    : "ရောင်းပြီးပမာဏကို လက်ကျန်မှ ထပ်မနုတ်ပါ။"}
                </p>
              </div>
              {selected.stockKind === "BULK" ? (
                <Link
                  href={`/factory/production?${new URLSearchParams({ itemId: String(selected.itemId), sourceVersion: String(selected.sourceVersion), warehouseId: String(selected.warehouseId), locationId: String(selected.locationId), batch: selected.batch })}`}
                  className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 whitespace-normal rounded-xl bg-blue-600 px-4 text-sm font-medium leading-6 text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2"
                >
                  <Cog className="size-5 shrink-0" />
                  Production သို့သွားရန်
                </Link>
              ) : (
                <Button
                  className="mt-3 min-h-12 w-full"
                  disabled={authExpired}
                  onClick={() => setMappingOpen(true)}
                >
                  <Link2 className="size-4" />
                  POS ပစ္စည်းချိတ်ရန်
                </Button>
              )}
              <Button type="button" variant="outline" className="mt-2 w-full text-amber-700 dark:text-amber-300" disabled={!archiveReady||archiveBusy||busy||authExpired} onClick={()=>beginArchive(selected)}><Archive className="mr-2 size-4"/>စာရင်းမှဖယ်သိမ်းရန်</Button>
              <Button
                variant="ghost"
                className="mt-1 w-full text-xs text-muted-foreground"
                onClick={() => setDetail(selected)}
              >
                အသေးစိတ် ထပ်ကြည့်ရန်
              </Button>
            </>
          ) : (
            <div className="py-12 text-center text-xs leading-7 text-muted-foreground">
              <Package className="mx-auto mb-3 size-10 opacity-40" />
              {busy
                ? "ပစ္စည်းစာရင်း ရယူနေသည်…"
                : "ပစ္စည်းရွေးရန် စာရင်းမရှိသေးပါ။"}
            </div>
          )}
        </aside>
      </div>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent
          style={{
            fontFamily: '"Noto Sans Myanmar", "Myanmar Text", sans-serif',
          }}
          className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-4xl gap-3 overflow-y-auto rounded-2xl p-4 sm:max-w-4xl sm:p-5"
        >
          <DialogHeader>
            <DialogTitle className="pr-7 text-base leading-7">
              {detail?.name || "ပစ္စည်းအသေးစိတ်"}
            </DialogTitle>
            <DialogDescription>
              ဂိုဒေါင်၊ Batch နှင့် စတော့မှတ်တမ်း
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <ProductDetail
              key={rowKey(detail)}
              product={detail}
              imageUrl={receivingPhotos[detail.barcode]}
              warehouse={warehouseName(detail.warehouseId)}
              location={locationName(detail.locationId)}
            />
          )}
          <DialogFooter>
            {detail&&"quantity" in detail&&<Button type="button" variant="outline" disabled={!archiveReady||archiveBusy||authExpired} onClick={()=>{beginArchive(detail);setDetail(null);}}><Archive className="mr-2 size-4"/>စာရင်းမှဖယ်သိမ်းရန်</Button>}
            <Button variant="outline" onClick={() => setDetail(null)}>
              ပိတ်မည်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={archiveHistory} onOpenChange={setArchiveHistory}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>ဖယ်သိမ်းထားသော Warehouse စာရင်း</DialogTitle><DialogDescription>Bulk နှင့် Finished Stock ၏ Warehouse / နေရာ / Batch အလိုက် ဖယ်သိမ်းထားခြင်း ဖြစ်ပါသည်။ Stock ပမာဏနှင့် ယခင်မှတ်တမ်းများကို ထိန်းထားပါသည်။</DialogDescription></DialogHeader>
          {!archives.length&&<p className="py-6 text-center text-sm text-muted-foreground">ဖယ်သိမ်းထားသော ပစ္စည်း မရှိသေးပါ။</p>}
          {archives.map(row=><div key={archiveKey(row.key)} className="space-y-2 rounded-xl border p-3 text-sm leading-7"><p className="font-semibold">{row.name}</p><p className="text-xs text-muted-foreground">{row.key.stockKind} · Batch {row.key.batch} · Warehouse #{row.key.warehouseId} / နေရာ #{row.key.locationId}</p><p className="whitespace-pre-wrap break-words text-xs">အကြောင်းပြချက် — {row.reason}</p><p className="text-xs text-muted-foreground"><Stamp value={row.archivedAt}/></p><Button type="button" variant="outline" disabled={archiveBusy||!archiveReady} onClick={()=>{setArchiveHistory(false);setArchiveConfirmation("");setArchiveReason("");setArchiveAction({key:row.key,name:row.name,restore:true});}}><ArchiveRestore className="mr-2 size-4"/>စာရင်းတွင် ပြန်ဖော်မည်</Button></div>)}
          <DialogFooter><Button variant="outline" onClick={()=>setArchiveHistory(false)}>ပိတ်မည်</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!archiveAction} onOpenChange={open=>{if(!archiveLock.current&&!open)setArchiveAction(null);}}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{archiveAction?.restore?"Warehouse စာရင်းတွင် ပြန်ဖော်မလား။":"Warehouse စာရင်းမှ ဖယ်သိမ်းမလား။"}</DialogTitle><DialogDescription>Stock ပမာဏ၊ Receiving၊ Production၊ အော်ဒါနှင့် Costing မှတ်တမ်းများကို မပြောင်းပါ။ Costing ကို အပြီးဖျက်ခွင့်ပေးခြင်းလည်း မဟုတ်ပါ။</DialogDescription></DialogHeader>
          <div className="rounded-xl border p-3 text-sm leading-7"><p className="font-semibold">{archiveAction?.name}</p><p className="break-all text-xs">{archiveAction?.key.stockKind} · Batch {archiveAction?.key.batch} · Warehouse #{archiveAction?.key.warehouseId} / နေရာ #{archiveAction?.key.locationId}</p></div>
          {!archiveAction?.restore&&<div className="space-y-2"><Label htmlFor="warehouse-archive-reason">ဖယ်သိမ်းရသည့်အကြောင်းပြချက် *</Label><textarea id="warehouse-archive-reason" value={archiveReason} maxLength={1000} rows={3} disabled={archiveBusy} onChange={e=>setArchiveReason(e.target.value)} className="w-full rounded-xl border bg-background p-3 text-sm"/></div>}
          <div className="space-y-2"><Label htmlFor="warehouse-archive-confirmation">အတည်ပြုရန် ပစ္စည်းအမည်ကို ပြန်ရိုက်ပါ</Label><Input id="warehouse-archive-confirmation" value={archiveConfirmation} disabled={archiveBusy} autoComplete="off" onChange={e=>setArchiveConfirmation(e.target.value)}/></div>
          <DialogFooter><Button variant="outline" disabled={archiveBusy} onClick={()=>setArchiveAction(null)}>မလုပ်တော့ပါ</Button><Button disabled={archiveBusy||!archiveReady||!archiveAction||archiveConfirmation.trim()!==archiveAction.name.trim()||!archiveAction.restore&&!archiveReason.trim()} onClick={()=>void saveArchive()}>{archiveBusy?<Loader2 className="mr-2 size-4 animate-spin"/>:<Archive className="mr-2 size-4"/>}{archiveAction?.restore?"အတည်ပြု၍ ပြန်ဖော်မည်":"အတည်ပြု၍ ဖယ်သိမ်းမည်"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent
          style={{
            fontFamily: '"Noto Sans Myanmar", "Myanmar Text", sans-serif',
          }}
          className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>Warehouse Barcode Scan</DialogTitle>
            <DialogDescription>
              Tablet နောက်ကင်မရာဖြင့် FC barcode ဖတ်ပါ။ ဖတ်မိလျှင် လက်ရှိ filter
              များနှင့် ပစ္စည်းကို ရှာပါမည်။
            </DialogDescription>
          </DialogHeader>
          {cameraOpen && (
            <WarehouseCameraScanner
              key={cameraAttempt}
              onClose={closeCamera}
              onScan={(code) => {
                closeCamera();
                applyFilters({ ...draft, search: code });
              }}
            />
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCameraAttempt((v) => v + 1)}
            >
              Camera ပြန်ဖွင့်ရန်
            </Button>
            <Button variant="outline" onClick={closeCamera}>
              ပိတ်မည်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {mappingOpen && (
        <MappingDialog
          warehouses={warehouses}
          onClose={() => setMappingOpen(false)}
          onSaved={refresh}
        />
      )}
    </main>
  );
}
function StockMetric({
  icon,
  label,
  value,
  description,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description?: string;
  color: "blue" | "amber" | "green";
}) {
  const colors = {
    blue: "border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
    amber:
      "border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    green:
      "border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-3 ${colors[color]}`}
    >
      <span className="flex items-center gap-2 text-xs leading-6">
        {icon}
        {label}
      </span>
      <div className="min-w-0 text-right">
        <strong className="break-all text-lg font-bold leading-7 tabular-nums">
          {value}
        </strong>
        {description && (
          <p className="break-words text-[10px] leading-5">{description}</p>
        )}
      </div>
    </div>
  );
}
function MappingDialog({
  warehouses,
  onClose,
  onSaved,
}: {
  warehouses: Place[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [productSearch, setProductSearch] = React.useState(""),
    [productQuery, setProductQuery] = React.useState(""),
    [products, setProducts] = React.useState<PosProduct[]>([]),
    [productsBusy, setProductsBusy] = React.useState(false),
    [productError, setProductError] = React.useState(""),
    [productRevision, setProductRevision] = React.useState(0),
    [product, setProduct] = React.useState<PosProduct | null>(null);
  const [receiptSearch, setReceiptSearch] = React.useState(""),
    [receiptQuery, setReceiptQuery] = React.useState(""),
    [receiptPage, setReceiptPage] = React.useState(0),
    [receiptPages, setReceiptPages] = React.useState(0),
    [receipts, setReceipts] = React.useState<ReceiptOption[]>([]),
    [receiptsBusy, setReceiptsBusy] = React.useState(false),
    [receiptError, setReceiptError] = React.useState(""),
    [receiptRevision, setReceiptRevision] = React.useState(0),
    [receipt, setReceipt] = React.useState<ReceiptOption | null>(null);
  const [ratio, setRatio] = React.useState("1"),
    [unit, setUnit] = React.useState(""),
    [confirm, setConfirm] = React.useState(false),
    [saving, setSaving] = React.useState(false),
    [saved, setSaved] = React.useState(false),
    [uncertain, setUncertain] = React.useState(false),
    [error, setError] = React.useState("");
  const lock = React.useRef(false),
    mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    let active = true;
    const c = new AbortController();
    setProductsBusy(true);
    setProductError("");
    setProducts([]);
    void api(
      `/api/factory/stock/products?${new URLSearchParams({ q: productQuery })}`,
      { signal: c.signal },
    )
      .then(decodeProducts)
      .then((v) => {
        if (active) setProducts(v);
      })
      .catch((e) => {
        if (active)
          setProductError(
            e instanceof Error ? e.message : "POS ပစ္စည်းစာရင်းမရပါ။",
          );
      })
      .finally(() => {
        if (active) setProductsBusy(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [productQuery, productRevision]);
  React.useEffect(() => {
    let active = true;
    const c = new AbortController();
    setReceiptsBusy(true);
    setReceiptError("");
    setReceipts([]);
    const q = new URLSearchParams({
      status: "CONFIRMED",
      page: String(receiptPage),
      size: "6",
    });
    if (receiptQuery) q.set("barcode", receiptQuery);
    void api(`/api/factory/receivings?${q}`, { signal: c.signal })
      .then((v) => {
        if (
          !v ||
          typeof v !== "object" ||
          !Array.isArray((v as { content?: unknown }).content)
        )
          throw new StockError("Receiving response မမှန်ပါ။", 502);
        const response = v as { content: unknown[] };
        return decodeReceiptOptions({
          ...response,
          content: response.content.filter(
            (r) =>
              !!r &&
              typeof r === "object" &&
              (r as { stockKind?: string }).stockKind !== "BULK",
          ),
        });
      })
      .then((p) => {
        if (p.page !== receiptPage) throw new Error("Receiving page မမှန်ပါ။");
        if (active) {
          setReceipts(p.content);
          setReceiptPages(p.totalPages);
        }
      })
      .catch((e) => {
        if (active)
          setReceiptError(
            e instanceof Error ? e.message : "Receiving စာရင်းမရပါ။",
          );
      })
      .finally(() => {
        if (active) setReceiptsBusy(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [receiptQuery, receiptPage, receiptRevision]);
  function ready() {
    if (!product || !receipt) {
      setError("POS ပစ္စည်းနှင့် အတည်ပြုပြီး Receiving ကို ရွေးပါ။");
      return;
    }
    if (
      !/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/.test(ratio) ||
      BigInt(ratio.replace(".", "")) === BigInt(0)
    ) {
      setError(
        "Stock units per POS sale ကို အပေါင်းကိန်းဖြည့်ပါ။ ဒဿမ 12 နေရာအထိ သုံးနိုင်ပါသည်။",
      );
      return;
    }
    if (!unit.trim() || unit.trim().length > 200) {
      setError("POS ရောင်းယူနစ် 1–200 စာလုံး ဖြည့်ပါ။");
      return;
    }
    setError("");
    setConfirm(true);
  }
  async function save() {
    if (lock.current || !product || !receipt || uncertain || saved) return;
    lock.current = true;
    setSaving(true);
    setConfirm(false);
    setError("");
    try {
      const v = (await api(`/api/factory/stock/mappings/${product.id}`, {
        method: "POST",
        body: JSON.stringify({
          receivingId: receipt.id,
          stockUnitsPerSale: ratio,
          posUnit: unit.trim(),
        }),
      })) as { productId?: number; receivingId?: number };
      if (v?.productId !== product.id || v?.receivingId !== receipt.id)
        throw new StockError(
          "ချိတ်ဆက်ပြီးဖြစ်နိုင်သော်လည်း response ဖတ်မရပါ။",
          502,
          true,
        );
      if (mounted.current) {
        setSaved(true);
        onSaved();
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "ချိတ်ဆက်မရပါ။");
        if (!(e instanceof StockError) || e.uncertain) setUncertain(true);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        style={{
          fontFamily: '"Noto Sans Myanmar", "Myanmar Text", sans-serif',
        }}
        className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle>
            POS ပစ္စည်းနှင့် Warehouse stock ချိတ်ဆက်ရန်
          </DialogTitle>
          <DialogDescription className="leading-7">
            Checkout အောင်မြင်သောအခါ ရွေးထားသော Receiving ၏ Warehouse / Batch မှ
            စတော့နုတ်ပါမည်။ ချိတ်ပြီးသား POS product ကို ဒီ API ဖြင့်
            ပြန်ပြောင်းမရပါ။
          </DialogDescription>
        </DialogHeader>
        {saved ? (
          <div
            role="status"
            className="space-y-3 rounded-xl bg-emerald-50 p-5 text-sm leading-7 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
          >
            <CheckCircle2 className="size-7" />
            <p>POS product နှင့် Warehouse stock ချိတ်ဆက်ပြီးပါပြီ။</p>
            <p>
              {product?.name} → {receipt?.receivingNumber} / {receipt?.batch}
            </p>
            <p>
              1 {unit} ရောင်းလျှင် {ratio} {receipt?.unit} နုတ်မည်။
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <section className="space-y-3 rounded-xl border p-3">
                <h3 className="text-sm font-semibold">
                  01 · POS ရောင်းကုန်ရွေးရန်
                </h3>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setProductQuery(productSearch.trim());
                    setProduct(null);
                    setProductRevision((v) => v + 1);
                  }}
                >
                  <Input
                    aria-label="POS ပစ္စည်းရှာရန်"
                    value={productSearch}
                    maxLength={200}
                    placeholder="အမည် / Barcode"
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                  <Button variant="outline" type="submit" disabled={saving}>
                    ရှာရန်
                  </Button>
                </form>
                {productsBusy && <p className="text-xs">ရယူနေသည်…</p>}
                {productError && (
                  <p role="alert" className="text-xs text-destructive">
                    {productError}
                  </p>
                )}
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {products.slice(0, 50).map((p) => (
                    <Button
                      key={p.id}
                      variant="outline"
                      disabled={saving || uncertain}
                      aria-pressed={product?.id === p.id}
                      className={`h-auto w-full justify-start whitespace-normal p-3 text-left ${product?.id === p.id ? "border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100" : ""}`}
                      onClick={() => setProduct(p)}
                    >
                      <span>
                        <span className="block text-sm leading-7">
                          {p.name}
                        </span>
                        <span className="block break-all font-mono text-[10px] leading-6">
                          ID {p.id} · {p.barcode || p.sku || "—"}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
                {!productsBusy && !productError && !products.length && (
                  <p className="text-xs text-muted-foreground">
                    POS ပစ္စည်းမရှိသေးပါ။
                  </p>
                )}
                {products.length > 50 && (
                  <p className="text-xs text-muted-foreground">
                    ပထမ 50 ခုသာ ပြထားပါသည်။ Search ဖြင့် ထပ်စစ်ပါ။
                  </p>
                )}
              </section>
              <section className="space-y-3 rounded-xl border p-3">
                <h3 className="text-sm font-semibold">
                  02 · Receiving / Batch ရွေးရန်
                </h3>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setReceiptQuery(receiptSearch.trim());
                    setReceiptPage(0);
                    setReceipt(null);
                    setReceiptRevision((v) => v + 1);
                  }}
                >
                  <Input
                    aria-label="Receiving barcode ရှာရန်"
                    value={receiptSearch}
                    maxLength={100}
                    placeholder="FC Barcode"
                    onChange={(e) => setReceiptSearch(e.target.value)}
                  />
                  <Button variant="outline" type="submit" disabled={saving}>
                    ရှာရန်
                  </Button>
                </form>
                {receiptsBusy && <p className="text-xs">ရယူနေသည်…</p>}
                {receiptError && (
                  <p role="alert" className="text-xs text-destructive">
                    {receiptError}
                  </p>
                )}
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {receipts.map((r) => (
                    <Button
                      key={r.id}
                      variant="outline"
                      disabled={saving || uncertain}
                      aria-pressed={receipt?.id === r.id}
                      className={`h-auto w-full justify-start whitespace-normal p-3 text-left ${receipt?.id === r.id ? "border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100" : ""}`}
                      onClick={() => {
                        setReceipt(r);
                        setUnit(r.unit);
                      }}
                    >
                      <span>
                        <span className="block text-sm leading-7">
                          {r.name}
                        </span>
                        <span className="block break-all text-[10px] leading-6">
                          {r.receivingNumber} · {r.batch}
                        </span>
                        <span className="block text-[10px] leading-6 text-muted-foreground">
                          {warehouses.find((w) => w.id === r.warehouseId)
                            ?.name || `Warehouse #${r.warehouseId}`}{" "}
                          · Location #{r.locationId}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
                {!receiptsBusy && !receiptError && !receipts.length && (
                  <p className="text-xs text-muted-foreground">
                    အတည်ပြုပြီး Receiving မရှိသေးပါ။
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving || receiptsBusy || receiptPage === 0}
                    onClick={() => setReceiptPage((p) => p - 1)}
                  >
                    ရှေ့
                  </Button>
                  <span className="text-[10px]">
                    {receiptPages
                      ? `${receiptPage + 1} / ${receiptPages}`
                      : "—"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      saving ||
                      receiptsBusy ||
                      !receiptPages ||
                      receiptPage + 1 >= receiptPages
                    }
                    onClick={() => setReceiptPage((p) => p + 1)}
                  >
                    နောက်
                  </Button>
                </div>
              </section>
            </div>
            <div className="grid gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-2">
              <Field label="POS ရောင်းယူနစ်">
                <Input
                  value={unit}
                  maxLength={200}
                  disabled={saving || uncertain}
                  placeholder="ဥပမာ — ထုပ် / တွဲ"
                  onChange={(e) => setUnit(e.target.value)}
                />
              </Field>
              <Field label="POS 1 ယူနစ်အတွက် နုတ်မည့် Stock ပမာဏ">
                <Input
                  value={ratio}
                  disabled={saving || uncertain}
                  inputMode="decimal"
                  onChange={(e) => setRatio(e.target.value)}
                />
              </Field>
              <p className="text-xs leading-7 text-muted-foreground sm:col-span-2">
                ဥပမာ POS မှ 1 တွဲရောင်းပြီး stock 6 ထုပ်နုတ်လိုလျှင် ပမာဏ 6
                ထည့်ပါ။ Checkout မှာ ပြောင်းပြီးသော Stock ပမာဏသည်
                အပြည့်ကိန်းဖြစ်ရပါမည်။
              </p>
            </div>
            {(product || receipt) && (
              <p className="rounded-xl border p-3 text-xs leading-7">
                ရွေးထားသည် — {product?.name || "POS မရွေးရသေး"} →{" "}
                {receipt
                  ? `${receipt.receivingNumber} / ${receipt.batch}`
                  : "Receiving မရွေးရသေး"}
              </p>
            )}
          </>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 p-3 text-xs leading-7 text-destructive"
          >
            {error}
          </p>
        )}
        {uncertain && (
          <p className="text-xs leading-7 text-amber-700 dark:text-amber-300">
            ရလဒ်မသေချာသဖြင့် ထပ်ပို့ခြင်း ပိတ်ထားပါသည်။ ဒီ backend တွင် Mapping
            ပြန်ကြည့်သည့် API မပါသေးပါ။
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>
            ပိတ်မည်
          </Button>
          {!saved && (
            <Button
              disabled={saving || uncertain || !product || !receipt}
              onClick={ready}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              ချိတ်ဆက်မည်
            </Button>
          )}
        </DialogFooter>
        <Dialog open={confirm} onOpenChange={setConfirm}>
          <DialogContent className="rounded-2xl">
            <DialogHeader>
              <DialogTitle>Stock ချိတ်ဆက်မှု အတည်ပြုရန်</DialogTitle>
              <DialogDescription className="leading-7">
                POS product ကို ဒီ Finished Receiving stock နှင့် ချိတ်ပါမည်။
                ရွေးထားသောပစ္စည်း၊ Batch နှင့် နုတ်မည့်ပမာဏကို စစ်ပါ။
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-xl bg-muted p-3 text-sm leading-7">
              <p>
                {product?.name} → {receipt?.name}
              </p>
              <p>
                {receipt?.receivingNumber} · Batch {receipt?.batch}
              </p>
              <p>
                POS 1 {unit} = Stock {ratio} {receipt?.unit}
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirm(false)}>
                မလုပ်တော့ပါ
              </Button>
              <Button onClick={() => void save()}>အတည်ပြုချိတ်ဆက်မည်</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
