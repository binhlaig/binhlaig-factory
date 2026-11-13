"use client";
import * as React from "react";
import { useSession } from "next-auth/react";
import { useZxing } from "react-zxing";
import {
  Barcode,
  Camera,
  Search,
  ListFilter,
  Package,
  Warehouse,
  History,
  Save,
  Check,
  Plus,
  Loader2,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  Settings2,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  receivingRequest as api,
  ReceivingError,
  decodeSource,
  decodeReceipt,
  decodePlaces,
  decodePage,
  sourceOf,
  photoCandidates,
  type Source,
  type Receipt,
  type Place,
  type Save as SavePayload,
  type Paged,
  isBulkReady,
  totalFor,
  displayDecimal,
} from "@/lib/receiving-bulk-api";

type Fields = {
  actual: string;
  reason: string;
  batch: string;
  warehouseId: string;
  locationId: string;
  receivedDate: string;
  expiryDate: string;
  note: string;
};
type Pending = {
  path: string;
  method: "POST" | "PUT";
  body: SavePayload | { version: number; stockKind: "BULK" };
  key?: string;
};
const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const money = (currency: string, n: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: ["JPY", "MMK"].includes(currency) ? 0 : 2 }).format(n)} ${currency === "MMK" ? "ကျပ်" : currency}`;
// Costing VISS uses exact whole kyattha under the existing named COUNT unit.
function isVissBasis(bulk?: Source["bulk"]): boolean {
  return !!bulk && bulk.packageUnit === "ပိဿာ" && bulk.baseUnit === "ကျပ်သား" &&
    totalFor("1", bulk.quantityPerPackage) === "100";
}
function kyatthaAsViss(value: string): string | null {
  if (!/^\d+(?:\.0{1,6})?$/.test(value)) return null;
  const count = BigInt(value.split(".")[0]);
  const viss = count / BigInt(100), loose = count % BigInt(100);
  return `${viss.toLocaleString("en-US")} ပိဿာ${loose ? ` ${loose} ကျပ်သား` : ""}`;
}
function packageVissTotal(packages: string, eachViss: string) {
  if (![packages, eachViss].every(v => /^[1-9]\d{0,11}$/.test(v)))
    throw new Error("အထုပ်အရေအတွက်နှင့် တစ်ထုပ်ပါ ပိဿာကို အပေါင်းအပြည့်ကိန်းဖြည့်ပါ။");
  const total = BigInt(packages) * BigInt(eachViss);
  if (total > BigInt("999999999999")) throw new Error("စုစုပေါင်း ပိဿာ ကန့်သတ်ချက်ကျော်ပါသည်။");
  return {viss:String(total),kyattha:String(total * BigInt(100))};
}
function withoutPackageNote(note: string): string {
  return note.split("\n").filter(line => !line.startsWith("အထုပ်မှတ်ချက်:")).join("\n").trimEnd();
}
function VissPackageCalculator({disabled,onApply}: {
  disabled:boolean;onApply:(viss:string,note:string)=>void;
}) {
  const id=React.useId();
  const [packages,setPackages]=React.useState("");
  const [each,setEach]=React.useState("");
  const [unit,setUnit]=React.useState("အိတ်");
  let preview:ReturnType<typeof packageVissTotal>|null=null,error="";
  try {preview=packageVissTotal(packages,each);} catch(e){if(packages||each)error=e instanceof Error?e.message:"ပမာဏစစ်ပါ။";}
  return <details className="rounded-xl border border-blue-200 p-3">
    <summary className="cursor-pointer text-xs font-semibold leading-7">အိတ် / ပုံး / ဖာ အလိုက် ရောက်ရှိပမာဏတွက်ရန်</summary>
    <fieldset disabled={disabled} className="mt-3 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor={`${id}-unit`}>အပြင်အထုပ်အမျိုးအစား</Label><select id={`${id}-unit`} value={unit} onChange={e=>setUnit(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3">{["အိတ်","ပုံး","ကတ်","ဖာ","အထုပ်"].map(u=><option key={u}>{u}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor={`${id}-count`}>ရောက်ရှိသောအထုပ်အရေအတွက်</Label><Input id={`${id}-count`} type="number" min="1" step="1" inputMode="numeric" value={packages} onChange={e=>setPackages(e.target.value)} placeholder="ဥပမာ 10" className="h-11"/></div>
        <div className="space-y-1.5"><Label htmlFor={`${id}-each`}>တစ်အထုပ်ပါ ပိဿာ</Label><Input id={`${id}-each`} type="number" min="1" step="1" inputMode="numeric" value={each} onChange={e=>setEach(e.target.value)} placeholder="ဥပမာ 20" className="h-11"/></div>
      </div>
      {error && <p role="alert" className="text-xs leading-7 text-destructive">{error}</p>}
      {preview && <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold leading-7 text-blue-900">{packages} {unit} × {each} ပိဿာ = {displayDecimal(preview.viss)} ပိဿာ / {displayDecimal(preview.kyattha)} ကျပ်သား</p>}
      <Button type="button" variant="outline" disabled={disabled||!preview} onClick={()=>{if(preview)onApply(preview.viss,`အထုပ်မှတ်ချက်: ${packages} ${unit} × ${each} ပိဿာ = ${preview.viss} ပိဿာ (${preview.kyattha} ကျပ်သား)`);}}>စုစုပေါင်းပိဿာကို အသုံးပြုမည်</Button>
      <p className="text-xs leading-7 text-muted-foreground">သိမ်းရာတွင် ပိဿာစုစုပေါင်းကို သုံးမည်။ အပြင်အထုပ်အသေးစိတ်ကို မှတ်ချက်တွင် ထည့်ပေးမည်။</p>
    </fieldset>
  </details>;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function key() {
  return crypto.randomUUID();
}
function blank(): Fields {
  return {
    actual: "",
    reason: "",
    batch: "",
    warehouseId: "",
    locationId: "",
    receivedDate: today(),
    expiryDate: "",
    note: "",
  };
}
function fromReceipt(r: Receipt): Fields {
  return {
    actual:
      r.stockKind === "BULK"
        ? String(r.bulkPackageCount)
        : String(r.actualQuantity),
    reason: r.varianceReason || "",
    batch: r.batch,
    warehouseId: String(r.warehouseId),
    locationId: String(r.locationId),
    receivedDate: r.receivedDate,
    expiryDate: r.expiryDate || "",
    note: r.note || "",
  };
}
// Receiving history uses substring barcode search. Filter exact codes locally and
// read every result page so older drafts/confirmed receipts are not missed.
async function activeReceipts(
  barcode?: string,
  signal?: AbortSignal,
): Promise<Receipt[]> {
  const found = new Map<number, Receipt>();
  for (let page = 0; ; page++) {
    const q = new URLSearchParams({ page: String(page), size: "100" });
    if (barcode) q.set("barcode", barcode);
    const result = decodePage(await api(`?${q}`, { signal }), decodeReceipt);
    if (result.number !== page)
      throw new Error("Receiving history page မမှန်ပါ။");
    for (const r of result.content)
      if (r.status !== "CANCELLED" && (!barcode || r.barcode === barcode))
        found.set(r.id, r);
    if (page + 1 >= result.totalPages) return [...found.values()];
    if (!result.content.length)
      throw new Error("Receiving history မပြည့်စုံပါ။ ပြန်တင်ပြီး စစ်ပါ။");
  }
}

function validDate(s: string) {
  const d = new Date(`${s}T12:00:00`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(d.getTime()) &&
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` ===
      s
  );
}
function validate(s: Source | null, f: Fields) {
  const e: Partial<Record<keyof Fields | "product", string>> = {};
  const n = Number(f.actual);
  if (!s) e.product = "ပစ္စည်းအရင်ရွေးပါ။";
  if (!/^\d+$/.test(f.actual) || !Number.isSafeInteger(n) || n <= 0)
    e.actual = "မှန်ကန်သော အပေါင်းအပြည့်ကိန်း ဖြည့်ပါ။";
  if (s && !isBulkReady(s))
    e.product =
      "ဆာဗာဘက်တွင် အထုပ်ကြီးလက်ခံမှု မချိတ်ရသေးပါ။ Bulk Receiving API ချိတ်ပြီးမှ Server မူကြမ်းသိမ်းနိုင်ပါမည်။";
  if (f.actual.length > 12) e.actual = "အထုပ်အရေအတွက် အလွန်များပါသည်။";
  if (
    s?.bulk &&
    (!totalFor(f.actual, s.bulk.quantityPerPackage) ||
      !totalFor(f.actual, s.bulk.purchaseCostPerPackage))
  )
    e.actual = "စုစုပေါင်းပမာဏ / တန်ဖိုး ကန့်သတ်ချက်ကို စစ်ပါ။";
  if (!f.batch.trim() || f.batch.length > 100)
    e.batch = "Batch 1–100 စာလုံး ဖြည့်ပါ။";
  if (!f.warehouseId) e.warehouseId = "ဂိုဒေါင်ရွေးပါ။";
  if (!f.locationId) e.locationId = "သိုလှောင်နေရာရွေးပါ။";
  if (!validDate(f.receivedDate) || f.receivedDate < "1900-01-01")
    e.receivedDate = "လက်ခံရက် စစ်ပါ။";
  if (
    f.expiryDate &&
    (!validDate(f.expiryDate) || f.expiryDate < f.receivedDate)
  )
    e.expiryDate = "သက်တမ်းကုန်ရက်သည် လက်ခံရက်ထက် မစောရပါ။";
  if (f.note.length > 2000) e.note = "မှတ်ချက် စာလုံး 2,000 ထက် မကျော်ရပါ။";
  return e;
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 rounded-2xl py-0 shadow-none">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-3 text-sm font-semibold leading-7">
            {title}
          </h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactElement<{
    id?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }>;
}) {
  const id = React.useId();
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id} className="text-xs leading-6">
        {label}
      </Label>
      {React.cloneElement(children, {
        id,
        "aria-invalid": !!error,
        "aria-describedby": error ? `${id}-error` : undefined,
      })}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
