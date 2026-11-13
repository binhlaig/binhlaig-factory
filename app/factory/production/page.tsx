"use client";

import { LoadingScreen } from "@/components/loading-screen";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useZxing } from "react-zxing";
import {
  Barcode,
  Camera,
  ListFilter,
  Package,
  History,
  Save,
  Check,
  Plus,
  ArrowRight,
  LockKeyhole,
  Info,
  Cog,
  Loader2,
  RefreshCw,
  Trash2,
  Target,
  ChartNoAxesCombined,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  requestJson as api,
  decodePlaces,
  type Place,
} from "@/lib/warehouse/factory-stock-api";
import {
  bulkBalances,
  confirmedBulkReceipts,
  stockKey,
  quantity,
  isPositive,
} from "@/lib/warehouse/factory-warehouse-bulk";
import {
  fresh,
  decimal,
  plan,
  plain,
  fmt,
  validate,
  decodeDrafts,
  type Draft,
  type Source,
} from "@/lib/production/factory-production-model";
import {
  type Production,
  type Operation,
  saveBody,
  perform,
  formOf,
  savedSource,
  historyPage as fetchHistory,
  getProduction,
  decodeOperation,
} from "@/lib/production/factory-production-api";
import { StockError } from "@/lib/warehouse/factory-stock-api";
// Render named base quantities only. Confirm still sends the original canonical units.
function productionBase(value: bigint | null | undefined, unit: string): string {
  if (value == null) return "—";
  if (unit !== "ကျပ်သား") return `${fmt(value)} ${unit}`;
  const scale=BigInt(1000000),abs=value < BigInt(0) ? -value : value;
  const viss=abs/(BigInt(100)*scale),remainder=abs%(BigInt(100)*scale);
  const kyattha=plain(remainder),sign=value<BigInt(0)?"−":"";
  if (!abs) return "0 ပိဿာ (0 ကျပ်သား)";
  if (!viss) return `${sign}${kyattha} ကျပ်သား`;
  return `${sign}${viss.toLocaleString("en-US")} ပိဿာ${remainder ? ` ${kyattha} ကျပ်သား` : ""} (${fmt(value)} ကျပ်သား)`;
}
function productionPackageSize(receipt: Source["receipt"] | undefined): string {
  if (!receipt) return "—";
  const snapshot=receipt.snapshot;
  // COUNT's backend packageSizeUnit is "unit"; retain the actual named unit in the UI.
  const unit=snapshot.packageSizeUnit === "unit" && ["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(snapshot.productType) && snapshot.bulk?.baseUnit
    ? snapshot.bulk.baseUnit : snapshot.packageSizeUnit;
  return `${String(snapshot.packageSize)} ${unit}`;
}
function isVissProduction(source: Source | null): boolean {
  const bulk=source?.receipt.snapshot.bulk;
  return !!bulk && bulk.packageUnit === "ပိဿာ" && bulk.baseUnit === "ကျပ်သား" &&
    decimal(bulk.quantityPerPackage) === BigInt(100000000);
}
const FONT = { fontFamily: '"Noto Sans Myanmar", "Myanmar Text", sans-serif' };
const emptyFilters = { search: "", warehouseId: "", locationId: "", batch: "" };
function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 rounded-2xl py-0 shadow-none">
      <CardContent className="space-y-3 p-4">
        <h2 className="flex flex-wrap items-center gap-3 text-base font-semibold leading-8">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-600 text-sm text-white">
            {number}
          </span>
          {title}
        </h2>
        {children}
      </CardContent>
    </Card>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const id = React.useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs leading-6">
        {label}
      </Label>
      {React.cloneElement(children, { id })}
    </div>
  );
}
function Photo({
  source,
  output = false,
  small = false,
}: {
  source: Source | null;
  output?: boolean;
  small?: boolean;
}) {
  const key = source ? `${stockKey(source.balance)}:${output}` : "empty";
  const [attempt, setAttempt] = React.useState({ key, index: 0 });
  const urls = source
    ? output
      ? [
          `/api/factory/costings/${source.receipt.costingSheetId}/items/${source.receipt.costingItemId}/images/PACKAGED?v=${source.receipt.sourceVersion}`,
        ]
      : (source.balance.imageUrls ?? [])
    : [];
  const index = attempt.key === key ? attempt.index : 0,
    src = urls[index];
  return (
    <div
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-muted/40 ${small ? "h-36 w-32" : "aspect-square w-full"}`}
    >
      {src ? (
        <img
          src={src}
          alt={output ? "ခွဲထုတ်ပြီး ပစ္စည်းပုံ" : "မူလအထုပ်ပုံ"}
          loading="lazy"
          onError={() => setAttempt({ key, index: index + 1 })}
          className="absolute inset-0 h-full w-full object-contain p-2"
        />
      ) : (
        <Package className="size-10 text-muted-foreground/40" />
      )}
    </div>
  );
}

function sessionObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function identityValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
      return String(value);
    if (
      typeof value === "string" &&
      value.trim() &&
      value.trim() !== "undefined" &&
      value.trim() !== "null"
    )
      return value.trim();
  }
  return null;
}
function sessionIdentity(value: unknown): string | null {
  const session = sessionObject(value),
    user = sessionObject(session.user);
  const token = session.accessToken ?? user.accessToken;
  let claims: Record<string, unknown> = {};
  if (typeof token === "string" && token.length < 65536) {
    try {
      const parts = token.replace(/^Bearer\s+/i, "").split(".");
      if (parts.length === 3 && /^[A-Za-z0-9_-]+$/.test(parts[1])) {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const bytes = Uint8Array.from(
          atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
          (c) => c.charCodeAt(0),
        );
        claims = sessionObject(JSON.parse(new TextDecoder().decode(bytes)));
      }
    } catch {
      /* An opaque/malformed token is not a browser storage identity. */
    }
  }
  const account = identityValue(
    user.id,
    user.username,
    session.userId,
    session.username,
    claims.accountId,
    claims.userId,
    claims.sub,
    user.email,
  );
  const shop = identityValue(
    user.shopId,
    user.shop_id,
    session.shopId,
    session.shop_id,
    claims.shopId,
    claims.shop_id,
    user.shopCode,
    session.shopCode,
    claims.shopCode,
  );
  // Preserve the previous storage key when user.id + user.shopId already exist.
  return account && shop ? JSON.stringify([account, shop]) : null;
}

function ProductionCameraScanner({
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
          aria-label="Production barcode camera"
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

export default function ProductionPage() {
  const { data, status } = useSession();
  if (status !== "authenticated")
    return (
      <p role="status" className="p-6 text-sm">
        {status === "loading" ? "Login session စစ်နေသည်…" : "Login ပြန်ဝင်ပါ။"}
      </p>
    );
  const identity = sessionIdentity(data),
    u = sessionObject(sessionObject(data).user);
  const staff = [u.fullName, u.name, u.username].find(
    (v) => typeof v === "string" && v.trim(),
  ) as string | undefined;
  return (
    <Workspace
      key={identity ?? "read-only"}
      identity={identity}
      staff={staff ?? ""}
    />
  );
}
function Workspace({
  identity,
  staff,
}: {
  identity: string | null;
  staff: string;
}) {
  const [catalog, setCatalog] = React.useState<Source[]>([]),
    [busy, setBusy] = React.useState(true),
    [error, setError] = React.useState(""),
    [revision, setRevision] = React.useState(0),
    [places, setPlaces] = React.useState<{
      warehouses: Place[];
      locations: Record<number, string>;
    }>({ warehouses: [], locations: {} });
  const [form, setForm] = React.useState<Draft | null>(null),
    [baseline, setBaseline] = React.useState(""),
    [barcode, setBarcode] = React.useState(""),
    [errors, setErrors] = React.useState<string[]>([]),
    [notice, setNotice] = React.useState("");
  const [picker, setPicker] = React.useState(false),
    [search, setSearch] = React.useState(""),
    [pickerPage, setPickerPage] = React.useState(0);
  const [camera, setCamera] = React.useState(false),
    [cameraAttempt, setCameraAttempt] = React.useState(0);
  const closeCamera = React.useCallback(() => setCamera(false), []);
  const [records, setRecords] = React.useState<Draft[]>([]),
    [storageError, setStorageError] = React.useState(""),
    [history, setHistory] = React.useState(false),
    [historyPage, setHistoryPage] = React.useState(0);
  const [action, setAction] = React.useState<
      "save" | "review" | "reset" | null
    >(null),
    [pending, setPending] = React.useState<Source | Draft | Production | null>(
      null,
    );
  const [serverRecord, setServerRecord] = React.useState<Production | null>(
    null,
  );
  const [recordSource, setRecordSource] = React.useState<Source | null>(null);
  const [working, setWorking] = React.useState(false);
  const [operation, setOperation] = React.useState<Operation | null>(null);
  const [journalReady, setJournalReady] = React.useState(false);
  const [serverHistory, setServerHistory] = React.useState<Production[]>([]);
  const [serverTotal, setServerTotal] = React.useState(0);
  const [serverPage, setServerPage] = React.useState(0);
  const [historyStatus, setHistoryStatus] = React.useState("");
  const [historyBusy, setHistoryBusy] = React.useState(false);
  const [historyError, setHistoryError] = React.useState("");
  const [serverHistoryOpen, setServerHistoryOpen] = React.useState(false);
  const [historyRevision, setHistoryRevision] = React.useState(0);
  const readOnly = !!serverRecord && serverRecord.status !== "DRAFT";
  const journalKey = identity
    ? `binhlaig:factory:production:pending:v1:${identity}`
    : null;
  const source =
    recordSource && serverRecord
      ? {
          ...recordSource,
          balance:
            catalog.find((s) => stockKey(s.balance) === form?.sourceKey)
              ?.balance ?? recordSource.balance,
        }
      : (catalog.find((s) => stockKey(s.balance) === form?.sourceKey) ?? null);
  const dirty =
    !!form &&
    !readOnly &&
    (form.revision === 0 || JSON.stringify(form) !== baseline);
  const saving = React.useRef(false),
    initial = React.useRef(false),
    searchRef = React.useRef<HTMLInputElement>(null);
  const storageKey = identity
    ? `binhlaig:factory:bulk-production:drafts:v1:${identity}`
    : null;
  let calculated: ReturnType<typeof plan> | null = null,
    calculationError = "";
  if (source && form) {
    try {
      calculated = plan(source, form);
    } catch (e) {
      calculationError = e instanceof Error ? e.message : "တွက်ချက်မရပါ။";
    }
  }
  if (calculated && serverRecord && form && JSON.stringify(form) === baseline) {
    calculated = {
      ...calculated,
      used: decimal(serverRecord.consumedBaseQuantity),
      expected: BigInt(serverRecord.expectedOutputQuantity),
      packageBase: decimal(serverRecord.outputPackageBaseQuantity),
      actual:
        serverRecord.actualOutputQuantity === null
          ? null
          : BigInt(serverRecord.actualOutputQuantity),
      waste:
        serverRecord.actualWasteQuantity === null
          ? null
          : decimal(serverRecord.actualWasteQuantity),
      variance:
        serverRecord.variance === null ? null : BigInt(serverRecord.variance),
    };
  }
  if (calculated && readOnly)
    calculated = {
      ...calculated,
      remaining: decimal(source!.balance.quantity),
    };
  const p = calculated,
    b = source?.balance,
    r = source?.receipt;
  const count = (v: bigint | null | undefined) =>
    v == null ? "—" : v.toLocaleString("en-US");
  const unit = b?.unit ?? "ယူနစ်",
    outUnit = r?.snapshot.saleUnit ?? "ထုပ်";
  const outputSize = productionPackageSize(r);
  const vissSource = isVissProduction(source);
  const base = (value: bigint | null | undefined) => productionBase(value, unit);
  React.useEffect(() => {
    try {
      const raw = journalKey ? localStorage.getItem(journalKey) : null;
      setOperation(raw ? decodeOperation(raw) : null);
      setJournalReady(true);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Request မှတ်တမ်း ဖတ်မရပါ။"]);
      setJournalReady(false);
    }
  }, [journalKey]);
  React.useEffect(() => {
    if (!serverHistoryOpen) return;
    let active = true;
    setHistoryBusy(true);
    setHistoryError("");
    void fetchHistory(serverPage, historyStatus)
      .then((result) => {
        if (active) {
          setServerHistory(result.content);
          setServerTotal(result.totalElements);
        }
      })
      .catch((e) => {
        if (active)
          setHistoryError(e instanceof Error ? e.message : "History ဖတ်မရပါ။");
      })
      .finally(() => {
        if (active) setHistoryBusy(false);
      });
    return () => {
      active = false;
    };
  }, [serverHistoryOpen, serverPage, historyStatus, historyRevision]);
  const updated = React.useRef(false);
  React.useEffect(() => {
    const c = new AbortController();
    let active = true;
    setBusy(true);
    setError("");
    void Promise.all([
      api("/api/factory/warehouse/bulk-balances", { signal: c.signal }),
      confirmedBulkReceipts(c.signal),
    ])
      .then(([raw, receipts]) => {
        const rows = bulkBalances(
          raw,
          receipts,
          emptyFilters,
          0,
          Number.MAX_SAFE_INTEGER,
        ).content;
        const result: Source[] = rows.map((balance) => {
          const receipt = receipts.find(
            (r) =>
              stockKey({
                itemId: r.costingItemId,
                sourceVersion: r.sourceVersion,
                warehouseId: r.warehouseId,
                locationId: r.locationId,
                batch: r.batch,
              }) === stockKey(balance),
          );
          if (!receipt)
            throw Error(
              `ပစ္စည်း ${balance.barcode} ၏ Receiving snapshot မတွေ့ပါ။`,
            );
          return { balance, receipt };
        });
        if (active) {
          setCatalog(result);
          updated.current = true;
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Warehouse Stock ရယူမရပါ။");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [revision]);
  React.useEffect(() => {
    let active = true;
    const c = new AbortController();
    void api("/api/factory/receivings/warehouses", { signal: c.signal })
      .then(decodePlaces)
      .then(async (warehouses) => {
        const results = await Promise.allSettled(
          warehouses.map((w) =>
            api(`/api/factory/receivings/warehouses/${w.id}/locations`, {
              signal: c.signal,
            }).then(decodePlaces),
          ),
        );
        const locations: Record<number, string> = {};
        for (const result of results)
          if (result.status === "fulfilled")
            for (const l of result.value) locations[l.id] = l.name;
        if (active) setPlaces({ warehouses, locations });
      })
      .catch(() => {
        /* Keep explicit warehouse/location IDs visible when names are unavailable. */
      });
    return () => {
      active = false;
      c.abort();
    };
  }, []);
  React.useEffect(() => {
    function load() {
      try {
        setRecords(
          storageKey ? decodeDrafts(localStorage.getItem(storageKey)) : [],
        );
        setStorageError("");
      } catch (e) {
        setStorageError(e instanceof Error ? e.message : "မူကြမ်း ဖတ်မရပါ။");
      }
    }
    load();
    const listener = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null) load();
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [storageKey]);
  React.useEffect(() => {
    if (!updated.current || initial.current || !journalReady || operation)
      return;
    initial.current = true;
    const q = new URLSearchParams(window.location.search);
    if (!q.has("itemId")) return;
    const matches = catalog.filter(
      (s) =>
        String(s.balance.itemId) === q.get("itemId") &&
        ["sourceVersion", "warehouseId", "locationId", "batch"].every(
          (k) =>
            !q.has(k) ||
            String(s.balance[k as keyof typeof s.balance]) === q.get(k),
        ),
    );
    if (matches.length === 1 && isPositive(matches[0].balance.quantity)) {
      const next = fresh(matches[0], staff);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setBarcode(matches[0].balance.barcode);
    } else {
      setPicker(true);
      setNotice(
        "Warehouse လင့်ခ်မှ ပစ္စည်းကို တစ်ခုတည်းမတွေ့ပါ။ Batch နှင့် နေရာကို ပြန်ရွေးပါ။",
      );
    }
  }, [catalog, staff, journalReady, operation]);
  React.useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  function adopt(next: Source | Draft) {
    if (saving.current || operation) return;
    setServerRecord(null);
    setRecordSource(null);
    const nextForm = "balance" in next ? fresh(next, staff) : next;
    setForm(nextForm);
    setBaseline(JSON.stringify(nextForm));
    setBarcode(
      catalog.find((s) => stockKey(s.balance) === nextForm.sourceKey)?.balance
        .barcode ?? "",
    );
    setErrors([]);
    setNotice("");
    setPicker(false);
    setHistory(false);
  }
  function choose(next: Source | Draft) {
    if (working || operation) return;
    if (dirty) {
      setPending(next);
      return;
    }
    adopt(next);
  }
  function patch(key: keyof Draft, value: string) {
    if (!form || readOnly || working || operation) return;
    setForm({ ...form, [key]: value });
    setErrors([]);
    setNotice("");
  }
  function lookup(code: string) {
    const value = code.trim().toUpperCase();
    if (!/^FC-[1-9]\d*-[1-9]\d*$/.test(value)) {
      setErrors(["FC-12-34 ပုံစံ Barcode ဖြည့်ပါ။"]);
      return;
    }
    setBarcode(value);
    const matches = catalog.filter(
      (s) => s.balance.barcode === value && isPositive(s.balance.quantity),
    );
    if (matches.length === 1) choose(matches[0]);
    else if (matches.length > 1) {
      setSearch(value);
      setPickerPage(0);
      setPicker(true);
      setNotice("ပစ္စည်းတူ Batch / နေရာ များရှိသဖြင့် တစ်ခုရွေးပါ။");
    } else
      setErrors([
        busy
          ? "Warehouse စာရင်း ရယူနေသည်။ ခဏစောင့်ပါ။"
          : "ဤ Barcode အတွက် လက်ခံအတည်ပြုပြီးသော လက်ကျန်မတွေ့ပါ။",
      ]);
  }
  function requestAction(next: "save" | "review") {
    const problems = validate(source, form, next === "review");
    if (!journalReady || !journalKey || storageError)
      problems.push(
        storageError ||
          "Request မှတ်တမ်းအတွက် အကောင့်နှင့်ဆိုင်အချက်အလက် လိုအပ်ပါသည်။",
      );
    if (operation || working || readOnly) return;
    if (error) problems.push("Warehouse data ကို ပြန်တင်ပြီး စစ်ပါ။");
    setErrors(problems);
    if (!problems.length) setAction(next);
  }
  async function displayRecord(record: Production, keepSource?: Source) {
    initial.current = true;
    const snapshot = keepSource ?? (await savedSource(record, catalog));
    const next = formOf(record);
    setServerRecord(record);
    setRecordSource(snapshot);
    setForm(next);
    setBaseline(JSON.stringify(next));
    setBarcode(record.barcode);
    setServerHistoryOpen(false);
    setHistory(false);
    setErrors([]);
  }
  function journal(op: Operation | null) {
    if (!journalKey) throw Error("အကောင့်/ဆိုင်အချက်အလက် မရပါ။");
    if (op) {
      const previous = localStorage.getItem(journalKey);
      if (previous && previous !== JSON.stringify(op))
        throw Error(
          "အခြား tab တွင် မပြီးသေးသော request ရှိပါသည်။ Page ပြန်ဖွင့်ပြီး ယခင် request ကို စစ်ပါ။",
        );
      localStorage.setItem(journalKey, JSON.stringify(op));
    } else localStorage.removeItem(journalKey);
    setOperation(op);
  }
  async function send(op: Operation, recovering = false) {
    journal(op); // Persist before any mutation leaves this browser.
    const result = await perform(op, recovering);
    journal(null);
    return result;
  }
  async function saveDraft(confirm = false) {
    if (!form || !source || saving.current || readOnly || operation) return;
    const problems = validate(source, form, confirm);
    if (problems.length) {
      setErrors(problems);
      setAction(null);
      return;
    }
    saving.current = true;
    setWorking(true);
    setErrors([]);
    try {
      let record = serverRecord;
      if (!record || JSON.stringify(form) !== baseline) {
        const op: Operation = {
          method: record ? "PUT" : "POST",
          path: `/api/factory/productions${record ? `/${record.id}` : ""}`,
          key: crypto.randomUUID(),
          body: saveBody(source, form, record?.version),
        };
        record = await send(op);
        await displayRecord(record, source);
      }
      if (confirm) {
        record = await send({
          method: "POST",
          path: `/api/factory/productions/${record.id}/confirm`,
          key: crypto.randomUUID(),
          body: { version: record.version },
        });
        if (record.status !== "CONFIRMED")
          throw new StockError(
            "Server က ထုတ်လုပ်မှုကို အတည်မပြုသေးပါ။",
            502,
            true,
          );
        await displayRecord(record, source);
        setRevision((v) => v + 1);
        setNotice(
          `${record.productionNumber} — ထုတ်လုပ်မှု အတည်ပြုပြီးပါပြီ။ Bulk နှင့် Finished Stock ကို Server တွင် ပြောင်းပြီးပါပြီ။`,
        );
      } else
        setNotice(
          `${record.productionNumber} — Server တွင် မူကြမ်းသိမ်းပြီးပါပြီ။ Stock မပြောင်းသေးပါ။`,
        );
      setHistoryRevision((v) => v + 1);
      setAction(null);
    } catch (e) {
      if (
        e instanceof StockError &&
        e.status >= 400 &&
        e.status < 500 &&
        !e.uncertain
      ) {
        try {
          journal(null);
        } catch {
          /* Preserve unresolved marker if browser storage fails. */
        }
      }
      setErrors([e instanceof Error ? e.message : "သိမ်းမရပါ။"]);
      setAction(null);
    } finally {
      saving.current = false;
      setWorking(false);
    }
  }
  async function recover() {
    if (!operation || saving.current) return;
    saving.current = true;
    setWorking(true);
    setErrors([]);
    try {
      const replay = await perform(operation, true);
      // Create replay may return its original DRAFT; read current lifecycle before opening.
      const latest = await getProduction(replay.id);
      await displayRecord(latest);
      journal(null);
      setRevision((v) => v + 1);
      setHistoryRevision((v) => v + 1);
      setNotice(
        latest.status === "CONFIRMED"
          ? "Server မှ အတည်ပြုပြီးသော ထုတ်လုပ်မှုကို ပြန်ဖတ်ပြီးပါပြီ။ Stock ထပ်မနုတ်ပါ။"
          : "Server မူကြမ်းကို ပြန်ဖတ်ပြီးပါပြီ။ စစ်ဆေးပြီးမှ အတည်ပြုပါ။",
      );
    } catch (e) {
      if (
        e instanceof StockError &&
        [400, 404, 409, 422].includes(e.status) &&
        !e.uncertain
      ) {
        const match = /productions\/([1-9]\d*)/.exec(operation.path);
        try {
          if (match) await displayRecord(await getProduction(Number(match[1])));
          journal(null);
          setNotice(
            "ယခင် request ကို Server က လက်မခံပါ။ လက်ရှိမှတ်တမ်းကို စစ်ပြီးမှ ပြန်လုပ်ပါ။",
          );
        } catch {
          /* Retain recovery marker if the current server state cannot be read. */
        }
      }
      setErrors([e instanceof Error ? e.message : "ပြန်စမ်းမရပါ။"]);
    } finally {
      saving.current = false;
      setWorking(false);
    }
  }
  async function openRecord(id: number) {
    if (saving.current || operation) return;
    saving.current = true;
    setWorking(true);
    try {
      await displayRecord(await getProduction(id));
      setNotice("");
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "ဖွင့်မရပါ။");
    } finally {
      saving.current = false;
      setWorking(false);
    }
  }
  const warehouseName = (id: number) =>
    places.warehouses.find((w) => w.id === id)?.name ?? `Warehouse #${id}`;
  const locationName = (id: number) =>
    places.locations[id] ?? `Location #${id}`;
  const filtered = catalog.filter(
    (s) =>
      [
        s.balance.name,
        s.balance.barcode,
        s.balance.batch,
        warehouseName(s.balance.warehouseId),
        locationName(s.balance.locationId),
      ].some((v) =>
        v.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ) && isPositive(s.balance.quantity),
  );
  const pickerPages = Math.max(1, Math.ceil(filtered.length / 6)),
    pickPage = Math.min(pickerPage, pickerPages - 1);
  const hp = Math.min(
    historyPage,
    Math.max(0, Math.ceil(records.length / 6) - 1),
  );
  return (
    <main
      lang="my"
      style={FONT}
      className="mx-auto min-h-[calc(100dvh-4rem)] min-w-0 max-w-[1480px] space-y-4 bg-gradient-to-br from-blue-50/60 via-background to-slate-50/60 p-3 text-foreground dark:from-blue-950/20 dark:to-background sm:p-5 lg:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-relaxed sm:text-3xl">
            ခွဲထုတ် / ထုတ်လုပ်ခြင်း
          </h1>
          <p className="mt-1 text-xs leading-7 text-muted-foreground">
            Production • Warehouse မှ ထုတ်ယူပြီး Costing အတိုင်း ခွဲထုတ်ရန်
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="min-h-10 border-amber-300 bg-amber-50 px-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          >
            {serverRecord?.status === "CONFIRMED"
              ? "Confirmed (အတည်ပြုပြီး)"
              : serverRecord?.status === "CANCELLED"
                ? "Cancelled"
                : "Draft (မူကြမ်း)"}
          </Badge>
          <Button
            variant="outline"
            disabled={working || !!operation}
            onClick={() => setServerHistoryOpen(true)}
          >
            <History className="size-4" />
            History
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (working || operation) return;
              if (form) setAction("reset");
              else {
                setSearch("");
                setPicker(true);
              }
            }}
          >
            <Plus className="size-4" />
            အသစ်
          </Button>
        </div>
      </header>
      {operation && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p>
            ယခင် request ၏ ရလဒ်ကို စစ်ရန်လိုပါသည်။ အသစ်ထပ်မသွင်းဘဲ တူညီသော
            request ကို ပြန်စမ်းပါ။
          </p>
          <Button disabled={working} onClick={recover}>
            {working ? "စစ်နေသည်…" : "ယခင် Request ပြန်စမ်းရန်"}
          </Button>
        </div>
      )}
      {serverRecord && (
        <p role="status" className="text-xs">
          {serverRecord.productionNumber} · {serverRecord.status} · Version{" "}
          {serverRecord.version}
        </p>
      )}
      {busy && (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
        ><LoadingScreen variant="inline" title="Warehouse လက်ကျန် ရယူနေသည်…" /></p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-7 text-destructive"
        >
          <p>{error}</p>
          <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
            ပြန်စမ်းရန်
          </Button>
        </div>
      )}
      {(storageError || notice) && (
        <p
          role={storageError ? "alert" : "status"}
          className={`rounded-xl border p-3 text-xs leading-7 ${storageError ? "text-destructive" : "border-blue-100 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"}`}
        >
          {storageError || notice}
        </p>
      )}
      {!!errors.length && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-7 text-destructive"
        >
          {errors.map((e) => (
            <p key={e}>• {e}</p>
          ))}
        </div>
      )}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(330px,1fr)]">
        <div className="min-w-0 space-y-4">
          <Section number="01" title="Warehouse ပစ္စည်းရွေးရန်">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookup(barcode);
              }}
              className="flex flex-wrap gap-2"
            >
              <div className="relative min-w-0 flex-1 basis-40">
                <Barcode className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  aria-label="Warehouse barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  maxLength={100}
                  placeholder="FC-12-34"
                  autoComplete="off"
                  className="h-11 pl-11"
                />
                <button
                  type="submit"
                  aria-label="Barcode ရှာရန်"
                  className="sr-only"
                >
                  ရှာရန်
                </button>
              </div>
              <Button
                type="button"
                aria-label="Camera Scan"
                className="h-11 bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => {
                  setCameraAttempt((v) => v + 1);
                  setCamera(true);
                }}
              >
                <Camera className="size-5" />
              </Button>
              <Button
                variant="outline"
                type="button"
                className="h-11"
                onClick={() => {
                  setSearch("");
                  setPickerPage(0);
                  setPicker(true);
                }}
              >
                <ListFilter className="size-4" />
                ပစ္စည်းရွေးမည်
              </Button>
              <Button
                variant="ghost"
                type="button"
                aria-label="Warehouse လက်ကျန်ပြန်တင်ရန်"
                disabled={busy || working || !!operation}
                onClick={() => setRevision((v) => v + 1)}
              >
                <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
              </Button>
            </form>
            {source ? (
              <div className="flex min-w-0 gap-3 rounded-xl border border-blue-100 bg-blue-50/30 p-2 dark:border-blue-900 dark:bg-blue-950/10">
                <div className="hidden shrink-0 sm:block">
                  <Photo source={source} small />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-lg font-semibold leading-8">
                    {b!.name}
                  </h3>
                  <dl className="text-xs">
                    {[
                      ["Barcode", b!.barcode],
                      ["Batch No.", b!.batch],
                      [
                        "Location",
                        `${warehouseName(b!.warehouseId)} / ${locationName(b!.locationId)}`,
                      ],
                      [
                        "လက်ရှိဂိုဒေါင်",
                        productionBase(decimal(b!.quantity), unit),
                      ],
                    ].map(([k, v]) => (
                      <div
                        key={k}
                        className="grid grid-cols-[95px_minmax(0,1fr)] gap-2 border-t border-blue-100/70 py-1.5 leading-6 dark:border-blue-900"
                      >
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-words font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            ) : (
              <p className="rounded-xl bg-muted/40 p-4 text-xs leading-7 text-muted-foreground">
                လက်ခံအတည်ပြုပြီးသော Bulk Stock မှ ပစ္စည်း၊ Batch နှင့် နေရာကို
                ရွေးပါ။
              </p>
            )}
          </Section>
          <Section number="02" title="ထုတ်ယူမည့်ပမာဏ">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label={vissSource ? "ထုတ်ယူမည့် ပိဿာ (အပြည့်ကိန်း)" : `ထုတ်ယူမည့်အထုပ်အရေအတွက် (${b?.packageUnit ?? "အထုပ်"})`}
              >
                <Input
                  aria-label={undefined}
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={form?.packages ?? ""}
                  disabled={!form || readOnly || working || !!operation}
                  onChange={(e) => patch("packages", e.target.value)}
                  placeholder="1"
                  className="h-11"
                />
              </Field>
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-[11px] leading-6 text-muted-foreground">
                  အလိုအလျောက်တွက်ချက်မှု
                </p>
                <p className="break-words text-sm font-semibold leading-7">
                  {form && b
                    ? `${form.packages || "—"} ${b.packageUnit ?? "အထုပ်"} × ${quantity(b.quantityPerPackage!)} ${unit} = ${base(p?.used)}`
                    : "—"}
                </p>
              </div>
              <div
                className={`rounded-xl border p-3 ${p && p.remaining < BigInt(0) ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-blue-100 bg-blue-50 text-emerald-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-emerald-300"}`}
              >
                <p className="text-[11px] leading-6">
                  {readOnly ? "လက်ရှိဂိုဒေါင်လက်ကျန်" : "ထုတ်ယူပြီး လက်ကျန် (ကြိုတွက်)"}
                </p>
                <p className="break-words text-base font-bold leading-7">
                  {base(p?.remaining)}
                </p>
              </div>
            </div>
            {vissSource && <p className="rounded-xl border bg-muted/40 p-3 text-xs leading-7 text-muted-foreground">1 ပိဿာ = 100 ကျပ်သား။ ထုတ်ယူပမာဏကို လက်ရှိ API အတိုင်း ပိဿာအပြည့်ကိန်းဖြင့် ဖြည့်ပါ။ အလေအလွင့်ကို ကျပ်သားဖြင့် ဖြည့်ပါ။ ပိဿာနှင့် ကျပ်သားသည် ပမာဏတစ်ခုတည်း၏ ဖော်ပြချက်နှစ်မျိုးဖြစ်ပြီး ထပ်မပေါင်းရပါ။</p>}
            {calculationError && (
              <p role="alert" className="text-xs leading-6 text-destructive">
                {calculationError}
              </p>
            )}
          </Section>
          <Section
            number="03"
            title={
              <>
                <span>Costing မှ ခွဲထုတ်ပုံ</span>
                <Badge
                  variant="outline"
                  className="gap-1.5 border-blue-100 bg-blue-50 font-normal text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                >
                  <LockKeyhole className="size-3" />
                  ပြင်ဆင်၍မရပါ
                </Badge>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              {[
                ["မူလတွက်ချက်ပမာဏ", base(p?.basis)],
                ["စံကျန် / အလေအလွင့်", base(p?.standardResidual)],
                ["တစ်ထုပ်ပါပမာဏ", outputSize],
                ["ခန့်မှန်းရရှိမှု", `${count(p?.expected)} ${outUnit}`],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 rounded-xl border bg-muted/40 p-3"
                >
                  <p className="text-[10px] leading-6 text-muted-foreground">
                    {label}
                  </p>
                  <p className="break-words text-base font-bold leading-7">
                    {source ? value : "—"}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[10px] leading-6 text-muted-foreground">
              စံကျန်ပမာဏတွင် Costing ရည်မှန်းချက်အရ မထုပ်ပိုးဖြစ်သော
              အကြွင်းပမာဏပါဝင်သည်။
            </p>
          </Section>
          <Section number="04" title="တကယ်ထုတ်လုပ်ရရှိမှု">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Field label={`တကယ်ရရှိသော အရေအတွက် (${outUnit})`}>
                <Input
                  value={form?.actual ?? ""}
                  inputMode="numeric"
                  disabled={!form || readOnly || working || !!operation}
                  placeholder="17"
                  onChange={(e) => patch("actual", e.target.value)}
                  className="h-11"
                />
              </Field>
              <Field label={`တကယ်အလေအလွင့် (${unit})`}>
                <Input
                  value={form?.waste ?? ""}
                  inputMode="decimal"
                  disabled={!form || readOnly || working || !!operation}
                  placeholder="မရှိလျှင် 0"
                  onChange={(e) => patch("waste", e.target.value)}
                  className="h-11"
                />
              </Field>
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                <p className="text-[10px] leading-6">ကွာခြားချက် (Variance)</p>
                <p className="break-words text-lg font-bold">
                  {p?.variance != null
                    ? `${p.variance > BigInt(0) ? "+" : ""}${count(p.variance)} ${outUnit}`
                    : "—"}
                </p>
              </div>
              <Field label="ကွာခြားရသည့်အကြောင်းရင်း">
                <Input
                  value={form?.reason ?? ""}
                  maxLength={500}
                  disabled={!form || readOnly || working || !!operation}
                  onChange={(e) => patch("reason", e.target.value)}
                  className="h-11"
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Output Batch No.">
                <Input
                  value={form?.batch ?? ""}
                  maxLength={100}
                  disabled={!form || readOnly || working || !!operation}
                  onChange={(e) => patch("batch", e.target.value)}
                  className="h-11"
                />
              </Field>
              <Field label="တာဝန်ခံအမည်">
                <Input
                  value={form?.staff ?? ""}
                  maxLength={200}
                  disabled={!form || readOnly || working || !!operation}
                  onChange={(e) => patch("staff", e.target.value)}
                  className="h-11"
                />
              </Field>
              <Field label="ထုတ်လုပ်ရက်">
                <Input
                  type="date"
                  value={form?.date ?? ""}
                  disabled={!form || readOnly || working || !!operation}
                  onChange={(e) => patch("date", e.target.value)}
                  className="h-11"
                />
              </Field>
              <Field label="မှတ်ချက်">
                <Input
                  value={form?.note ?? ""}
                  maxLength={2000}
                  disabled={!form || readOnly || working || !!operation}
                  onChange={(e) => patch("note", e.target.value)}
                  className="h-11"
                />
              </Field>
            </div>
            {unit === "ကျပ်သား" && p?.actual != null && p.waste != null && <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-7 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">ပမာဏစစ်ဆေးရန် — ထုတ်ယူ {base(p.used)} = ကုန်ချော {count(p.actual)} {outUnit} × {outputSize} + အလေအလွင့် {base(p.waste)} ဖြစ်ရပါမည်။</p>}
            {p?.residual != null && p.residual !== BigInt(0) && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs leading-7 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                ပမာဏစစ်ဆေးရန် — ထုတ်ယူမှုနှင့် ထုတ်ကုန် + အလေအလွင့် ကွာခြားချက်{" "}
                {base(p.residual)}
              </p>
            )}
          </Section>
        </div>
        <aside className="min-w-0 rounded-2xl border bg-card p-4 lg:sticky lg:top-4">
          <h2 className="mb-3 text-lg font-semibold leading-8">
            ထုတ်လုပ်မှုအကျဉ်း
          </h2>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <div className="min-w-0 rounded-xl border bg-muted/30 p-2">
              <p className="mb-1 text-center text-xs font-semibold leading-7">
                အထုပ်ကြီး
              </p>
              <Photo source={source} />
              <p className="mt-1 break-words text-center text-[10px] leading-6">
                {b
                  ? `${b.name} (${productionBase(decimal(b.quantityPerPackage!), unit)} / ${b.packageUnit})`
                  : "Warehouse ပစ္စည်း"}
              </p>
            </div>
            <ArrowRight className="size-6" />
            <div className="min-w-0 rounded-xl border bg-muted/30 p-2">
              <p className="mb-1 text-center text-xs font-semibold leading-7">
                ခွဲထုတ်ပြီး
              </p>
              <Photo source={source} output />
              <p className="mt-1 break-words text-center text-[10px] leading-6">
                {b ? `${b.name} (${outputSize} / ${outUnit})` : "ထုတ်ကုန်"}
              </p>
            </div>
          </div>
          <dl className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/30">
            {[
              [
                <Package className="size-5" />,
                "အသုံးပြုမည့် ကုန်ကြမ်း",
                base(p?.used),
              ],
              [
                <Target className="size-5" />,
                "ခန့်မှန်းထုတ်လုပ်မှု",
                `${count(p?.expected)} ${outUnit}`,
              ],
              [
                <ChartNoAxesCombined className="size-5" />,
                "တကယ်ထုတ်လုပ်ရရှိမှု",
                `${count(p?.actual)} ${outUnit}`,
              ],
              [
                <Trash2 className="size-5" />,
                "တကယ်အလေအလွင့်",
                base(p?.waste),
              ],
            ].map(([icon, label, value], i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 py-1.5 last:border-0 dark:border-blue-900"
              >
                <dt className="flex items-center gap-2 leading-7">
                  <span className="text-blue-600">{icon}</span>
                  {label}
                </dt>
                <dd
                  className={`break-all text-right text-base font-bold ${i === 2 ? "text-emerald-700 dark:text-emerald-300" : ""}`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            <Package className="size-8 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold leading-6">
                {readOnly
                  ? "မှတ်တမ်းတင်ထားသော ကုန်ချော"
                  : "ရရှိမည့် ကုန်ချော (ကြိုတွက်)"}
              </p>
              <p className="break-words text-xl font-bold leading-9 sm:text-2xl">
                {count(p?.actual)} {outUnit} × {outputSize}
              </p>
            </div>
          </div>
          <p className="mt-3 rounded-lg border bg-muted/40 px-2 py-1.5 text-[11px] font-medium leading-6">
            {readOnly
              ? "ဤထုတ်လုပ်မှု၏ Stock ပြောင်းလဲမှုမှတ်တမ်း"
              : "အတည်ပြုပြီးမှ ဖြစ်မည့် Stock ပြောင်းလဲမှု"}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <p className="text-[11px] leading-6">အထုပ်ကြီး Stock</p>
              <p className="break-words text-base font-bold">
                − {base(p?.used)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
              <p className="text-[11px] leading-6">ခွဲထုတ်ပြီး Stock</p>
              <p className="break-words text-base font-bold">
                + {count(p?.actual)} {outUnit}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2 rounded-xl bg-blue-50 p-3 text-xs leading-7 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <Info className="mt-1 size-4 shrink-0" />
            <p>
              အတည်ပြုမှ Stock ပြောင်းမည်။ ထုတ်ကုန်ကို Receiving တွင်
              ထပ်မသွင်းရပါ။
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="min-h-12 flex-1 bg-blue-600 text-white hover:bg-blue-700"
              disabled={
                !source ||
                busy ||
                readOnly ||
                working ||
                !!operation ||
                !journalReady
              }
              onClick={() => requestAction("review")}
            >
              <Check className="size-4" />
              ထုတ်လုပ်မှုအတည်ပြုမည်
            </Button>
            <Button
              variant="outline"
              className="min-h-12"
              disabled={
                !source ||
                busy ||
                readOnly ||
                working ||
                !!operation ||
                !journalReady
              }
              onClick={() => requestAction("save")}
            >
              <Save className="size-4" />
              မူကြမ်းသိမ်းရန်
            </Button>
          </div>
          <p className="mt-2 text-[10px] leading-6 text-muted-foreground">
            မူကြမ်းကို Server တွင် သိမ်းပါသည်။ Confirm အောင်မြင်မှ Stock
            ပြောင်းပါမည်။
          </p>
          <p className="mt-3 rounded-lg bg-muted/40 p-2 text-center text-[11px] leading-6 text-muted-foreground">
            Warehouse အထုပ်ကြီး → Production → ခွဲထုတ်ပြီး Stock
          </p>
        </aside>
      </div>
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent
          style={FONT}
          className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-3xl"
        >
          <DialogHeader>
            <DialogTitle>Warehouse ပစ္စည်း / Batch ရွေးရန်</DialogTitle>
            <DialogDescription>
              လက်ခံအတည်ပြုပြီး လက်ကျန်ရှိသော အထုပ်ကြီးများသာ ပြထားပါသည်။
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Warehouse ပစ္စည်းစာရင်းရှာရန်"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPickerPage(0);
            }}
            placeholder="အမည် / Barcode / Batch / နေရာ"
          />
          {busy && (
            <p role="status" className="text-xs">
              ရယူနေသည်…
            </p>
          )}
          <div className="space-y-2">
            {filtered.slice(pickPage * 6, pickPage * 6 + 6).map((s) => (
              <button
                key={stockKey(s.balance)}
                type="button"
                onClick={() => choose(s)}
                className="flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:border-blue-400 hover:bg-blue-50/40"
              >
                <div className="w-14 shrink-0">
                  <Photo source={s} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-7">
                    {s.balance.name}
                  </p>
                  <p className="break-all text-[11px] leading-6 text-muted-foreground">
                    {s.balance.barcode} · Batch {s.balance.batch}
                  </p>
                  <p className="text-xs leading-6">
                    {warehouseName(s.balance.warehouseId)} /{" "}
                    {locationName(s.balance.locationId)} ·{" "}
                    {productionBase(decimal(s.balance.quantity), s.balance.unit)}
                  </p>
                </div>
              </button>
            ))}
          </div>
          {!busy && !filtered.length && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              ဤရှာဖွေမှုအတွက် လက်ကျန်မတွေ့ပါ။
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={pickPage === 0}
              onClick={() => setPickerPage((v) => v - 1)}
            >
              ရှေ့
            </Button>
            <span className="self-center text-xs">
              {pickPage + 1} / {pickerPages}
            </span>
            <Button
              variant="outline"
              disabled={pickPage + 1 >= pickerPages}
              onClick={() => setPickerPage((v) => v + 1)}
            >
              နောက်
            </Button>
            <Button variant="outline" onClick={() => setPicker(false)}>
              ပိတ်မည်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={camera}
        onOpenChange={(open) => {
          setCamera(open);
          if (!open) {
            requestAnimationFrame(() => searchRef.current?.focus());
          }
        }}
      >
        <DialogContent
          style={FONT}
          className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>Production Barcode Scan</DialogTitle>
            <DialogDescription>
              FC barcode ဖတ်ပြီး Warehouse Batch ကို ရွေးပါ။
            </DialogDescription>
          </DialogHeader>
          {camera && (
            <ProductionCameraScanner
              key={cameraAttempt}
              onClose={closeCamera}
              onScan={(code) => {
                closeCamera();
                lookup(code);
              }}
            />
          )}
          <DialogFooter>
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
      <Dialog open={serverHistoryOpen} onOpenChange={setServerHistoryOpen}>
        <DialogContent
          style={FONT}
          className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>Production မှတ်တမ်း</DialogTitle>
            <DialogDescription>
              Server တွင် သိမ်းထားသော မူကြမ်းနှင့် အတည်ပြုပြီး ထုတ်လုပ်မှုများ
            </DialogDescription>
          </DialogHeader>
          <select
            aria-label="Production status"
            value={historyStatus}
            onChange={(e) => {
              setHistoryStatus(e.target.value);
              setServerPage(0);
            }}
            className="rounded-lg border bg-background p-2"
          >
            <option value="">အားလုံး</option>
            <option value="DRAFT">DRAFT</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          {historyBusy && <p role="status">ရယူနေသည်…</p>}
          {historyError && (
            <p role="alert" className="text-destructive">
              {historyError}
            </p>
          )}
          {!historyBusy && !historyError && !serverHistory.length && (
            <p>မှတ်တမ်း မရှိသေးပါ။</p>
          )}
          {!historyBusy &&
            !historyError &&
            serverHistory.map((record) => (
              <button
                disabled={working}
                key={record.id}
                className="rounded-xl border p-3 text-left hover:border-blue-400"
                onClick={() => {
                  if (dirty) {
                    setPending(record);
                    setServerHistoryOpen(false);
                    return;
                  }
                  void openRecord(record.id);
                }}
              >
                <p className="text-sm font-semibold">
                  {record.snapshot.productName} · {record.productionNumber}
                </p>
                <p className="text-xs leading-7">
                  {record.status} · {record.outputBatch} ·{" "}
                  {record.actualOutputQuantity ?? "—"} {record.saleUnit} ·{" "}
                  {record.productionDate}
                </p>
              </button>
            ))}
          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setServerHistoryOpen(false);
                setHistory(true);
              }}
            >
              Browser မူကြမ်းဟောင်း
            </Button>
            <Button
              variant="outline"
              disabled={historyBusy || serverPage === 0}
              onClick={() => setServerPage((v) => v - 1)}
            >
              ရှေ့
            </Button>
            <span className="self-center text-xs">
              {serverPage + 1} / {Math.max(1, Math.ceil(serverTotal / 6))}
            </span>
            <Button
              variant="outline"
              disabled={historyBusy || (serverPage + 1) * 6 >= serverTotal}
              onClick={() => setServerPage((v) => v + 1)}
            >
              နောက်
            </Button>
            <Button
              variant="outline"
              onClick={() => setHistoryRevision((v) => v + 1)}
            >
              ပြန်တင်မည်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={history} onOpenChange={setHistory}>
        <DialogContent
          style={FONT}
          className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>Production မူကြမ်းမှတ်တမ်း</DialogTitle>
            <DialogDescription>
              ဤအကောင့်နှင့် ဆိုင်အတွက် ဒီ Browser တွင် သိမ်းထားသော မူကြမ်းများသာ
              ဖြစ်ပါသည်။
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {records.slice(hp * 6, hp * 6 + 6).map((d) => {
              const s = catalog.find(
                (s) => stockKey(s.balance) === d.sourceKey,
              );
              return (
                <button
                  type="button"
                  key={d.id}
                  className="w-full rounded-xl border p-3 text-left hover:border-blue-400"
                  onClick={() => {
                    if (!s) {
                      setErrors([
                        "မူကြမ်း၏ Warehouse source ကို မတွေ့ပါ။ လက်ကျန်ကို ပြန်တင်ပြီး စစ်ပါ။",
                      ]);
                      return;
                    }
                    choose(d);
                  }}
                >
                  <p className="text-sm font-semibold leading-7">
                    {s?.balance.name ?? "မူကြမ်း ပစ္စည်း"}
                  </p>
                  <p className="break-all text-xs leading-6">
                    {d.batch} · {d.packages} {s?.balance.packageUnit ?? "အထုပ်"}{" "}
                    · ရရှိမှု {d.actual || "—"}
                  </p>
                  <p className="text-[10px] leading-6 text-muted-foreground">
                    {new Date(d.updatedAt).toLocaleString()}
                  </p>
                </button>
              );
            })}
          </div>
          {!records.length && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              မူကြမ်းမရှိသေးပါ။
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={hp === 0}
              onClick={() => setHistoryPage((v) => v - 1)}
            >
              ရှေ့
            </Button>
            <Button
              variant="outline"
              disabled={(hp + 1) * 6 >= records.length}
              onClick={() => setHistoryPage((v) => v + 1)}
            >
              နောက်
            </Button>
            <Button variant="outline" onClick={() => setHistory(false)}>
              ပိတ်မည်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={action !== null}
        onOpenChange={(v) => {
          if (!v && !working) setAction(null);
        }}
      >
        <DialogContent style={FONT} className="rounded-2xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {action === "reset"
                ? "မူကြမ်းအသစ် စတင်မလား။"
                : action === "save"
                  ? "မူကြမ်းသိမ်းမလား။"
                  : "ထုတ်လုပ်မှု အတည်ပြုရန် စစ်ဆေးပါ"}
            </DialogTitle>
            <DialogDescription className="leading-7">
              {action === "reset"
                ? "လက်ရှိ မသိမ်းထားသော ပြင်ဆင်ချက်များ ဆုံးရှုံးပါမည်။"
                : action === "save"
                  ? "Server တွင် မူကြမ်းသိမ်းမည်။ ဂိုဒေါင် Stock မပြောင်းပါ။"
                  : "အတည်ပြုလျှင် Bulk Stock နုတ်ပြီး Finished Stock တိုးပါမည်။ အတည်ပြုပြီးသောမှတ်တမ်းကို ပြင်မရပါ။"}
            </DialogDescription>
          </DialogHeader>
          {action === "review" && (
            <div className="space-y-1 rounded-xl bg-muted/40 p-3 text-sm leading-7">
              <p>
                {b?.name} · {form?.batch}
              </p>
              <p>
                Bulk − {base(p?.used)} / Finished + {count(p?.actual)}{" "}
                {outUnit}
              </p>
              <p>
                ထုတ်ယူပြီး လက်ကျန် {base(p?.remaining)}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={working}
              onClick={() => setAction(null)}
            >
              မလုပ်တော့ပါ
            </Button>
            {action === "reset" ? (
              <Button
                onClick={() => {
                  setServerRecord(null);
                  setRecordSource(null);
                  setForm(null);
                  setBaseline("");
                  setBarcode("");
                  setErrors([]);
                  setNotice("");
                  setAction(null);
                  setSearch("");
                  setPicker(true);
                }}
              >
                အသစ်စမည်
              </Button>
            ) : (
              <Button
                onClick={() => saveDraft(action === "review")}
                disabled={working || !!operation || !journalReady}
              >
                {working
                  ? "လုပ်ဆောင်နေသည်…"
                  : action === "review"
                    ? "အတည်ပြုမည်"
                    : "မူကြမ်းအဖြစ်သိမ်းမည်"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pending}
        onOpenChange={(v) => {
          if (!v) setPending(null);
        }}
      >
        <DialogContent style={FONT} className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>မူကြမ်းပြောင်းဖွင့်မလား။</DialogTitle>
            <DialogDescription>
              မသိမ်းရသေးသော လက်ရှိပြင်ဆင်ချက်များ ဆုံးရှုံးပါမည်။
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              မလုပ်တော့ပါ
            </Button>
            <Button
              onClick={() => {
                if (pending) {
                  if ("productionNumber" in pending)
                    void openRecord(pending.id);
                  else adopt(pending);
                }
                setPending(null);
              }}
            >
              ဆက်လုပ်မည်
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
