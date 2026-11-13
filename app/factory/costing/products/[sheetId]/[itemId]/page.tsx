"use client";

import { LoadingScreen } from "@/components/loading-screen";
import { CostingBarcode } from "@/components/factory/costing-barcode";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Ellipsis,
  CheckCircle2,
  ClipboardList,
  Copy,
  Pencil,
  ImageIcon,
  Package,
  RefreshCw,
  AlertCircle,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CostingProductDelete } from "@/components/factory/costing-product-delete";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CostingApiError,
  sheetRequest,
  photoUrl,
  type CostingSheet,
  type CostingServerItem,
} from "@/lib/costing-api";

const types: Record<string, string> = {
  WEIGHT: "အလေးချိန်ဖြင့် တွက်ချက်သောပစ္စည်း",
  VOLUME: "အရည်ပမာဏဖြင့် တွက်ချက်သောပစ္စည်း",
  BOTTLED_DRINK: "အချိုရည်နှင့် ရေဘူး",
  PACKAGED_SNACK: "မုန့်နှင့် အသင့်ထုပ်ပစ္စည်း",
  COUNT: "အရေအတွက်ဖြင့် တွက်ချက်သောပစ္စည်း",
};

function numeric(value: unknown): number | null {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function quantity(value: unknown, unit = "") {
  const n = numeric(value);
  if (n == null) return "—";
  return (
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n) +
    (unit ? ` ${unit}` : "")
  );
}
function money(currency: string, value: unknown) {
  const n = numeric(value);
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      maximumFractionDigits: ["JPY", "MMK"].includes(currency) ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${quantity(n)}`;
  }
}
function dateTime(value: string) {
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
function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-border/60 py-3 last:border-0">
      <dt className="text-xs leading-7 text-muted-foreground sm:text-sm">
        {label}
      </dt>
      <dd className="break-words text-right text-xs font-medium leading-7 tabular-nums sm:text-sm">
        {children}
      </dd>
    </div>
  );
}
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0 rounded-2xl shadow-none">
      <CardHeader>
        <h2 className="text-base font-semibold leading-8 tracking-tight">{title}</h2>
        {description && (
          <CardDescription className="text-xs leading-7">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ProductPhoto({
  sheet,
  item,
  slot,
}: {
  sheet: CostingSheet;
  item: CostingServerItem;
  slot: "ORIGINAL" | "PACKAGED";
}) {
  const [open, setOpen] = React.useState(false);
  const [failed, setFailed] = React.useState("");
  const src = photoUrl(sheet, item, slot);
  const exists = slot === "ORIGINAL" ? item.originalImage : item.packagedImage;
  const label =
    slot === "ORIGINAL" ? "မူလဝယ်ယူသောအထုပ်ပုံ" : "ထုပ်ပိုးပြီးပစ္စည်းပုံ";
  const usable = exists && failed !== src;
  return (
    <div className="min-w-0">
      <Button
        type="button"
        variant="outline"
        className="relative h-24 w-full overflow-hidden rounded-xl p-1"
        disabled={!usable}
        onClick={() => setOpen(true)}
        aria-label={`${label} အကျယ်ကြည့်ရန်`}
      >
        {usable ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={label}
              className="h-full w-full object-contain"
              onError={() => setFailed(src)}
            />
            <span className="absolute bottom-1 right-1 rounded bg-background/90 p-1">
              <ZoomIn className="size-3" />
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageIcon className="size-5" />
            <span className="text-[10px] leading-5">
              {exists ? "ပုံဖွင့်မရပါ" : "ပုံမရှိသေးပါ"}
            </span>
          </span>
        )}
      </Button>
      <p className="mt-2 max-w-36 text-xs leading-6 text-muted-foreground">
        {label}
      </p>
      <Dialog open={open && usable} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base leading-8">{label}</DialogTitle>
            <DialogDescription className="leading-7">
              {String(item.inputs.product || "ကုန်ပစ္စည်း")}
            </DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={label}
            className="max-h-[65dvh] w-full rounded-xl bg-muted/40 object-contain"
            onError={() => setFailed(src)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductContent({
  sheet,
  item,
  reloading,
  onRefresh,
}: {
  sheet: CostingSheet;
  item: CostingServerItem;
  reloading: boolean;
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = React.useState(false);
  const [copyState, setCopyState] = React.useState<
    "idle" | "copied" | "failed"
  >("idle");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const i = item.inputs;
  const ready = item.calculation.ready;
  const v = item.calculation.values;
  const count = ["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(
    String(i.productType),
  );
  const largeUnit = count
    ? String(i.unitName || "ခု")
    : i.productType === "VOLUME"
      ? "L"
      : "kg";
  const smallUnit = count
    ? String(i.unitName || "ခု")
    : i.productType === "VOLUME"
      ? "ml"
      : "g";
  const saleUnit = count
    ? Number(i.packGrams) === 1
      ? String(i.unitName || "ခု")
      : "တွဲ"
    : i.productType === "VOLUME"
      ? "ဘူး"
      : "ထုပ်";
  const price = (key: string) =>
    ready ? money(sheet.currencyCode, v[key]) : "—";
  const measured = (key: string, unit: string) =>
    ready ? quantity(v[key], unit) : "—";
  const finalized = sheet.status === "FINALIZED";
  const discounted = (numeric(i.discount) ?? 0) > 0;
  const summary = [
    { label: `တစ်${saleUnit} ကုန်ကျစရိတ်`, value: price("costPerUnit") },
    {
      label: discounted ? `လျှော့ပြီး တစ်${saleUnit} ရောင်းဈေး` : `တစ်${saleUnit} ရောင်းဈေး`,
      value: price(discounted ? "discountedPrice" : "price"),
    },
    {
      label: "ခန့်မှန်းထွက်ယူနစ်",
      value: measured("saleUnits", saleUnit),
    },
    {
      label: discounted ? "လျှော့ပြီး ခန့်မှန်းအမြတ်" : "ခန့်မှန်းအမြတ်",
      value: price(discounted ? "discountedProfit" : "profit"),
    },
  ];
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("idle"), 2000);
  }
  return (
    <>
      <header className="space-y-4">
        <Link
          href="/factory/costing/products"
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          ကုန်ပစ္စည်းစာရင်းသို့
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs leading-7 text-muted-foreground">
              {sheet.title}
            </p>
            <h1 className="break-words text-xl font-semibold leading-10 sm:text-2xl">
              {String(i.product || "အမည်မဖြည့်ရသေးပါ")}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge
                variant={finalized ? "default" : "secondary"}
                className="h-auto whitespace-normal py-1 leading-6"
              >
                {finalized ? <CheckCircle2 /> : <ClipboardList />}
                {finalized ? "အတည်ပြုပြီး" : "မူကြမ်း"}
              </Badge>
              <Badge
                variant="outline"
                className="h-auto whitespace-normal py-1 leading-6"
              >
                {types[String(i.productType)] || String(i.productType || "—")}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/factory/costing/products/${sheet.id}/${item.id}/edit`}
              aria-disabled={deleting}
              tabIndex={deleting ? -1 : undefined}
              onClick={(event) => {
                if (deleting) event.preventDefault();
              }}
              className="inline-flex h-auto min-h-11 items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-xs font-medium leading-6 text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-50"
            >
              <Pencil className="mr-2 size-4" />
              {finalized ? "မိတ္တူဖြင့် ပြင်ဆင်ရန်" : "ပစ္စည်းပြင်ဆင်ရန်"}
            </Link>
            {finalized && ready && (
              <Link
                href={`/factory/receiving/raw?sheetId=${sheet.id}&itemId=${item.id}`}
                aria-disabled={deleting}
                tabIndex={deleting ? -1 : undefined}
                onClick={(event) => { if (deleting) event.preventDefault(); }}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted aria-disabled:opacity-50"
              >
                <Package className="size-4" /> Raw Receiving
              </Link>
            )}
            <details className="relative">
              <summary aria-label="အခြားလုပ်ဆောင်ချက်များ" className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md border border-border hover:bg-muted [&::-webkit-details-marker]:hidden">
                <Ellipsis className="size-5" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 z-20 mt-2 grid w-max max-w-[75vw] gap-2 rounded-xl border border-border bg-card p-2 shadow-lg">
                <Button
                  type="button"
                  variant="outline"
                  disabled={reloading || deleting}
                  onClick={onRefresh}
                  className="h-auto min-h-11 py-2 text-xs leading-6"
                >
                  <RefreshCw
                    className={`mr-2 size-4 ${reloading ? "animate-spin" : ""}`}
                  />
                  ပြန်တင်ရန်
                </Button>
                <CostingProductDelete
                  sheet={sheet}
                  item={item}
                  disabled={reloading}
                  onBusyChange={setDeleting}
                  onReload={onRefresh}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={deleting}
                  onClick={() => void copyLink()}
                  className="h-auto min-h-11 py-2 text-xs leading-6"
                >
                  <Copy className="mr-2 size-4" />
                  {copyState === "copied" ? "လင့်ခ်ကူးပြီး" : "လင့်ခ်ကူးရန်"}
                </Button>
              </div>
            </details>
          </div>
        </div>
        <p
          role="status"
          className={
            copyState === "failed" ? "text-xs text-destructive" : "sr-only"
          }
        >
          {copyState === "failed"
            ? "လင့်ခ်ကူးမရပါ။ Browser address bar မှ ကူးယူပါ။"
            : copyState === "copied"
              ? "လင့်ခ်ကူးယူပြီးပါပြီ။"
              : ""}
        </p>
      </header>
      {!ready && (
        <Card className="rounded-2xl border-amber-300 bg-amber-50 shadow-none dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="pt-0 text-sm leading-7 text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-1 size-5 shrink-0" />
              <div>
                <h2 className="font-semibold">တွက်ချက်မှု မပြည့်စုံသေးပါ</h2>
                <ul className="mt-2 list-disc pl-5">
                  {(item.calculation.errors.length
                    ? item.calculation.errors
                    : ["ဖြည့်စွက်ရန် လိုအပ်သော အချက်အလက်ရှိပါသည်။"]
                  ).map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {ready && (
        <dl aria-label="တွက်ချက်မှုအနှစ်ချုပ်" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          {summary.map((stat, index) => (
            <div key={stat.label} className="min-w-0 bg-card px-4 py-3">
              <dt className="text-xs leading-6 text-muted-foreground">{stat.label}</dt>
              <dd className={`mt-1 break-words text-lg font-semibold tabular-nums ${index === 1 ? "text-blue-600 dark:text-blue-400" : ""}`}>
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="grid min-w-0 items-start gap-4 @min-[960px]/costing-detail:grid-cols-[minmax(0,1fr)_280px]">
        <Tabs defaultValue="overview" className="w-full min-w-0">
          <TabsList className="mb-4 grid h-auto w-full grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-4">
            <TabsTrigger
              value="overview"
              className="h-auto min-h-11 whitespace-normal px-2 py-2 text-xs leading-6"
            >
              အနှစ်ချုပ်
            </TabsTrigger>
            <TabsTrigger
              value="inputs"
              className="h-auto min-h-11 whitespace-normal px-2 py-2 text-xs leading-6"
            >
              မူလအချက်အလက်
            </TabsTrigger>
            <TabsTrigger
              value="costs"
              className="h-auto min-h-11 whitespace-normal px-2 py-2 text-xs leading-6"
            >
              ကုန်ကျစရိတ်
            </TabsTrigger>
            <TabsTrigger
              value="pricing"
              className="h-auto min-h-11 whitespace-normal px-2 py-2 text-xs leading-6"
            >
              ရောင်းဈေးနှင့် အမြတ်
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Section
                title="ထုတ်ယူနစ်တွက်ချက်မှု"
                description="Backend တွက်ချက်မှုတွင် kg/L ကို g/ml သို့ ပြောင်းထားသော တန်ဖိုးများဖြစ်ပါသည်။"
              >
                <dl>
                  <DetailRow label="မူလဝယ်ယူပမာဏ">
                    {measured("purchasedQuantity", smallUnit)}
                  </DetailRow>
                  <DetailRow label="အသုံးပြုနိုင်သောပမာဏ">
                    {measured("usableQuantity", smallUnit)}
                  </DetailRow>
                  <DetailRow label={`တစ်${saleUnit} ပါဝင်ပမာဏ`}>
                    {quantity(i.packGrams, smallUnit)}
                  </DetailRow>
                  <DetailRow label="အပြည့်ထုပ်ပိုးနိုင်သော ယူနစ်">
                    {measured("saleUnits", saleUnit)}
                  </DetailRow>
                  <DetailRow label="မထုပ်ရသေးသော လက်ကျန်ပမာဏ">
                    {measured("remainder", smallUnit)}
                  </DetailRow>
                  <DetailRow label="လက်ကျန်ပစ္စည်းတန်ဖိုး">
                    {price("remainderMaterialCost")}
                  </DetailRow>
                </dl>
              </Section>
              <Section
                title="မျှော်မှန်းရောင်းချမှု"
                description="တွက်ချက်ထားသော ရောင်းယူနစ်အားလုံးကို ရောင်းချနိုင်မည်ဟု ယူဆထားပါသည်။"
              >
                <dl>
                  <DetailRow label="ရောင်းယူနစ်များ ကုန်ကျစရိတ်">
                    {price("packedCost")}
                  </DetailRow>
                  <DetailRow label="မျှော်မှန်းရောင်းရငွေ">
                    {price("revenue")}
                  </DetailRow>
                  <DetailRow label="မျှော်မှန်းအမြတ်">
                    {price("profit")}
                  </DetailRow>
                  <DetailRow label="Discount ပြီး ရောင်းရငွေ">
                    {price("discountedRevenue")}
                  </DetailRow>
                  <DetailRow label="Discount ပြီး အမြတ်">
                    {price("discountedProfit")}
                  </DetailRow>
                  <DetailRow label="Discount ပြီး Margin">
                    {ready ? quantity(v.discountedMargin, "%") : "—"}
                  </DetailRow>
                </dl>
              </Section>
            </div>
          </TabsContent>
          <TabsContent value="inputs">
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="ဝယ်ယူမှုနှင့် ပမာဏ">
                <dl>
                  <DetailRow label="ပစ္စည်းအမည်">
                    {String(i.product || "—")}
                  </DetailRow>
                  <DetailRow label="အမျိုးအစား">
                    {types[String(i.productType)] || String(i.productType || "—")}
                  </DetailRow>
                  <DetailRow
                    label={`${String(i.containerName || "အထုပ်")} အရေအတွက်`}
                  >
                    {quantity(i.containers)}
                  </DetailRow>
                  {count ? (
                    <DetailRow
                      label={`တစ်${String(i.containerName || "အထုပ်")} ပါဝင်အရေအတွက်`}
                    >
                      {quantity(i.unitsPerContainer, String(i.unitName || "ခု"))}
                    </DetailRow>
                  ) : (
                    <DetailRow label="မူလဝယ်ယူပမာဏ">
                      {quantity(i.weightKg, largeUnit)}
                    </DetailRow>
                  )}
                  <DetailRow label="အလျော့ပမာဏ">
                    {quantity(i.lossKg, largeUnit)}
                  </DetailRow>
                  <DetailRow label={`တစ်${saleUnit} ပါဝင်ပမာဏ`}>
                    {quantity(i.packGrams, smallUnit)}
                  </DetailRow>
                </dl>
              </Section>
              <Section title="ဖြည့်သွင်းထားသော ကုန်ကျစရိတ်">
                <dl>
                  <DetailRow label="ဝယ်ဈေးသတ်မှတ်ပုံ">
                    {i.purchasePriceMode === "container"
                      ? `တစ်${String(i.containerName || "အထုပ်")} ဝယ်ဈေး`
                      : i.purchasePriceMode === "total"
                        ? "စုစုပေါင်းဝယ်ဈေး"
                        : "—"}
                  </DetailRow>
                  <DetailRow label="ဖြည့်သွင်းထားသော ဝယ်ဈေး">
                    {money(sheet.currencyCode, i.purchase)}
                  </DetailRow>
                  <DetailRow label="ပြင်ဆင်စရိတ် စုစုပေါင်း">
                    {money(sheet.currencyCode, i.processing)}
                  </DetailRow>
                  <DetailRow label={`တစ်${saleUnit} ထုပ်ပိုးစရိတ်`}>
                    {money(sheet.currencyCode, i.packaging)}
                  </DetailRow>
                  <DetailRow label="သတ်မှတ်ထားသော ရောင်းဈေး">
                    {money(sheet.currencyCode, i.sellingPrice)}
                  </DetailRow>
                  <DetailRow label="လျှော့ဈေးရာခိုင်နှုန်း">
                    {quantity(i.discount, "%")}
                  </DetailRow>
                </dl>
              </Section>
            </div>
          </TabsContent>
          <TabsContent value="costs">
            <Section
              title="ကုန်ကျစရိတ် ခွဲခြမ်းကြည့်ရန်"
              description="မထုပ်ရသေးသော လက်ကျန်တန်ဖိုးကို ရောင်းယူနစ်ကုန်ကျစရိတ်ထဲမှ သီးခြား ခွဲထားပါသည်။"
            >
              <dl>
                <DetailRow label="မူလဝယ်ဈေး စုစုပေါင်း">
                  {price("purchaseTotal")}
                </DetailRow>
                <DetailRow label="ပြင်ဆင်စရိတ်">
                  {money(sheet.currencyCode, i.processing)}
                </DetailRow>
                <DetailRow label="ကုန်ကြမ်းနှင့် ပြင်ဆင်စရိတ်">
                  {price("materialCost")}
                </DetailRow>
                <DetailRow label="ထုပ်ပိုးပြီး ကုန်ကြမ်းတန်ဖိုး">
                  {price("packedMaterialCost")}
                </DetailRow>
                <DetailRow label="မထုပ်ရသေးသော လက်ကျန်တန်ဖိုး">
                  {price("remainderMaterialCost")}
                </DetailRow>
                <DetailRow label="ထုပ်ပိုးစရိတ် စုစုပေါင်း">
                  {price("packagingCost")}
                </DetailRow>
                <DetailRow label="ရောင်းယူနစ်များ ကုန်ကျစရိတ်">
                  {price("packedCost")}
                </DetailRow>
                <DetailRow label={`တစ်${saleUnit} ကုန်ကျစရိတ်`}>
                  {price("costPerUnit")}
                </DetailRow>
              </dl>
            </Section>
          </TabsContent>
          <TabsContent value="pricing">
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="ဈေးသတ်မှတ်ပုံ">
                <dl>
                  <DetailRow label="ဈေးတွက်ချက်ပုံ">
                    {i.mode === "price"
                      ? "ရောင်းဈေးကို ကိုယ်တိုင်သတ်မှတ်"
                      : i.mode === "margin"
                        ? "အမြတ်အလိုက် ဈေးတွက်ချက်"
                        : "—"}
                  </DetailRow>
                  {i.mode === "margin" && (
                    <>
                      <DetailRow label="အမြတ်တွက်ချက်ပုံ">
                        {i.basis === "markup"
                          ? "ကုန်ကျစရိတ်ပေါ် အမြတ်တင် (Markup)"
                          : i.basis === "margin"
                            ? "ရောင်းဈေးပေါ် အမြတ် (Margin)"
                            : "—"}
                      </DetailRow>
                      <DetailRow label="ရည်မှန်းအမြတ်ရာခိုင်နှုန်း">
                        {quantity(i.targetPercent, "%")}
                      </DetailRow>
                      <DetailRow label="ဈေးလုံးတင်ရန် ပမာဏ">
                        {money(sheet.currencyCode, i.rounding)}
                      </DetailRow>
                    </>
                  )}
                  <DetailRow label="အနည်းဆုံး Margin">
                    {quantity(i.minimumMargin, "%")}
                  </DetailRow>
                  <DetailRow label="လျှော့ဈေးရာခိုင်နှုန်း">
                    {quantity(i.discount, "%")}
                  </DetailRow>
                  <DetailRow label={`တစ်${saleUnit} ရောင်းဈေး`}>
                    {price("price")}
                  </DetailRow>
                  <DetailRow label="လျှော့ဈေးပြီး ရောင်းဈေး">
                    {price("discountedPrice")}
                  </DetailRow>
                </dl>
              </Section>
              <Section title="အမြတ်နှင့် အနည်းဆုံးရောင်းဈေး">
                <dl>
                  <DetailRow label={`တစ်${saleUnit} အမြတ်`}>
                    {price("profitPerUnit")}
                  </DetailRow>
                  <DetailRow label={`Discount ပြီး တစ်${saleUnit} အမြတ်`}>
                    {price("discountedProfitPerUnit")}
                  </DetailRow>
                  <DetailRow label="အမြတ်ရာခိုင်နှုန်း (Margin)">
                    {ready ? quantity(v.margin, "%") : "—"}
                  </DetailRow>
                  <DetailRow label="Discount ပြီး Margin">
                    {ready ? quantity(v.discountedMargin, "%") : "—"}
                  </DetailRow>
                  <DetailRow label="အနည်းဆုံး Margin ရရန် ရောင်းဈေး">
                    {price("minimumPrice")}
                  </DetailRow>
                  <DetailRow label="Discount ပါလျှင် အနည်းဆုံးသတ်မှတ်ဈေး">
                    {price("minimumListPrice")}
                  </DetailRow>
                </dl>
              </Section>
            </div>
          </TabsContent>
        </Tabs>
        <aside className="min-w-0 space-y-3">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">ပစ္စည်းပုံများ</h2>
            <div className="grid max-w-sm grid-cols-2 gap-3">
              <ProductPhoto sheet={sheet} item={item} slot="ORIGINAL" />
              <ProductPhoto sheet={sheet} item={item} slot="PACKAGED" />
            </div>
          </section>
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">Costing Barcode</summary>
            <div className="mt-3">
              <CostingBarcode sheetId={sheet.id} itemId={item.id} />
            </div>
          </details>
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">စာရင်းအချက်အလက်</summary>
            <dl className="mt-2 text-xs leading-7">
              <DetailRow label="စာရင်း / ပစ္စည်း">#{sheet.id} / #{item.id}</DetailRow>
              <DetailRow label="ငွေကြေး">{sheet.currencyCode}</DetailRow>
              <DetailRow label="နောက်ဆုံးပြင်ဆင်ချိန်">{dateTime(sheet.updatedAt)}</DetailRow>
              <DetailRow label="စာရင်း Version">{sheet.version}</DetailRow>
              <DetailRow label="တွက်ချက်မှု Version">{sheet.calculationVersion}</DetailRow>
            </dl>
          </details>
        </aside>
      </div>
    </>
  );
}

export default function CostingProductDetailPage() {
  const params = useParams<{ sheetId: string; itemId: string }>();
  const sheetId = params?.sheetId;
  const itemId = params?.itemId;
  const [sheet, setSheet] = React.useState<CostingSheet | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(true);
  const [revision, setRevision] = React.useState(0);
  const sequence = React.useRef(0);
  React.useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    setBusy(true);
    setError("");
    setSheet(null);
    if (!validId(sheetId) || !validId(itemId)) {
      setError("ပစ္စည်းလင့်ခ် မမှန်ပါ။ စာရင်းမှ ပြန်ရွေးပါ။");
      setBusy(false);
      return () => {
        sequence.current++;
        controller.abort();
      };
    }
    void sheetRequest(`/${sheetId}`, { signal: controller.signal })
      .then((result) => {
        if (current !== sequence.current) return;
        if (
          result.id !== Number(sheetId) ||
          !result.items.some((item) => item.id === Number(itemId))
        )
          throw new Error(
            "ဤစာရင်းတွင် ပစ္စည်းမတွေ့ပါ။ ဖျက်ထားခြင်း သို့မဟုတ် ပြောင်းလဲထားခြင်း ဖြစ်နိုင်ပါသည်။",
          );
        setSheet(result);
      })
      .catch((reason) => {
        if (controller.signal.aborted || current !== sequence.current) return;
        setError(
          reason instanceof CostingApiError && reason.status === 404
            ? "စာရင်းမတွေ့ပါ သို့မဟုတ် အသုံးပြုခွင့်မရှိပါ။"
            : reason instanceof Error
              ? reason.message
              : "ပစ္စည်းအချက်အလက် ရယူမရပါ။",
        );
      })
      .finally(() => {
        if (current === sequence.current) setBusy(false);
      });
    return () => {
      sequence.current++;
      controller.abort();
    };
  }, [sheetId, itemId, revision]);
  const item = sheet?.items.find((value) => value.id === Number(itemId));
  return (
    <main
      className="@container/costing-detail mx-auto w-full min-w-0 max-w-screen-2xl space-y-4 p-4 text-foreground sm:p-6"
      aria-busy={busy}
    >
      {busy ? (
        <Card className="rounded-2xl shadow-none">
          <CardContent className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
            <LoadingScreen variant="section" title="ပစ္စည်းအချက်အလက် ရယူနေပါသည်…" />
          </CardContent>
        </Card>
      ) : error || !sheet || !item ? (
        <Card className="rounded-2xl shadow-none">
          <CardContent className="space-y-4">
            <Package className="size-8 text-muted-foreground" />
            <h1 className="text-lg font-semibold leading-8">
              အသေးစိတ် ဖွင့်မရပါ
            </h1>
            <p role="alert" className="text-sm leading-7 text-muted-foreground">
              {error || "ပစ္စည်းမတွေ့ပါ။"}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                ပြန်စမ်းရန်
              </Button>
              <Link
                href="/factory/costing/products"
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                စာရင်းသို့ပြန်ရန်
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ProductContent
          key={`${sheet.id}:${item.id}:${sheet.version}`}
          sheet={sheet}
          item={item}
          reloading={busy}
          onRefresh={() => setRevision((value) => value + 1)}
        />
      )}
    </main>
  );
}
