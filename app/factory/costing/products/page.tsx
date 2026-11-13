"use client";

import { LoadingScreen } from "@/components/loading-screen";

import {
  CostingBarcode,
  CostingBarcodeSearch,
} from "@/components/factory/costing-barcode";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Ellipsis,
  ImageIcon,
  Package,
  ScanBarcode,
  RefreshCw,
  Search,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CostingProductDelete,
  CostingSheetDelete,
} from "@/components/factory/costing-product-delete";
import {
  costingRequest,
  decodeSheet,
  photoUrl,
  type CostingSheet,
  type CostingServerItem,
  type CostingList,
} from "@/lib/costing-api";

const PAGE_SIZE = 6;
const productTypes: Record<string, string> = {
  WEIGHT: "အလေးချိန်",
  BOTTLED_DRINK: "အချိုရည်ဘူး",
  PACKAGED_SNACK: "မုန့်ထုပ်",
  VOLUME: "အရည်ပမာဏ",
  COUNT: "အရေအတွက်",
};

function money(code: string, value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
      maximumFractionDigits: ["JPY", "MMK"].includes(code) ? 0 : 2,
    }).format(value);
  } catch {
    return `${code} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;
  }
}

function number(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)
    : "—";
}

function updatedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date) + " UTC"
  );
}

function saleUnit(item: CostingServerItem) {
  const type = item.inputs.productType;
  if (["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(String(type))) {
    return Number(item.inputs.packGrams) === 1
      ? String(item.inputs.unitName || "ခု")
      : "တွဲ";
  }
  return type === "VOLUME" ? "ဘူး" : "ထုပ်";
}

function ProductThumbnail({
  sheet,
  item,
}: {
  sheet: CostingSheet;
  item: CostingServerItem;
}) {
  const slot = item.packagedImage ? "PACKAGED" : "ORIGINAL";
  const src = photoUrl(sheet, item, slot);
  const [failed, setFailed] = React.useState("");
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
      {(item.packagedImage || item.originalImage) && failed !== src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(src)} />
      ) : (
        <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

function SheetProducts({
  sheet,
  deleting,
  acquire,
  release,
  reload,
}: {
  sheet: CostingSheet;
  deleting: boolean;
  acquire: () => boolean;
  release: () => void;
  reload: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const productsId = React.useId();
  const finalized = sheet.status === "FINALIZED";
  const items = [...sheet.items].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.id - b.id,
  );
  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground">
      <div className="flex items-start gap-1 px-3 py-2">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={productsId}
            onClick={() => setExpanded((open) => !open)}
            className="flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:flex-nowrap"
          >
            <ChevronDown className={`size-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words text-sm font-semibold">{sheet.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">ပစ္စည်း {number(items.length)} မျိုး</span>
            <span className={`shrink-0 rounded-md px-2 py-1 text-xs ${finalized ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>
              {finalized ? "အတည်ပြုပြီး" : "မူကြမ်း"}
            </span>
            <span className="w-full text-xs font-normal text-muted-foreground sm:w-auto">{updatedAt(sheet.updatedAt)}</span>
          </button>
        </h2>
        <details className="relative shrink-0">
          <summary aria-label="စာရင်းလုပ်ဆောင်ချက်များ" className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-muted [&::-webkit-details-marker]:hidden">
            <Ellipsis className="size-5" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-max max-w-[75vw] rounded-lg border border-border bg-card p-2 shadow-lg">
            <CostingSheetDelete sheet={sheet} disabled={deleting} onAcquire={acquire} onRelease={release} onReload={reload} onDeleted={reload} />
          </div>
        </details>
      </div>
      <div id={productsId} hidden={!expanded} className="border-t border-border">
        {expanded && (
          items.length ? (
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const ready = item.calculation.ready;
                const result = item.calculation.values;
                const unit = saleUnit(item);
                return (
                  <li key={item.id} className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(180px,1fr)_minmax(260px,1.2fr)_auto] xl:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumbnail sheet={sheet} item={item} />
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-medium">{String(item.inputs.product || "အမည်မဖြည့်ရသေးပါ")}</h3>
                        <p className="text-xs text-muted-foreground">{productTypes[String(item.inputs.productType)] || String(item.inputs.productType || "—")}</p>
                      </div>
                    </div>
                    {ready ? (
                      <dl className="grid min-w-0 grid-cols-3 gap-2 text-xs leading-6">
                        <div><dt className="text-muted-foreground">ထွက်ယူနစ်</dt><dd className="break-words tabular-nums">{number(result.saleUnits)} {unit}</dd></div>
                        <div><dt className="text-muted-foreground">တစ်ယူနစ် ကုန်ကျစရိတ်</dt><dd className="break-words tabular-nums">{money(sheet.currencyCode, result.costPerUnit)}</dd></div>
                        <div><dt className="text-muted-foreground">တစ်ယူနစ် ရောင်းဈေး</dt><dd className="break-words font-semibold tabular-nums">{money(sheet.currencyCode, result.price)}</dd></div>
                      </dl>
                    ) : (
                      <p className="text-xs text-muted-foreground">တွက်ချက်မှု မပြည့်စုံသေးပါ</p>
                    )}
                    <div className="flex flex-wrap items-start gap-2">
                      <Link href={`/factory/costing/products/${sheet.id}/${item.id}`} className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted">
                        အသေးစိတ် <ArrowRight className="ml-1 size-3.5" />
                      </Link>
                      {finalized && ready && (
                        <Link href={`/factory/receiving/raw?sheetId=${sheet.id}&itemId=${item.id}`} className="inline-flex min-h-10 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                          Raw Receiving
                        </Link>
                      )}
                      <details className="relative min-w-10">
                        <summary aria-label="ပစ္စည်းလုပ်ဆောင်ချက်များ" className="flex size-10 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-muted [&::-webkit-details-marker]:hidden">
                          <Ellipsis className="size-5" aria-hidden="true" />
                        </summary>
                        <div className="space-y-2 rounded-lg border border-border bg-card p-2 xl:absolute xl:right-0 xl:z-10 xl:mt-1 xl:w-64 xl:shadow-lg">
                          <CostingBarcode sheetId={sheet.id} itemId={item.id} />
                          <CostingProductDelete sheet={sheet} item={item} disabled={deleting} onAcquire={acquire} onRelease={release} onReload={reload} onDeleted={reload} />
                        </div>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">ဤစာရင်းတွင် ပစ္စည်း မရှိသေးပါ။</p>
          )
        )}
      </div>
    </section>
  );
}

export default function CostingProductsPage() {
  const [filters, setFilters] = React.useState({
    page: 0,
    search: "",
    status: "",
  });
  const [search, setSearch] = React.useState("");
  const [data, setData] = React.useState<CostingList | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState("");
  const [revision, setRevision] = React.useState(0);
  const sequence = React.useRef(0);
  const mutation = React.useRef(false);
  const [deleting, setDeleting] = React.useState(false);
  function acquire() {
    if (mutation.current || busy) return false;
    mutation.current = true;
    setDeleting(true);
    return true;
  }
  function release() {
    mutation.current = false;
    setDeleting(false);
  }
  function reload() {
    setRevision((value) => value + 1);
  }

  React.useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    setBusy(true);
    setError("");
    setData(null);
    const query = new URLSearchParams({
      page: String(filters.page),
      size: String(PAGE_SIZE),
      search: filters.search,
    });
    if (filters.status) query.set("status", filters.status);
    void costingRequest(`?${query}`, { signal: controller.signal })
      .then((value) => {
        if (current !== sequence.current) return;
        const result = value as CostingList;
        if (
          !result ||
          !Array.isArray(result.content) ||
          !Number.isSafeInteger(result.totalPages) ||
          result.totalPages < 0 ||
          !Number.isSafeInteger(result.totalElements) ||
          result.totalElements < 0 ||
          result.number !== filters.page
        ) {
          throw new Error("Server စာရင်း response မမှန်ပါ။ ပြန်စမ်းပါ။");
        }
        if (filters.page > 0 && filters.page >= result.totalPages) {
          setFilters((previous) => ({
            ...previous,
            page: Math.max(0, result.totalPages - 1),
          }));
          return;
        }
        setData({ ...result, content: result.content.map(decodeSheet) });
      })
      .catch((reason) => {
        if (current === sequence.current && !controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "စာရင်းရယူမရပါ။");
      })
      .finally(() => {
        if (current === sequence.current) setBusy(false);
      });
    return () => {
      sequence.current++;
      controller.abort();
    };
  }, [filters, revision]);

  return (
    <main className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 text-foreground sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold sm:text-2xl">Costing ကုန်ပစ္စည်းများ</h1>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            aria-label="စာရင်းပြန်တင်ရန်"
            disabled={busy || deleting}
            onClick={reload}
            className="size-11 p-0"
          >
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          </Button>
          <Link href="/factory/costing" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-muted">
            <ArrowLeft className="size-4" /> Costing သို့
          </Link>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 basis-96 flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (mutation.current) return;
            setFilters((previous) => ({
              ...previous,
              search: search.trim(),
              page: 0,
            }));
          }}
        >
          <div className="min-w-0 flex-1 basis-52">
            <label
              htmlFor="costing-sheet-search"
              className="sr-only"
            >
              Costing စာရင်းအမည်ဖြင့် ရှာရန်
            </label>
            <Input
              id="costing-sheet-search"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="စာရင်းအမည်ဖြင့် ရှာရန်"
              className="h-11"
            />
          </div>
          <div>
            <label
              htmlFor="costing-status"
              className="sr-only"
            >
              အခြေအနေ
            </label>
            <select
              disabled={deleting}
              id="costing-status"
              value={filters.status}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  status: event.target.value,
                  page: 0,
                }))
              }
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-40"
            >
              <option value="">အားလုံး</option>
              <option value="DRAFT">မူကြမ်း</option>
              <option value="FINALIZED">အတည်ပြုပြီး</option>
            </select>
          </div>
          <Button type="submit" disabled={deleting} className="h-11">
            <Search className="mr-2 size-4" />
            ရှာရန်
          </Button>
        </form>
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" className="h-11">
              <ScanBarcode className="size-4" /> Barcode ရှာရန်
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>Costing Barcode ရှာရန်</DialogTitle></DialogHeader>
            <CostingBarcodeSearch />
          </DialogContent>
        </Dialog>
      </div>
      {data && <p role="status" className="text-xs text-muted-foreground">စာရင်း {number(data.totalElements)} ခု</p>}
      <div aria-busy={busy} className="space-y-2">
        {busy ? (
          <div
            className="flex min-h-52 items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-sm text-muted-foreground"
          ><LoadingScreen variant="section" title="ပစ္စည်းစာရင်း ရယူနေပါသည်…" /></div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-1 size-5 shrink-0 text-destructive" />
              <p className="text-sm leading-7">{error}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => setRevision((value) => value + 1)}
            >
              ပြန်စမ်းရန်
            </Button>
          </div>
        ) : data?.content.length ? (
          data.content.map((sheet) => (
            <SheetProducts
              key={`${sheet.id}:${sheet.version}`}
              sheet={sheet}
              deleting={deleting}
              acquire={acquire}
              release={release}
              reload={reload}
            />
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center">
            <Package className="mx-auto mb-3 size-10 text-muted-foreground" />
            <h2 className="font-semibold">Costing စာရင်း မတွေ့ပါ</h2>
            <p className="mt-2 px-4 text-sm leading-7 text-muted-foreground">
              ရှာဖွေမှုကို ပြောင်းပါ သို့မဟုတ် Costing page တွင် စာရင်းကို
              Server သို့ သိမ်းပါ။
            </p>
          </div>
        )}
      </div>
      {data && data.totalPages > 0 && (
        <nav
          aria-label="Costing စာရင်း စာမျက်နှာများ"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"
        >
          <p role="status" className="text-xs leading-6 text-muted-foreground">
            စာမျက်နှာ {data.number + 1} / {data.totalPages} · တစ်မျက်နှာလျှင်
            costing စာရင်း {PAGE_SIZE} ခုအထိ
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || deleting || filters.page === 0}
              onClick={() =>
                setFilters((previous) => ({
                  ...previous,
                  page: previous.page - 1,
                }))
              }
            >
              <ArrowLeft className="mr-2 size-4" />
              ယခင်
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || deleting || filters.page + 1 >= data.totalPages}
              onClick={() =>
                setFilters((previous) => ({
                  ...previous,
                  page: previous.page + 1,
                }))
              }
            >
              နောက်
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </nav>
      )}
    </main>
  );
}