function Photo({ source }: { source: Source }) {
  const urls = photoCandidates(source);
  // A new source/URL list remounts the loader, including after History reopen.
  return (
    <OriginalPhoto
      key={JSON.stringify(urls)}
      urls={urls}
      name={source.productName}
    />
  );
}
function OriginalPhoto({ urls, name }: { urls: string[]; name: string }) {
  const [index, setIndex] = React.useState(0);
  const url = urls[index];
  return (
    <div
      className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted text-muted-foreground"
      title={
        url ? "မူလဝယ်ယူသောအထုပ်ပုံ" : "Costing တွင် မူလဝယ်ယူပုံ ရှိမရှိ စစ်ပါ။"
      }
    >
      {url ? (
        <img
          src={url}
          alt={name}
          className="size-full object-contain"
          onError={() => setIndex(index + 1)}
        />
      ) : (
        <Package
          className="size-8"
          aria-label="မူလဝယ်ယူပုံ မရှိပါ သို့မဟုတ် ဖွင့်မရပါ။"
        />
      )}
    </div>
  );
}
// Reuses the same react-zxing camera/decoder flow as Product Check / Product Bulk Edit.
// Mount only while the Dialog is open so useZxing stops camera tracks on close.
function CostingCameraScanner({
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
          aria-label="Costing barcode camera"
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

export default function ReceivingPage() {
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
    <Workspace
      key={`${user.id ?? user.username}:${user.shopId ?? user.shopCode}`}
      identity={`${user.id ?? user.username}:${user.shopId ?? user.shopCode}`}
    />
  );
}
function Workspace({ identity }: { identity: string }) {
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [cameraAttempt, setCameraAttempt] = React.useState(0);
  const closeCamera = React.useCallback(() => {
    setCameraOpen(false);
    requestAnimationFrame(() => barcodeRef.current?.focus());
  }, []);
  const [source, setSource] = React.useState<Source | null>(null),
    [record, setRecord] = React.useState<Receipt | null>(null),
    [form, setForm] = React.useState<Fields>(blank);
  const [baseline, setBaseline] = React.useState(""),
    [barcode, setBarcode] = React.useState(""),
    [notice, setNotice] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [boot, setBoot] = React.useState(true);
  const [warehouses, setWarehouses] = React.useState<Place[]>([]),
    [locations, setLocations] = React.useState<Place[]>([]),
    [locationsBusy, setLocationsBusy] = React.useState(false),
    [placeError, setPlaceError] = React.useState("");
  const [pending, setPending] = React.useState<Pending | null>(null),
    [blocked, setBlocked] = React.useState(false),
    [errors, setErrors] = React.useState<ReturnType<typeof validate>>({});
  const [action, setAction] = React.useState<
    "confirm" | "cancel" | "new" | null
  >(null);
  const [picker, setPicker] = React.useState(false),
    [catalog, setCatalog] = React.useState<{
      content: {
        id: number;
        title: string;
        items: {
          id: number;
          inputs: { product?: string };
          calculation?: { ready: boolean };
        }[];
      }[];
      totalPages: number;
    } | null>(null),
    [catalogBusy, setCatalogBusy] = React.useState(false),
    [catalogError, setCatalogError] = React.useState(""),
    [catalogSearch, setCatalogSearch] = React.useState(""),
    [catalogQuery, setCatalogQuery] = React.useState(""),
    [catalogPage, setCatalogPage] = React.useState(0),
    [catalogRevision, setCatalogRevision] = React.useState(0);
  const [historyOpen, setHistoryOpen] = React.useState(false),
    [history, setHistory] = React.useState<Paged<Receipt> | null>(null),
    [historyBusy, setHistoryBusy] = React.useState(false),
    [historyError, setHistoryError] = React.useState(""),
    [historyPage, setHistoryPage] = React.useState(0),
    [historyRevision, setHistoryRevision] = React.useState(0),
    [historyQuery, setHistoryQuery] = React.useState({
      status: "",
      barcode: "",
      batch: "",
      from: "",
      to: "",
    }),
    [historyFilters, setHistoryFilters] = React.useState(historyQuery);
  const [setup, setSetup] = React.useState(false),
    [placeKind, setPlaceKind] = React.useState<"warehouse" | "location">(
      "warehouse",
    ),
    [placeName, setPlaceName] = React.useState(""),
    [placeWarehouse, setPlaceWarehouse] = React.useState(""),
    [placeNotice, setPlaceNotice] = React.useState("");
  const [locationRevision, setLocationRevision] = React.useState(0);
  const lock = React.useRef(false),
    mounted = React.useRef(true),
    barcodeRef = React.useRef<HTMLInputElement>(null);
  const storageKey = `binhlaig:receiving:bulk:server:v1:${identity}`;
  const dirty = !!source && JSON.stringify(form) !== baseline;
  const readOnly =
    !!record && (record.status !== "DRAFT" || record.stockKind !== "BULK");
  const disabled = busy || boot || blocked || !!pending;
  const actual =
    /^\d+$/.test(form.actual) && Number.isSafeInteger(Number(form.actual))
      ? Number(form.actual)
      : null;
  // Package receipts and finished-output quantities are different units.
  const bulkReady = isBulkReady(source);
  const bulkMeta = source?.bulk;
  const vissBasis = isVissBasis(bulkMeta);
  const bulkTotal = bulkMeta
    ? totalFor(form.actual, bulkMeta.quantityPerPackage)
    : null;
  const bulkValue = bulkMeta
    ? totalFor(form.actual, bulkMeta.purchaseCostPerPackage)
    : null;
  function putStorage(value: {
    pending?: Pending | null;
    recordId?: number | null;
  }) {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...value }));
  }
  function adopt(r: Receipt) {
    setRecord(r);
    setSource(sourceOf(r));
    setForm(fromReceipt(r));
    setBaseline(JSON.stringify(fromReceipt(r)));
    setBarcode(r.barcode);
    setErrors({});
    setBlocked(false);
  }
  async function refreshWarehouses() {
    setPlaceError("");
    try {
      const p = decodePlaces(await api("/warehouses"));
      if (mounted.current) setWarehouses(p);
    } catch (e) {
      if (mounted.current)
        setPlaceError(e instanceof Error ? `ဂိုဒေါင်စာရင်း ရယူမရပါ။ (${e.message})` : "ဂိုဒေါင်စာရင်း ရယူမရပါ။");
    }
  }
  React.useEffect(() => {
    mounted.current = true;
    void refreshWarehouses();
    void (async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (saved?.version === 1 && saved.pending) {
          const p = saved.pending as Pending;
          if (
            !["POST", "PUT"].includes(p.method) ||
            !/^(?:|\/\d+(?:\/(?:confirm|cancel))?)$/.test(p.path) ||
            !p.body ||
            typeof p.body !== "object" ||
            (p.key && !/^[-A-Za-z0-9._:]{8,128}$/.test(p.key))
          )
            throw new Error("Recovery data မမှန်ပါ။");
          setPending(p);
          setNotice(
            "အပြီးသတ်ရလဒ် မသေချာသေးသော လုပ်ဆောင်မှု ရှိပါသည်။ လုပ်ဆောင်မှု ပြန်စစ်ရန်ကို နှိပ်ပါ။",
          );
        } else if (
          Number.isSafeInteger(saved?.recordId) &&
          saved.recordId > 0
        ) {
          const r = decodeReceipt(await api(`/${saved.recordId}`));
          if (mounted.current) adopt(r);
        }
      } catch (e) {
        if (mounted.current) {
          setBlocked(true);
          setNotice(e instanceof Error ? e.message : "Recovery ဖတ်မရပါ။");
        }
      } finally {
        if (mounted.current) setBoot(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [storageKey]);
  React.useEffect(() => {
    if (!form.warehouseId) {
      setLocations([]);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLocationsBusy(true);
    setLocations([]);
    void api(`/warehouses/${form.warehouseId}/locations`, {
      signal: controller.signal,
    })
      .then(decodePlaces)
      .then((p) => {
        if (active) setLocations(p);
      })
      .catch((e) => {
        if (active)
          setPlaceError(e instanceof Error ? `သိုလှောင်နေရာစာရင်း ရယူမရပါ။ (${e.message})` : "သိုလှောင်နေရာစာရင်း ရယူမရပါ။");
      })
      .finally(() => {
        if (active) setLocationsBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [form.warehouseId, locationRevision]);
  React.useEffect(() => {
    if (!historyOpen) return;
    let active = true;
    const c = new AbortController();
    setHistoryBusy(true);
    setHistoryError("");
    setHistory(null);
    const q = new URLSearchParams({ page: String(historyPage), size: "10" });
    Object.entries(historyFilters).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    void api(`?${q}`, { signal: c.signal })
      .then((v) => decodePage(v, decodeReceipt))
      .then((p) => {
        if (p.number !== historyPage) throw new Error("History page မမှန်ပါ။");
        if (active) setHistory(p);
      })
      .catch((e) => {
        if (active)
          setHistoryError(e instanceof Error ? e.message : "History မရပါ။");
      })
      .finally(() => {
        if (active) setHistoryBusy(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [historyOpen, historyPage, historyFilters, historyRevision]);
  React.useEffect(() => {
    if (!picker) return;
    let active = true;
    const c = new AbortController();
    setCatalogBusy(true);
    setCatalogError("");
    setCatalog(null);
    const q = new URLSearchParams({
      page: String(catalogPage),
      size: "6",
      status: "FINALIZED",
      search: catalogQuery,
    });
    void fetch(`/api/factory/costings?${q}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b?.message || "Costing စာရင်းမရပါ။");
        if (
          !Array.isArray(b.content) ||
          !Number.isSafeInteger(b.totalPages) ||
          b.totalPages < 0 ||
          b.number !== catalogPage ||
          b.content.some(
            (s: { id: number; title: string; items: unknown[] }) =>
              !Number.isSafeInteger(s.id) ||
              typeof s.title !== "string" ||
              !Array.isArray(s.items),
          )
        )
          throw new Error("Costing response မမှန်ပါ။");
        return b;
      })
      .then((p) => {
        // A Costing product can be purchased repeatedly; do not hide confirmed sources.
        if (active) setCatalog(p);
      })
      .catch((e) => {
        if (active)
          setCatalogError(e instanceof Error ? e.message : "စာရင်းရယူမရပါ။");
      })
      .finally(() => {
        if (active) setCatalogBusy(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [picker, catalogPage, catalogQuery, catalogRevision]);
  function change<K extends keyof Fields>(k: K, v: Fields[K]) {
    if (readOnly || disabled) return;
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === "warehouseId" ? { locationId: "" } : {}),
      ...(k === "actual" && v !== f.actual ? {note: withoutPackageNote(f.note)} : {}),
    }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  }
  async function reopenExisting(
    code: string,
    matches: Receipt[],
  ): Promise<boolean> {
    if (!matches.length) return false;
    if (matches.length > 1) {
      setBlocked(true);
      setPicker(false);
      const filters = {
        status: "",
        barcode: code,
        batch: "",
        from: "",
        to: "",
      };
      setHistoryQuery(filters);
      setHistoryFilters(filters);
      setHistoryPage(0);
      setHistoryRevision((v) => v + 1);
      setHistoryOpen(true);
      setNotice(
        "ဒီပစ္စည်းအတွက် ယခင်မှတ်တမ်း တစ်ခုထက်ပိုရှိပါသည်။ Record နံပါတ်အလိုက် စစ်ပြီး ရှိပြီးသားမှတ်တမ်းကို ဖွင့်ပါ။ အသစ်ထပ်မဖန်တီးပါ။",
      );
      return true;
    }
    const existing = decodeReceipt(await api(`/${matches[0].id}`));
    if (existing.status === "CANCELLED") return false;
    if (!mounted.current) return true;
    adopt(existing);
    putStorage({ recordId: existing.id });
    setPicker(false);
    setHistoryOpen(false);
    setNotice(
      existing.status === "DRAFT"
        ? "သိမ်းပြီးသား မူကြမ်းကို ပြန်ဖွင့်ထားပါသည်။ ပြင်ဆင်သိမ်းလျှင် ဒီ Record ကိုပဲ update လုပ်မည်။"
        : "ဒီပစ္စည်းကို လက်ခံအတည်ပြုပြီးဖြစ်ပါသည်။ ရှိပြီးသားမှတ်တမ်းကို ကြည့်ရန်သာ ပြထားပါသည်။ စတော့ထပ်မတိုးပါ။",
    );
    return true;
  }
  async function lookup(code: string) {
    if (lock.current || disabled) return;
    if (record || dirty) {
      setNotice(
        "လက်ရှိစာရင်းကို အရင်သိမ်းပါ။ ပစ္စည်းပြောင်းရန် အသစ်ခလုတ်မှ စာရင်းအသစ် စပါ။",
      );
      return;
    }
    const normalized = code.trim().toUpperCase();
    if (!/^FC-[1-9]\d*-[1-9]\d*$/.test(normalized)) {
      setNotice("FC-12-34 ပုံစံ barcode ထည့်ပါ။");
      return;
    }
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      const saved = (await activeReceipts(normalized)).filter(
        (r) => r.stockKind === "BULK" && r.status === "DRAFT",
      );
      if (await reopenExisting(normalized, saved)) return;
      const s = decodeSource(
        await api(`/sources?${new URLSearchParams({ barcode: normalized })}`),
      );
      if (!mounted.current) return;
      setSource(s);
      setBarcode(s.barcode);
      const f = {
        ...blank(),
        actual: "",
        batch: `IN-${today().replaceAll("-", "")}-${s.costingItemId}-${key().slice(0, 8)}`,
      };
      setForm(f);
      setBaseline(JSON.stringify(f));
      setPicker(false);
      setErrors({});
      setNotice(
        "Costing အချက်အလက် ရယူပြီးပါပြီ။ လက်ခံပမာဏနှင့် နေရာကို စစ်ပါ။",
      );
    } catch (e) {
      if (mounted.current)
        setNotice(e instanceof Error ? e.message : "ရှာမရပါ။");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function payload(): SavePayload {
    if (!source) throw new Error("ပစ္စည်းရွေးပါ။");
    return {
      costingSheetId: source.costingSheetId,
      costingItemId: source.costingItemId,
      sourceVersion: source.sourceVersion,
      ...(record ? { version: record.version } : {}),
      stockKind: "BULK",
      bulkPackageCount: form.actual,
      batch: form.batch.trim(),
      warehouseId: Number(form.warehouseId),
      locationId: Number(form.locationId),
      receivedDate: form.receivedDate,
      expiryDate: form.expiryDate || null,
      note: form.note.trim() || null,
    };
  }
  async function perform(p: Pending, recovery = false) {
    if (lock.current) return;
    if (!("stockKind" in p.body) || p.body.stockKind !== "BULK") {
      setNotice("မူလ Finished Goods လုပ်ဆောင်မှုကို Bulk အဖြစ် မပို့နိုင်ပါ။");
      return;
    }
    lock.current = true;
    setBusy(true);
    setNotice("Server သို့ လုပ်ဆောင်နေသည်…");
    let journaled = false;
    let acknowledged = false;
    try {
      putStorage({ pending: p, recordId: record?.id });
      journaled = true;
      setPending(p);
      let r: Receipt;
      if (recovery && !p.key) {
        const id = p.path.split("/")[1];
        r = decodeReceipt(await api(`/${id}`));
      } else {
        let response: unknown;
        try {
          response = await api(p.path, {
            method: p.method,
            body: JSON.stringify(p.body),
            headers: p.key ? { "Idempotency-Key": p.key } : undefined,
          });
        } catch (e) {
          throw e;
        }
        acknowledged = true;
        try {
          r = decodeReceipt(response);
        } catch {
          throw new ReceivingError(
            "Server လုပ်ဆောင်ပြီးသော်လည်း response ဖတ်မရပါ။ ပြန်စစ်ပါ။",
            502,
            true,
          );
        }
        r = decodeReceipt(await api(`/${r.id}`));
      }
      if (!mounted.current) return;
      adopt(r);
      putStorage({ recordId: r.id });
      setPending(null);
      setHistoryRevision((v) => v + 1);
      setNotice(
        recovery && !p.key
          ? "Server လက်ရှိစာရင်းကို ပြန်ယူပြီးပါပြီ။ မသိမ်းရသေးသောပြင်ဆင်မှုများကို ပြန်စစ်ပါ။"
          : r.status === "CONFIRMED"
            ? "လက်ခံမှုအတည်ပြုပြီး စတော့ဝင်ပြီးပါပြီ။"
            : r.status === "CANCELLED"
              ? "မူကြမ်း ပယ်ဖျက်ပြီးပါပြီ။"
              : "Server တွင် မူကြမ်းသိမ်းပြီးပါပြီ။",
      );
    } catch (e) {
      if (!mounted.current) return;
      const uncertain =
        !(e instanceof ReceivingError) ||
        e.uncertain ||
        recovery ||
        acknowledged;
      setNotice(e instanceof Error ? e.message : "လုပ်ဆောင်မှု မအောင်မြင်ပါ။");
      if (journaled && !uncertain) {
        try {
          putStorage({ recordId: record?.id });
          setPending(null);
        } catch {
          setBlocked(true);
        }
        if (e instanceof ReceivingError && e.status === 409) setBlocked(true);
      } else if (!journaled) {
        setPending(null);
        setNotice(
          "Browser recovery သိမ်းမရပါ။ လုပ်ဆောင်မှု မပို့ရသေးပါ။ Storage ကိုစစ်ပါ။",
        );
      } else setPending(p);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    if (busy || boot || readOnly) return;
    if (pending || blocked || locationsBusy) {
      setNotice(saveProblems.join("\n") || "လက်ရှိလုပ်ဆောင်မှုကို အရင်စစ်ပါ။");
      return;
    }
    const e = validate(source, form);
    if (!warehouses.some((w) => w.active && String(w.id) === form.warehouseId))
      e.warehouseId = "အသုံးပြုနိုင်သော ဂိုဒေါင်ရွေးပါ။";
    if (!locations.some((l) => l.active && String(l.id) === form.locationId))
      e.locationId = "အသုံးပြုနိုင်သော သိုလှောင်နေရာရွေးပါ။";
    setErrors(e);
    if (Object.keys(e).length) {
      setNotice(Object.values(e).filter(Boolean).join("\n"));
      return;
    }
    if (!record && source) {
      // A different tab/user may have saved this source since it was selected.
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      try {
        const saved = (await activeReceipts(source.barcode)).filter(
          (r) => r.stockKind === "BULK" && r.status === "DRAFT",
        );
        if (await reopenExisting(source.barcode, saved)) return;
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "ယခင်မှတ်တမ်း စစ်မရပါ။ မူကြမ်းအသစ် မပို့ရသေးပါ။",
        );
        return;
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
      if (!mounted.current) return;
    }
    void perform({
      path: record ? `/${record.id}` : "",
      method: record ? "PUT" : "POST",
      body: payload(),
      ...(!record ? { key: key() } : {}),
    });
  }
  async function openRecord(id: number, discard = false) {
    if (lock.current || pending) return;
    if (dirty && !discard) {
      setNotice("လက်ရှိမူကြမ်းကို အရင်သိမ်းပါ။");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const r = decodeReceipt(await api(`/${id}`));
      if (!mounted.current) return;
      adopt(r);
      putStorage({ recordId: r.id });
      setHistoryOpen(false);
      setNotice("Server မှ စာရင်းပြန်ဖွင့်ပြီးပါပြီ။");
    } catch (e) {
      if (mounted.current)
        setNotice(e instanceof Error ? e.message : "ဖွင့်မရပါ။");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function reset() {
    if (pending) return;
    try {
      putStorage({ recordId: null });
      setSource(null);
      setRecord(null);
      setForm(blank());
      setBaseline("");
      setErrors({});
      setBlocked(false);
      setNotice("");
      setBarcode("");
      barcodeRef.current?.focus();
    } catch {
      setNotice("Recovery သိမ်းမရပါ။ Storage ကိုစစ်ပါ။");
    }
  }
  function resolveAction() {
    const next = action;
    setAction(null);
    if (next === "new") {
      reset();
      return;
    }
    if (
      !record ||
      disabled ||
      dirty ||
      record.status !== "DRAFT" ||
      record.stockKind !== "BULK" ||
      !bulkReady
    )
      return;
    void perform({
      path: `/${record.id}/${next}`,
      method: "POST",
      body: { version: record.version, stockKind: "BULK" },
      ...(next === "confirm" ? { key: key() } : {}),
    });
  }
  async function createPlace() {
    if (lock.current || !placeName.trim() || placeName.length > 200) return;
    const warehouse = Number(placeWarehouse);
    if (
      placeKind === "location" &&
      (!Number.isSafeInteger(warehouse) || warehouse <= 0)
    ) {
      setPlaceNotice("ဂိုဒေါင်အရင်ရွေးပါ။");
      return;
    }
    lock.current = true;
    setBusy(true);
    setPlaceNotice("");
    try {
      const p = await api(
        placeKind === "warehouse"
          ? "/warehouses"
          : `/warehouses/${warehouse}/locations`,
        {
          method: "POST",
          body: JSON.stringify({ name: placeName.trim(), active: true }),
        },
      );
      decodePlaces([p]);
      setPlaceName("");
      setPlaceNotice("ဖန်တီးပြီးပါပြီ။ နေရာစာရင်းကို ပြန်တင်ပါ။");
      await refreshWarehouses();
      if (form.warehouseId === placeWarehouse && placeKind === "location") {
        const list = decodePlaces(
          await api(`/warehouses/${warehouse}/locations`),
        );
        if (mounted.current) setLocations(list);
      }
    } catch (e) {
      setPlaceNotice(
        `${e instanceof Error ? e.message : "ဖန်တီးမရပါ။"} ရလဒ်မသေချာလျှင် အမည်တူ ထပ်မဖန်တီးမီ နေရာစာရင်းကို ပြန်တင်စစ်ပါ။`,
      );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const selectedWarehouse = warehouses.find(
      (w) => String(w.id) === form.warehouseId,
    ),
    selectedLocation = locations.find((l) => String(l.id) === form.locationId);
  const saveProblems = [
    ...new Set([
      ...(boot ? ["ယခင်မူကြမ်းနှင့် recovery အခြေအနေ စစ်နေသည်။"] : []),
      ...(pending
        ? ["အပြီးသတ်ရလဒ်မသေချာသေးသော လုပ်ဆောင်မှုကို အရင်ပြန်စစ်ပါ။"]
        : []),
      ...(blocked
        ? [
            "Server စာရင်းပြောင်းထားနိုင်ပါသည်။ ရှိပြီးသားမှတ်တမ်းကို ပြန်ဖွင့်စစ်ပါ။",
          ]
        : []),
      ...(locationsBusy ? ["သိုလှောင်နေရာစာရင်း ရယူနေသည်။"] : []),
      ...Object.values(validate(source, form)).filter((v): v is string => !!v),
      ...(!warehouses.some((w) => w.active && String(w.id) === form.warehouseId)
        ? ["အသုံးပြုနိုင်သော ဂိုဒေါင်ရွေးပါ။"]
        : []),
      ...(!locations.some((l) => l.active && String(l.id) === form.locationId)
        ? ["အသုံးပြုနိုင်သော သိုလှောင်နေရာရွေးပါ။"]
        : []),
    ]),
  ];
  return (
    <main
      lang="my"
      className="@container/receiving mx-auto min-w-0 max-w-[1280px] space-y-4 px-3 py-4 text-foreground sm:px-5 sm:py-6"
      style={{ fontFamily: '"Noto Sans Myanmar", "Myanmar Text", sans-serif' }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4 print:border-0">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            ကုန်ကြမ်းလက်ခံရန်
          </h1>
          {record && (
            <p className="mt-1 text-[11px] font-mono text-muted-foreground">
              {record.receivingNumber}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Badge
            variant="outline"
            className={`h-9 rounded-lg px-3 text-[11px] ${record?.status === "CONFIRMED" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300" : dirty ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" : ""}`}
          >
            {record?.status === "CONFIRMED"
              ? "Confirmed"
              : record?.status === "CANCELLED"
                ? "Cancelled"
                : dirty
                  ? "Unsaved"
                  : record
                    ? "Draft"
                    : "New"}
          </Badge>
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            disabled={busy}
            aria-label="လက်ခံမှတ်တမ်း"
            onClick={() => {
              setHistoryPage(0);
              setHistoryOpen(true);
              setHistoryRevision((v) => v + 1);
            }}
          >
            <History className="size-4" />{" "}
            <span className="hidden sm:inline">မှတ်တမ်း</span>
          </Button>
          <Button
            className="h-10 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700"
            disabled={busy || boot || !!pending}
            onClick={() => setAction("new")}
          >
            <Plus className="size-4" /> {record?.status === "CONFIRMED" ? "နောက်တစ်ခုလက်ခံရန်" : "အသစ်လက်ခံရန်"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Receiving options"
            className="size-10 rounded-xl"
            disabled={busy}
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontal className="size-5" />
          </Button>
        </div>
      </header>
      {source && !bulkReady && !record && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-7 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
        >
          Costing အချက်အလက်ကို ကြည့်နိုင်ပါသည်။ လက်ရှိ Backend က Bulk Receiving
          contract မပြန်သေးသဖြင့် သိမ်း/အတည်ပြုခြင်း ပိတ်ထားပါသည်။ အထုပ်ကြီး
          Stock ကို Finished Goods Stock အဖြစ် မသွင်းပါ။
        </p>
      )}
      {record && record.stockKind !== "BULK" && (
        <p
          role="status"
          className="rounded-xl border border-amber-300 p-3 text-xs leading-7"
        >
          မူလ Finished Goods မှတ်တမ်းဖြစ်ပါသည်။ အထုပ်ကြီးအဖြစ် ပြောင်းမတွက်ဘဲ
          ယူနစ်အဟောင်းအတိုင်း ကြည့်ရန်သာ ပြထားပါသည်။
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border bg-muted/40 p-3 text-sm leading-7"
        >
          {notice}
        </p>
      )}
      {pending && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-7 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p>
            အပြီးသတ်ရလဒ် မသေချာသေးပါ။ ထပ်ဖန်တီးခြင်းကို ပိတ်ထားပါသည်။ မူလ
            request အတိုင်းသာ ပြန်စစ်မည်။
          </p>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => void perform(pending, true)}
          >
            <RefreshCw className="size-4" />
            လုပ်ဆောင်မှု ပြန်စစ်ရန်
          </Button>
        </div>
      )}
      {blocked && !pending && (
        <div className="rounded-xl border border-amber-300 p-3 text-xs leading-7">
          <p>
            စာရင်းပြောင်းထားနိုင်ပါသည်။ ဆက်မလုပ်မီ Server လက်ရှိအခြေအနေကို
            ပြန်ဖွင့်ပါ။
          </p>
          {record ? (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void openRecord(record.id, true)}
            >
              Server စာရင်းပြန်ဖွင့်ရန်
            </Button>
          ) : (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => setHistoryOpen(true)}
            >
              History စစ်ရန်
            </Button>
          )}
        </div>
      )}
      <div
        className={source || record
          ? "grid min-w-0 items-start gap-4 @min-[680px]/receiving:grid-cols-[minmax(0,1fr)_280px] @min-[1150px]/receiving:grid-cols-[minmax(0,1fr)_340px]"
          : "min-w-0"}
      >
        <div className="min-w-0 space-y-4">
          <Section title="ပစ္စည်းရွေးချယ်ရန်">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void lookup(barcode);
              }}
              className="flex flex-wrap gap-2 print:hidden"
            >
              <Button
                type="button"
                className="min-h-11 bg-blue-600 text-white hover:bg-blue-700"
                disabled={disabled || !!record}
                aria-label="Tablet camera ဖြင့် Costing barcode scan ဖတ်ရန်"
                onClick={() => {
                  if (dirty) {
                    setNotice(
                      "လက်ရှိအချက်များကို အရင်သိမ်းပါ။ ပစ္စည်းပြောင်းရန် အသစ်ခလုတ်မှ စပါ။",
                    );
                    return;
                  }
                  setCameraAttempt((n) => n + 1);
                  setCameraOpen(true);
                }}
              >
                <Camera className="size-4" />
                Camera Scan
              </Button>
              <div className="relative min-w-0 flex-1 basis-44">
                <Barcode className="absolute left-3 top-3 size-5 text-muted-foreground" />
                <Input
                  ref={barcodeRef}
                  aria-label="Costing barcode"
                  className="h-11 pl-10 font-mono text-base"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Barcode ရိုက်ထည့်ရန်"
                  disabled={disabled || !!record}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                className="min-h-11"
                disabled={disabled || !!record || !barcode.trim()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                ရှာရန်
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={disabled || !!record}
                onClick={() => {
                  setCatalogPage(0);
                  setPicker(true);
                }}
              >
                <ListFilter className="size-4" />
                စာရင်းမှရွေးရန်
              </Button>
            </form>
            {source ? (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                <Photo source={source} />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-sm font-semibold leading-7">
                    {source.productName}
                  </h3>
                  <p className="font-mono text-xs">{source.barcode}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                <Package className="mx-auto mb-2 size-8" />
                ပစ္စည်းရွေးပြီး စတင်ပါ။
              </div>
            )}
            {errors.product && (
              <p className="text-xs text-destructive">{errors.product}</p>
            )}
          </Section>
          {source && (
            <details className="group rounded-xl border border-border bg-card px-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                ပစ္စည်းအသေးစိတ်
                <ChevronDown className="size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-border py-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    { label: vissBasis ? "အခြေခံယူနစ်" : "အထုပ်အမျိုးအစား", value: bulkMeta?.packageUnit },
                    {
                      label: vissBasis ? "တစ်ပိဿာပါဝင်မှု" : "တစ်အထုပ်ပါဝင်မှု",
                      value: bulkMeta
                        ? `${displayDecimal(bulkMeta.quantityPerPackage)} ${bulkMeta.baseUnit}`
                        : undefined,
                    },
                    {
                      label: vissBasis ? "တစ်ပိဿာ ဝယ်ဈေးကိုးကား" : "တစ်အထုပ်ဝယ်ဈေး",
                      value:
                        bulkMeta && source
                          ? `${displayDecimal(bulkMeta.purchaseCostPerPackage)} ${source.currency === "MMK" ? "ကျပ်" : source.currency}`
                          : undefined,
                    },
                  ].map((i) => (
                    <div
                      key={i.label}
                      className="min-w-0 rounded-xl bg-muted/60 p-3"
                    >
                      <p className="text-[11px] leading-6 text-muted-foreground">
                        {i.label}
                      </p>
                      <p className="break-words text-sm font-semibold tabular-nums">
                        {i.value || "—"}
                      </p>
                    </div>
                  ))}
                </div>
                {source && (
                  <p className="rounded-xl bg-blue-50 p-3 text-xs leading-7 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                    Production အတွက်သာ ကိုးကားရန် — {fmt(source.packageSize)}{" "}
                    {source.packageSizeUnit} / {source.saleUnit} · Costing ခန့်မှန်း{" "}
                    {fmt(source.expectedQuantity)} {source.saleUnit} / Costing
                    မူလတစ်စု။ ဒီအရေအတွက်ကို Receiving Stock အဖြစ် မတိုးပါ။
                  </p>
                )}
                {source?.bulkPreview && (
                  <p className="text-xs leading-7 text-amber-700 dark:text-amber-300">
                    လက်ရှိ Costing မှ ကိုးကားပြထားခြင်းသာ ဖြစ်သည်။ Weight/Volume ၏
                    မူလတစ်စုကို တစ်အိတ်ဟု အလိုအလျောက် မယူဆထားပါ။
                    မှန်ကန်သောအထုပ်အမည်နှင့် အရွယ်ကို Backend bulk snapshot မှ
                    သတ်မှတ်ရမည်။
                  </p>
                )}
              </div>
            </details>
          )}
          <fieldset
            hidden={!source && !record}
            disabled={!source || readOnly || disabled}
            className="min-w-0 space-y-4 disabled:opacity-70"
          >
            <Section title="လက်ခံပမာဏ">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={vissBasis ? "စုစုပေါင်း လက်ခံရရှိသော ပိဿာ *" : `ရောက်ရှိသော အထုပ်အရေအတွက် (${bulkMeta?.packageUnit || "အထုပ်"}) *`}
                  error={errors.actual}
                >
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    className="h-12 text-lg font-semibold"
                    placeholder="ဥပမာ 5"
                    value={form.actual}
                    onChange={(e) => change("actual", e.target.value)}
                  />
                </Field>
                <div className="flex items-center justify-center rounded-xl bg-blue-50 p-3 text-sm font-semibold leading-7 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                  {bulkMeta && bulkTotal
                    ? `${form.actual} ${bulkMeta.packageUnit} × ${displayDecimal(bulkMeta.quantityPerPackage)} ${bulkMeta.baseUnit} = ${displayDecimal(bulkTotal)} ${bulkMeta.baseUnit}`
                    : vissBasis ? "လက်ခံရရှိသော ပိဿာ ဖြည့်ပါ။" : "အထုပ်အရေအတွက် ဖြည့်ပါ။"}
                </div>
              </div>
              {vissBasis && (
                <details className="rounded-lg border px-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
                    အထုပ်ဖြင့်တွက်ရန်
                  </summary>
                  <div className="pb-3">
                      <p className="rounded-xl border bg-muted/40 p-3 text-xs leading-7">1 ပိဿာ = 100 ကျပ်သား။ ပိဿာအပြည့်ကိန်းကိုသာ လက်ရှိ API တွင် သိမ်းနိုင်ပါသည်။ ဥပမာ 1 ပိဿာ 25 ကျပ်သားကို 2 ပိဿာအဖြစ် ဝိုင်းမသိမ်းပါနှင့်။ kg / g သို့ အလိုအလျောက် မပြောင်းပါ။</p>
                      <VissPackageCalculator key={`${source?.costingSheetId}:${source?.costingItemId}:${source?.sourceVersion}:${record?.id ?? "new"}`} disabled={readOnly||disabled} onApply={(viss,note)=>{
                        if (readOnly||disabled) return;
                        const previousNote=withoutPackageNote(form.note);
                        const nextNote=previousNote ? `${previousNote}\n${note}` : note;
                        if(nextNote.length>2000){setNotice("အထုပ်မှတ်ချက် ထည့်ရန် မှတ်ချက်နေရာ မလုံလောက်ပါ။ မူလမှတ်ချက်ကို တိုအောင်ပြင်ပြီး ပြန်တွက်ပါ။");return;}
                        setForm(current=>({...current,actual:viss,note:nextNote}));
                        setErrors(current=>({...current,actual:undefined,note:undefined}));
                        setNotice("ပိဿာစုစုပေါင်း ဖြည့်ပြီးပါပြီ။ ဂိုဒေါင်၊ Batch နှင့် ပမာဏကို စစ်ပြီးမှ သိမ်းပါ။");
                      }}/>
                  </div>
                </details>
              )}
            </Section>
            <Section title="Batch နှင့် သိုလှောင်နေရာ">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Batch နံပါတ် *" error={errors.batch}>
                  <Input
                    className="h-11 font-mono"
                    maxLength={100}
                    value={form.batch}
                    onChange={(e) => change("batch", e.target.value)}
                  />
                </Field>
                <Field label="Warehouse *" error={errors.warehouseId}>
                  <select
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.warehouseId}
                    onChange={(e) => change("warehouseId", e.target.value)}
                  >
                    <option value="">ဂိုဒေါင်ရွေးပါ</option>
                    {warehouses
                      .filter(
                        (w) => w.active || String(w.id) === form.warehouseId,
                      )
                      .map((w) => (
                        <option key={w.id} value={w.id} disabled={!w.active}>
                          {w.name}
                          {!w.active ? " (ပိတ်ထားသည်)" : ""}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field
                  label="Storage Location / Rack *"
                  error={errors.locationId}
                >
                  <select
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.locationId}
                    onChange={(e) => change("locationId", e.target.value)}
                    disabled={
                      !form.warehouseId || locationsBusy || disabled || readOnly
                    }
                  >
                    <option value="">
                      {locationsBusy ? "ရယူနေသည်…" : "နေရာရွေးပါ"}
                    </option>
                    {locations
                      .filter(
                        (l) => l.active || String(l.id) === form.locationId,
                      )
                      .map((l) => (
                        <option key={l.id} value={l.id} disabled={!l.active}>
                          {l.name}
                          {!l.active ? " (ပိတ်ထားသည်)" : ""}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="လက်ခံရက် *" error={errors.receivedDate}>
                  <Input
                    type="date"
                    className="h-11"
                    value={form.receivedDate}
                    onChange={(e) => change("receivedDate", e.target.value)}
                  />
                </Field>
              </div>
              {(source || record) && placeError && (
                <p role="alert" className="text-xs text-destructive">{placeError}</p>
              )}
              <details
                open={form.expiryDate || form.note || errors.expiryDate || errors.note ? true : undefined}
                className="rounded-lg border px-3"
              >
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
                  သက်တမ်းကုန်ရက်နှင့် မှတ်ချက်
                </summary>
                <div className="grid gap-3 pb-3 sm:grid-cols-2">
                  <Field
                    label="သက်တမ်းကုန်ရက် (လိုအပ်လျှင်)"
                    error={errors.expiryDate}
                  >
                    <Input
                      type="date"
                      className="h-11"
                      min={form.receivedDate || undefined}
                      value={form.expiryDate}
                      onChange={(e) => change("expiryDate", e.target.value)}
                    />
                  </Field>
                  <Field label="မှတ်ချက် (လိုအပ်လျှင်)" error={errors.note}>
                    <Input
                      className="h-11"
                      value={form.note}
                      maxLength={2000}
                      onChange={(e) => change("note", e.target.value)}
                    />
                  </Field>
                </div>
              </details>
            </Section>
          </fieldset>
        </div>
        <aside hidden={!source && !record} className="min-w-0 @min-[680px]/receiving:sticky @min-[680px]/receiving:top-20 print:static">
          <Card className="gap-0 rounded-2xl py-0 shadow-none">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <h2 className="text-base font-semibold leading-8">
                လက်ခံမှုအနှစ်ချုပ်
              </h2>
              {record && record.stockKind !== "BULK" ? (
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xs leading-7">မူလ Finished Goods ပမာဏ</p>
                  <p className="text-2xl font-bold">
                    {fmt(record.actualQuantity)} {record.saleUnit}
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl bg-blue-50 p-4 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                    <p className="text-xs leading-6">စုစုပေါင်းလက်ခံပမာဏ</p>
                    <p className="mt-1 break-words text-3xl font-bold tabular-nums">
                      {vissBasis
                        ? actual !== null ? fmt(actual) : "—"
                        : bulkTotal ? displayDecimal(bulkTotal) : "—"}{" "}
                      <span className="text-sm">{vissBasis ? "ပိဿာ" : bulkMeta?.baseUnit}</span>
                    </p>
                    {!vissBasis && actual !== null && (
                      <p className="mt-1 text-sm">{fmt(actual)} {bulkMeta?.packageUnit || "အထုပ်"}</p>
                    )}
                  </div>
                  {!vissBasis && bulkMeta?.baseUnit === "ကျပ်သား" && bulkTotal && <p className="rounded-xl border border-emerald-200 p-3 text-sm font-semibold leading-7 text-emerald-800 dark:text-emerald-300">ပိဿာဖြင့် — {kyatthaAsViss(bulkTotal) ?? "—"}</p>}
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">
                      ဝယ်ယူကိုးကားတန်ဖိုး
                    </p>
                    <p className="mt-1 break-words text-lg font-bold tabular-nums">
                      {bulkValue && source
                        ? `${displayDecimal(bulkValue)} ${source.currency === "MMK" ? "ကျပ်" : source.currency}`
                        : "—"}
                    </p>
                  </div>
                </>
              )}
              <div className="space-y-1 text-xs leading-6">
                <p>
                  ဂိုဒေါင် —{" "}
                  {selectedWarehouse?.name || form.warehouseId || "—"}
                </p>
                <p>နေရာ — {selectedLocation?.name || form.locationId || "—"}</p>
                <p className="break-all">Batch — {form.batch || "—"}</p>
              </div>
              {record?.status === "CONFIRMED" ? (
                <div className="rounded-xl border border-emerald-300 p-3 text-xs leading-7">
                  <CheckCircle2 className="size-5 text-emerald-600" />
                  လက်ခံမှု အတည်ပြုပြီး စတော့ဝင်ပြီးပါပြီ။
                  <p className="break-all font-mono">
                    {record.receivingNumber}
                  </p>
                </div>
              ) : record?.status === "CANCELLED" ? (
                <p className="rounded-xl bg-muted p-3 text-xs">
                  ဒီမူကြမ်းကို ပယ်ဖျက်ပြီးပါပြီ။ စတော့မတိုးပါ။
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
      {source && !readOnly && (
        <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-xl border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sm print:hidden">
          <p id="receiving-save-reasons" role="status" className="text-xs leading-6 text-muted-foreground">
            {saveProblems[0] ||
              (!record || dirty
                ? "အတည်ပြုရန် မူကြမ်းအရင်သိမ်းပါ။"
                : "အတည်ပြုနိုင်ပါပြီ။")}
          </p>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              type="button"
              disabled={busy || boot || !!pending || readOnly}
              aria-describedby="receiving-save-reasons"
              onClick={save}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              မူကြမ်းသိမ်းရန်
            </Button>
            <Button
              className="min-h-11 bg-blue-600 text-white hover:bg-blue-700"
              disabled={disabled || !record || dirty || !bulkReady || readOnly}
              aria-describedby="receiving-save-reasons"
              onClick={() => setAction("confirm")}
            >
              <Check className="size-4" />
              လက်ခံမှုအတည်ပြုရန်
            </Button>
          </div>
        </footer>
      )}
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Receiving Actions</DialogTitle>
            <DialogDescription>
              နေရာသတ်မှတ်ခြင်း၊ မှတ်တမ်းများနှင့် စာရင်းလုပ်ဆောင်ချက်များ
            </DialogDescription>
          </DialogHeader>
          {!source && !record && placeError && (
            <p role="alert" className="text-xs text-destructive">{placeError}</p>
          )}
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="min-h-11 justify-start"
              disabled={busy}
              onClick={() => {
                setMoreOpen(false);
                setHistoryPage(0);
                setHistoryOpen(true);
                setHistoryRevision((v) => v + 1);
              }}
            >
              <History className="size-4" /> Receiving History
            </Button>
            <Button
              variant="outline"
              className="min-h-11 justify-start"
              disabled={busy || !!pending}
              onClick={() => {
                setMoreOpen(false);
                setPlaceWarehouse(form.warehouseId);
                setPlaceNotice("");
                setSetup(true);
              }}
            >
              <Settings2 className="size-4" /> Warehouse / Location ထည့်ရန်
            </Button>
            <Button
              variant="outline"
              className="min-h-11 justify-start"
              disabled={busy}
              onClick={() => {
                setMoreOpen(false);
                void refreshWarehouses();
                setLocationRevision((v) => v + 1);
              }}
            >
              <RefreshCw className="size-4" /> Warehouse နေရာစာရင်း Refresh
            </Button>
            <Button
              variant="outline"
              className="min-h-11 justify-start"
              disabled={busy || boot || !!pending}
              onClick={() => {
                setMoreOpen(false);
                setAction("new");
              }}
            >
              <Plus className="size-4" /> Receiving အသစ်
            </Button>
            {record?.status === "DRAFT" && (
              <Button
                variant="ghost"
                className="min-h-11 justify-start text-destructive"
                disabled={disabled || dirty}
                onClick={() => {
                  setMoreOpen(false);
                  setAction("cancel");
                }}
              >
                မူကြမ်းပယ်ဖျက်ရန်
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={cameraOpen}
        onOpenChange={(open) => (open ? setCameraOpen(true) : closeCamera())}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Costing Barcode Camera Scan</DialogTitle>
            <DialogDescription>
              Tablet နောက်ကင်မရာကို သုံးပြီး FC barcode ကို ဖတ်ပါ။ ဖတ်မိလျှင်
              ပစ္စည်းကို အလိုအလျောက်ရှာပါမည်။
            </DialogDescription>
          </DialogHeader>
          {cameraOpen && (
            <CostingCameraScanner
              key={cameraAttempt}
              onClose={closeCamera}
              onScan={(code) => {
                closeCamera();
                setBarcode(code);
                void lookup(code);
              }}
            />
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCameraAttempt((n) => n + 1)}
            >
              Camera ပြန်ဖွင့်ရန်
            </Button>
            <Button type="button" variant="outline" onClick={closeCamera}>
              ပိတ်မည်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Costing ပစ္စည်းစာရင်း</DialogTitle>
            <DialogDescription>
              အတည်ပြုပြီးသော စာရင်းများမှ ပစ္စည်းရွေးပါ။ Search သည်
              စာရင်းအမည်ဖြင့် ရှာပါသည်။
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setCatalogQuery(catalogSearch.trim());
              setCatalogPage(0);
              setCatalogRevision((v) => v + 1);
            }}
          >
            <Input
              aria-label="Costing စာရင်းရှာရန်"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              maxLength={200}
              placeholder="Costing စာရင်းအမည်"
            />
            <Button variant="outline" type="submit">
              ရှာရန်
            </Button>
          </form>
          {catalogBusy && (
            <p role="status" className="p-3 text-sm">
              ရယူနေသည်…
            </p>
          )}
          {catalogError && (
            <p role="alert" className="text-sm text-destructive">
              {catalogError}
            </p>
          )}
          <div className="grid gap-2">
            {catalog?.content.map((s) => (
              <div key={s.id} className="space-y-2">
                <p className="text-xs font-semibold">{s.title}</p>
                {s.items
                  .filter((i) => i.calculation?.ready)
                  .map((i) => (
                    <Button
                      key={i.id}
                      variant="outline"
                      disabled={disabled}
                      className="h-auto min-h-16 justify-start whitespace-normal p-3 text-left"
                      onClick={() => void lookup(`FC-${s.id}-${i.id}`)}
                    >
                      <Package className="size-5 shrink-0" />
                      <span>
                        <span className="block text-sm leading-7">
                          {i.inputs.product || "အမည်မဖြည့်ရသေးပါ"}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          FC-{s.id}-{i.id}
                        </span>
                      </span>
                    </Button>
                  ))}
              </div>
            ))}
          </div>
          {catalog && !catalog.content.length && (
            <p className="text-sm text-muted-foreground">
              ဤစာမျက်နှာတွင် လက်ခံရန်အသစ် မရှိပါ။ သိမ်းပြီးသားပစ္စည်းကို
              မှတ်တမ်းမှ ဖွင့်ပါ သို့မဟုတ် နောက်စာမျက်နှာကို ကြည့်ပါ။
            </p>
          )}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              disabled={catalogBusy || catalogPage === 0}
              onClick={() => setCatalogPage((p) => p - 1)}
            >
              <ArrowLeft className="size-4" />
              ရှေ့
            </Button>
            <span className="text-xs">
              {catalog?.totalPages
                ? `${catalogPage + 1} / ${catalog.totalPages}`
                : "—"}
            </span>
            <Button
              variant="outline"
              disabled={
                catalogBusy || !catalog || catalogPage + 1 >= catalog.totalPages
              }
              onClick={() => setCatalogPage((p) => p + 1)}
            >
              နောက်
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {action === "confirm"
                ? "လက်ခံမှုအတည်ပြုရန်"
                : action === "cancel"
                  ? "မူကြမ်းပယ်ဖျက်မလား။"
                  : "စာရင်းအသစ် စမလား။"}
            </DialogTitle>
            <DialogDescription className="leading-7">
              {action === "confirm"
                ? "အတည်ပြုပြီးလျှင် စတော့တိုးပြီး ဒီမှတ်တမ်းကို ပြင်မရတော့ပါ။"
                : action === "cancel"
                  ? "မူကြမ်းကို ပယ်ဖျက်ပါမည်။ စတော့ မပြောင်းပါ။"
                  : "မသိမ်းရသေးသော ပြင်ဆင်မှုများ ပျောက်ပါမည်။ Server တွင် သိမ်းပြီးစာရင်းကို History မှ ပြန်ဖွင့်နိုင်ပါသည်။"}
            </DialogDescription>
          </DialogHeader>
          {action === "confirm" && source && (
            <div className="space-y-2 rounded-xl bg-muted/50 p-4 text-sm leading-7">
              <p>{source.productName}</p>
              <p>
                လက်ခံပမာဏ — {form.actual} {vissBasis ? "ပိဿာ" : bulkMeta?.packageUnit}
              </p>
              <p>
                စုစုပေါင်း — {bulkTotal ? displayDecimal(bulkTotal) : "—"}{" "}
                {bulkMeta?.baseUnit}
              </p>
              <p>
                {selectedWarehouse?.name} / {selectedLocation?.name}
              </p>
              <p className="break-all">Batch — {form.batch}</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAction(null)}>
              မလုပ်တော့ပါ
            </Button>
            <Button onClick={resolveAction} disabled={busy}>
              {action === "confirm" ? "အတည်ပြုမည်" : "ဆက်လုပ်မည်"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Server လက်ခံမှတ်တမ်း</DialogTitle>
            <DialogDescription>
              စာရင်းကို နှိပ်ပြီး မူကြမ်းဆက်ပြင်နိုင်သည်။ အတည်ပြုပြီးနှင့်
              ပယ်ဖျက်ပြီးစာရင်းများသည် ကြည့်ရန်သာ ဖြစ်ပါသည်။
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                historyQuery.from &&
                historyQuery.to &&
                historyQuery.from > historyQuery.to
              ) {
                setHistoryError("ရက်အပိုင်းအခြား စစ်ပါ။");
                return;
              }
              setHistoryFilters(historyQuery);
              setHistoryPage(0);
              setHistoryRevision((v) => v + 1);
            }}
          >
            <Input
              aria-label="History barcode"
              placeholder="Barcode"
              value={historyQuery.barcode}
              maxLength={100}
              onChange={(e) =>
                setHistoryQuery((q) => ({ ...q, barcode: e.target.value }))
              }
            />
            <Input
              aria-label="History batch"
              placeholder="Batch"
              value={historyQuery.batch}
              maxLength={100}
              onChange={(e) =>
                setHistoryQuery((q) => ({ ...q, batch: e.target.value }))
              }
            />
            <Field label="စတင်ရက်">
              <Input
                type="date"
                value={historyQuery.from}
                onChange={(e) =>
                  setHistoryQuery((q) => ({ ...q, from: e.target.value }))
                }
              />
            </Field>
            <Field label="ဆုံးရက်">
              <Input
                type="date"
                value={historyQuery.to}
                onChange={(e) =>
                  setHistoryQuery((q) => ({ ...q, to: e.target.value }))
                }
              />
            </Field>
            <select
              aria-label="History status"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={historyQuery.status}
              onChange={(e) =>
                setHistoryQuery((q) => ({ ...q, status: e.target.value }))
              }
            >
              <option value="">အခြေအနေအားလုံး</option>
              <option value="DRAFT">DRAFT</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
            <Button type="submit" variant="outline">
              မှတ်တမ်းရှာရန်
            </Button>
          </form>
          {historyBusy && <p role="status">ရယူနေသည်…</p>}
          {historyError && (
            <p role="alert" className="text-sm text-destructive">
              {historyError}
            </p>
          )}
          <div className="grid gap-2">
            {history?.content.map((r) => (
              <Button
                key={r.id}
                variant="outline"
                disabled={busy || !!pending}
                onClick={() => void openRecord(r.id, blocked)}
                className="h-auto justify-between gap-3 whitespace-normal p-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm leading-7">
                    {r.snapshot.productName}
                  </span>
                  <span className="block break-all font-mono text-[10px] leading-6">
                    {r.receivingNumber} · {r.batch}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {r.receivedDate} · {r.status}
                  </span>
                </span>
                <span className="shrink-0 text-xs">
                  {r.stockKind === "BULK" && r.snapshot.bulk
                    ? `${r.bulkPackageCount} ${r.snapshot.bulk.packageUnit} · ${displayDecimal(r.bulkBaseQuantity!)} ${r.snapshot.bulk.baseUnit}`
                    : `${fmt(r.actualQuantity)} ${r.saleUnit} · Finished Goods အဟောင်း`}
                </span>
              </Button>
            ))}
            {history && !history.content.length && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                မှတ်တမ်း မရှိသေးပါ။
              </p>
            )}
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              disabled={historyBusy || historyPage === 0}
              onClick={() => setHistoryPage((p) => p - 1)}
            >
              ရှေ့
            </Button>
            <span className="text-xs">
              {history?.totalPages
                ? `${historyPage + 1} / ${history.totalPages}`
                : "—"}
            </span>
            <Button
              variant="outline"
              disabled={
                historyBusy || !history || historyPage + 1 >= history.totalPages
              }
              onClick={() => setHistoryPage((p) => p + 1)}
            >
              နောက်
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={setup} onOpenChange={setSetup}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>ဂိုဒေါင်နှင့် သိုလှောင်နေရာ</DialogTitle>
            <DialogDescription>
              ဒီဆိုင်အတွက် နေရာအသစ် ဖန်တီးနိုင်ပါသည်။ အရင်ရှိပြီးသား
              နာမည်များကို စစ်ပြီးမှ ထည့်ပါ။
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-muted p-3 text-xs leading-7">
            ရှိပြီးသားဂိုဒေါင်များ —{" "}
            {warehouses
              .map((w) => `${w.name}${w.active ? "" : " (ပိတ်ထားသည်)"}`)
              .join("၊ ") || "မရှိသေးပါ"}
          </div>
          <Field label="ဖန်တီးမည့်အမျိုးအစား">
            <select
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={placeKind}
              disabled={busy}
              onChange={(e) =>
                setPlaceKind(e.target.value as "warehouse" | "location")
              }
            >
              <option value="warehouse">Warehouse</option>
              <option value="location">Storage Location / Rack</option>
            </select>
          </Field>
          {placeKind === "location" && (
            <Field label="ဂိုဒေါင်ရွေးရန်">
              <select
                className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                value={placeWarehouse}
                disabled={busy}
                onChange={(e) => setPlaceWarehouse(e.target.value)}
              >
                <option value="">ရွေးပါ</option>
                {warehouses
                  .filter((w) => w.active)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Field label="အမည်">
            <Input
              value={placeName}
              maxLength={200}
              disabled={busy}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder={
                placeKind === "warehouse"
                  ? "Main Warehouse"
                  : "Cold Room A / Rack 02"
              }
            />
          </Field>
          {placeNotice && (
            <p role="status" className="text-xs leading-7">
              {placeNotice}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void refreshWarehouses();
                setLocationRevision((v) => v + 1);
              }}
            >
              စာရင်းပြန်တင်ရန်
            </Button>
            <Button
              disabled={
                busy ||
                !placeName.trim() ||
                (placeKind === "location" && !placeWarehouse)
              }
              onClick={() => void createPlace()}
            >
              နေရာဖန်တီးရန်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
