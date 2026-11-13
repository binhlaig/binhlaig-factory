"use client";

import { LoadingScreen } from "@/components/loading-screen";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Save,
  Loader2,
  Upload,
  ImageIcon,
  X,
  Copy,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  CostingApiError,
  sheetRequest,
  savePayload,
  numericFields,
  textFields,
  photoUrl,
  type CostingSheet,
  type CostingServerItem,
} from "@/lib/costing-api";

const schema = z
  .object({
    product: z.string().trim().min(1, "ပစ္စည်းအမည် ဖြည့်ပါ။").max(200),
    productType: z.enum(["WEIGHT", "BOTTLED_DRINK", "PACKAGED_SNACK", "VOLUME", "COUNT"]),
    containerName: z.string().max(200),
    unitName: z.string().max(200),
    purchasePriceMode: z.enum(["total", "container"]),
    mode: z.enum(["price", "margin"]),
    basis: z.enum(["margin", "markup"]),
    containers: z.string(),
    unitsPerContainer: z.string(),
    weightKg: z.string(),
    purchase: z.string(),
    processing: z.string(),
    lossKg: z.string(),
    packGrams: z.string(),
    packaging: z.string(),
    sellingPrice: z.string(),
    targetPercent: z.string(),
    minimumMargin: z.string(),
    discount: z.string(),
    rounding: z.string(),
  })
  .superRefine((values, context) => {
    const count = ["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(
      values.productType,
    );
    for (const key of numericFields) {
      const raw = values[key].trim();
      if (!raw) continue; // Drafts may contain incomplete numerical inputs.
      const n = Number(raw);
      if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || !Number.isFinite(n) || n > 1e12) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "0 မှ 1,000,000,000,000 အတွင်း၊ ဒဿမ ၆ နေရာအထိ ဖြည့်ပါ။",
        });
        continue;
      }
      if (
        ["containers", "unitsPerContainer", "packGrams"].includes(key) &&
        (n <= 0 || !Number.isInteger(n))
      )
        context.addIssue({
          code: "custom",
          path: [key],
          message: "0 ထက်ကြီးသော အပြည့်ကိန်း ဖြည့်ပါ။",
        });
      if (key === "weightKg" && (n <= 0 || (raw.split(".")[1]?.length || 0) > 3))
        context.addIssue({
          code: "custom",
          path: [key],
          message: "0 ထက်ကြီးပြီး ဒဿမ ၃ နေရာအထိ ဖြည့်ပါ။",
        });
      if (
        key === "lossKg" &&
        (count ? !Number.isInteger(n) : (raw.split(".")[1]?.length || 0) > 3)
      )
        context.addIssue({
          code: "custom",
          path: [key],
          message: count
            ? "အလျော့အရေအတွက်ကို အပြည့်ကိန်း ဖြည့်ပါ။"
            : "အလျော့ပမာဏကို ဒဿမ ၃ နေရာအထိ ဖြည့်ပါ။",
        });
      if (
        (["discount", "minimumMargin"].includes(key) ||
          (key === "targetPercent" && values.basis === "margin")) &&
        n >= 100
      )
        context.addIssue({ code: "custom", path: [key], message: "100% ထက်နည်းရပါမည်။" });
    }
    if (
      values.mode === "margin" &&
      values.rounding.trim() &&
      Number(values.rounding) <= 0
    )
      context.addIssue({
        code: "custom",
        path: ["rounding"],
        message: "ဈေးလုံးတင်ယူနစ်သည် 0 ထက်ကြီးရပါမည်။",
      });
    const purchased = count
      ? values.containers.trim() && values.unitsPerContainer.trim()
        ? Number(values.containers) * Number(values.unitsPerContainer)
        : null
      : values.weightKg.trim()
        ? Number(values.weightKg)
        : null;
    if (purchased !== null && values.lossKg.trim() && Number(values.lossKg) >= purchased)
      context.addIssue({
        code: "custom",
        path: ["lossKg"],
        message: "အလျော့သည် ဝယ်ယူပမာဏထက် နည်းရပါမည်။",
      });
  });
type Values = z.infer<typeof schema>;
const fieldLabels: Record<keyof Values, string> = {
  product: "ပစ္စည်းအမည်",
  productType: "ပစ္စည်းအမျိုးအစား",
  containerName: "မူလအထုပ်အမည်",
  unitName: "ယူနစ်အမည်",
  purchasePriceMode: "ဝယ်ဈေးသတ်မှတ်ပုံ",
  mode: "ဈေးတွက်ချက်ပုံ",
  basis: "အမြတ်တွက်ချက်ပုံ",
  containers: "မူလအထုပ်အရေအတွက်",
  unitsPerContainer: "အထုပ်တစ်ခု ပါဝင်အရေအတွက်",
  weightKg: "ဝယ်ယူပမာဏ",
  purchase: "ဝယ်ဈေး",
  processing: "ပြင်ဆင်စရိတ်",
  lossKg: "အလျော့ပမာဏ",
  packGrams: "တစ်ယူနစ် ပါဝင်ပမာဏ",
  packaging: "ထုပ်ပိုးစရိတ်",
  sellingPrice: "ရောင်းဈေး",
  targetPercent: "ရည်မှန်းအမြတ်",
  minimumMargin: "အနည်းဆုံး Margin",
  discount: "လျှော့ဈေး",
  rounding: "ဈေးလုံးတင်ယူနစ်",
};
type Slot = "ORIGINAL" | "PACKAGED";
type PhotoChange =
  { kind: "keep" } | { kind: "remove" } | { kind: "replace"; file: File };
const KEEP: PhotoChange = { kind: "keep" };

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}
function valuesFor(item: CostingServerItem): Values {
  const values = Object.fromEntries(
    [...textFields, ...numericFields].map((key) => [
      key,
      item.inputs[key] == null ? "" : String(item.inputs[key]),
    ]),
  ) as Values;
  return {
    ...values,
    productType: values.productType || "WEIGHT",
    purchasePriceMode: values.purchasePriceMode || "total",
    mode: values.mode || "price",
    basis: values.basis || "margin",
  };
}
function money(currency: string, value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      maximumFractionDigits: ["JPY", "MMK"].includes(currency) ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

// Browser preview mirrors the costing calculator's formulas. The server response
// remains authoritative after saving; Number arithmetic may differ at tiny decimals.
function calculatePreview(input: Values): CostingServerItem["calculation"] {
  const invalid = (errors: string[]) => ({ ready: false, errors, values: {} });
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return invalid(
      parsed.error.issues.map(
        (issue) =>
          `${fieldLabels[issue.path[0] as keyof Values] || "အချက်အလက်"}: ${issue.message}`,
      ),
    );
  const i = parsed.data;
  const count = ["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(i.productType);
  const required: (typeof numericFields)[number][] = [
    "purchase",
    "processing",
    "lossKg",
    "packGrams",
    "packaging",
    "discount",
    "minimumMargin",
  ];
  if (count) required.push("containers", "unitsPerContainer");
  else required.push("weightKg");
  if (i.purchasePriceMode === "container" && !required.includes("containers"))
    required.push("containers");
  if (i.mode === "price") required.push("sellingPrice");
  else required.push("targetPercent", "rounding");
  const missing = required.filter((key) => !i[key].trim());
  if (missing.length)
    return invalid(missing.map((key) => `${fieldLabels[key]} ဖြည့်ပါ။`));
  const n = Object.fromEntries(
    numericFields.map((key) => [key, i[key].trim() ? Number(i[key]) : 0]),
  ) as Record<(typeof numericFields)[number], number>;
  const purchased = count
    ? n.containers * n.unitsPerContainer
    : Math.round(n.weightKg * 1000);
  const usable = purchased - (count ? n.lossKg : Math.round(n.lossKg * 1000));
  if (!Number.isSafeInteger(purchased) || !Number.isSafeInteger(usable))
    return invalid([
      "ပမာဏ ကြီးလွန်း၍ browser မှာ တိကျစွာမတွက်နိုင်ပါ။ သိမ်းပြီး Server ရလဒ်ကို စစ်ပါ။",
    ]);
  const units = Math.floor(usable / n.packGrams);
  if (units <= 0)
    return invalid([
      "ရောင်းယူနစ်တစ်ခု ပြည့်အောင် မထုပ်ပိုးနိုင်ပါ။ ပမာဏနှင့် အလျော့ကို စစ်ပါ။",
    ]);
  const remainder = usable - units * n.packGrams;
  const purchase =
    i.purchasePriceMode === "container" ? n.purchase * n.containers : n.purchase;
  const material = purchase + n.processing;
  const packedMaterial = material * ((usable - remainder) / usable);
  const packaging = units * n.packaging;
  const cost = packedMaterial + packaging;
  const cpu = cost / units;
  const roundUp = (value: number) => {
    if (!n.rounding) return value;
    const ratio = value / n.rounding;
    const nearest = Math.round(ratio);
    const normalized =
      Math.abs(ratio - nearest) <= Number.EPSILON * Math.max(1, Math.abs(ratio)) * 8
        ? nearest
        : ratio;
    return Math.ceil(normalized) * n.rounding;
  };
  const selling =
    i.mode === "price"
      ? n.sellingPrice
      : roundUp(
          i.basis === "margin"
            ? cpu / (1 - n.targetPercent / 100)
            : cpu * (1 + n.targetPercent / 100),
        );
  const discounted = selling * (1 - n.discount / 100);
  const minimum = cpu / (1 - n.minimumMargin / 100);
  const revenue = selling * units,
    discountedRevenue = discounted * units;
  const values: Record<string, number | null> = {
    purchasedQuantity: purchased,
    usableQuantity: usable,
    saleUnits: units,
    remainder,
    purchaseTotal: purchase,
    materialCost: material,
    packedMaterialCost: packedMaterial,
    remainderMaterialCost: material - packedMaterial,
    packagingCost: packaging,
    packedCost: cost,
    costPerUnit: cpu,
    price: selling,
    discountedPrice: discounted,
    revenue,
    profit: revenue - cost,
    profitPerUnit: selling - cpu,
    margin: revenue === 0 ? null : ((revenue - cost) / revenue) * 100,
    discountedRevenue,
    discountedProfit: discountedRevenue - cost,
    discountedProfitPerUnit: discounted - cpu,
    discountedMargin:
      discountedRevenue === 0
        ? null
        : ((discountedRevenue - cost) / discountedRevenue) * 100,
    minimumPrice: minimum,
    minimumListPrice: minimum / (1 - n.discount / 100),
  };
  for (const margin of [15, 20, 25])
    values[`margin${margin}Price`] = roundUp(cpu / (1 - margin / 100));
  if (Object.values(values).some((value) => value !== null && !Number.isFinite(value)))
    return invalid(["ကိန်းဂဏန်းများကို စစ်ပါ။ ရလဒ်ကို တွက်ချက်မရပါ။"]);
  return { ready: true, errors: [], values };
}

function Field({
  form,
  name,
  label,
  children,
  numeric = false,
  description,
}: {
  form: UseFormReturn<Values>;
  name: keyof Values;
  label: string;
  children?: React.ReactNode;
  numeric?: boolean;
  description?: string;
}) {
  const id = React.useId();
  const error = form.formState.errors[name];
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id} className="text-xs leading-7">
        {label}
      </Label>
      {children ? (
        React.isValidElement(children) ? (
          React.cloneElement(
            children as React.ReactElement<React.ComponentProps<"select">>,
            {
              id,
              "aria-invalid": !!error,
              "aria-describedby": error
                ? `${id}-error`
                : description
                  ? `${id}-description`
                  : undefined,
              ...form.register(name),
            },
          )
        ) : (
          children
        )
      ) : (
        <Input
          id={id}
          {...form.register(name)}
          type="text"
          inputMode={numeric ? "decimal" : "text"}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${id}-error` : description ? `${id}-description` : undefined
          }
          className="h-11 text-sm"
        />
      )}
      {description && (
        <p id={`${id}-description`} className="text-xs leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs leading-6 text-destructive">
          {String(error.message || "အချက်အလက်ကို စစ်ပါ။")}
        </p>
      )}
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl shadow-none">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base leading-8">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function PhotoEditor({
  sheet,
  item,
  slot,
  change,
  onChange,
  disabled,
}: {
  sheet: CostingSheet;
  item: CostingServerItem;
  slot: Slot;
  change: PhotoChange;
  onChange: (next: PhotoChange) => void;
  disabled: boolean;
}) {
  const [preview, setPreview] = React.useState("");
  const [error, setError] = React.useState("");
  const [failed, setFailed] = React.useState("");
  const input = React.useRef<HTMLInputElement>(null);
  const label = slot === "ORIGINAL" ? "မူလဝယ်ယူသောအထုပ်ပုံ" : "ထုပ်ပိုးပြီးပစ္စည်းပုံ";
  const exists = slot === "ORIGINAL" ? item.originalImage : item.packagedImage;
  React.useEffect(() => {
    if (change.kind !== "replace") {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(change.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [change]);
  const src =
    change.kind === "replace"
      ? preview
      : change.kind === "keep" && exists
        ? photoUrl(sheet, item, slot)
        : "";
  return (
    <div className="space-y-2">
      <p className="text-xs leading-7 font-medium">{label}</p>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30">
          {src && failed !== src ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={label}
                className="size-full object-contain p-1"
                onError={() => setFailed(src)}
              />
            </>
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex max-w-48 flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            aria-label={`${label} ဖိုင်ရွေးရန်`}
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (
                !["image/jpeg", "image/png"].includes(file.type) ||
                file.size === 0 ||
                file.size > 5 * 1024 * 1024
              ) {
                setError("JPEG / PNG ပုံကို 5 MiB အောက် ရွေးပါ။");
                return;
              }
              setError("");
              onChange({ kind: "replace", file });
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => input.current?.click()}
            className="h-auto min-h-10 whitespace-normal py-2 text-xs leading-6"
          >
            <Upload className="mr-1 size-3.5" />
            ပုံရွေးရန်
          </Button>
          {(change.kind === "replace" || (change.kind === "keep" && exists)) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setError("");
                onChange({ kind: "remove" });
              }}
              className="h-auto min-h-10 py-2 text-xs leading-6"
            >
              <X className="mr-1 size-3.5" />
              ပုံဖယ်ရန်
            </Button>
          )}
          {change.kind !== "keep" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setError("");
                onChange(KEEP);
              }}
              className="h-auto min-h-10 py-2 text-xs leading-6"
            >
              မူလပုံပြန်ထား
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-6 text-muted-foreground">
        JPEG / PNG · 5 MiB အထိ · သိမ်းမည်နှိပ်မှ Server ပုံ ပြောင်းပါမည်။
      </p>
      {change.kind === "remove" && (
        <p className="text-xs leading-6 text-amber-700 dark:text-amber-300">
          သိမ်းမည်နှိပ်လျှင် ဤပုံကို ဖယ်ရှားပါမည်။
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs leading-6 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function EditProduct({
  initialSheet,
  target,
}: {
  initialSheet: CostingSheet;
  target: CostingServerItem;
}) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: valuesFor(target),
    mode: "onTouched",
  });
  const [sheet, setSheet] = React.useState(initialSheet);
  const currentSheet = React.useRef(initialSheet);
  const [photos, setPhotos] = React.useState<Record<Slot, PhotoChange>>({
    ORIGINAL: KEEP,
    PACKAGED: KEEP,
  });
  const [busy, setBusy] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const lock = React.useRef(false);
  const item =
    sheet.items.find((value) => value.clientItemId === target.clientItemId) || target;
  const detailPath = `/factory/costing/products/${sheet.id}/${item.id}`;
  const dirty =
    form.formState.isDirty ||
    photos.ORIGINAL.kind !== "keep" ||
    photos.PACKAGED.kind !== "keep";
  const finalized = sheet.status === "FINALIZED";
  const watched = form.watch();
  const calculation = form.formState.isDirty
    ? calculatePreview(watched)
    : item.calculation;
  const result = calculation.values;
  const displayedMoney = (key: string) =>
    calculation.ready ? money(sheet.currencyCode, result[key]) : "—";
  const displayedPercent = (key: string) =>
    calculation.ready && typeof result[key] === "number"
      ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(result[key]!)}%`
      : "—";
  const type = watched.productType;
  const count = ["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(type);
  const volume = type === "VOLUME";
  const mode = form.watch("mode");
  const unitName = form.watch("unitName") || "ခု";
  const containerName = form.watch("containerName") || "အထုပ်";
  const selectClass =
    "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
  React.useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy || blocked) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy, blocked]);
  function acknowledge(next: CostingSheet) {
    currentSheet.current = next;
    setSheet(next);
  }
  function back() {
    if (lock.current) return;
    if (
      dirty &&
      !window.confirm("မသိမ်းရသေးသော ပြင်ဆင်ချက်များကို ချန်ထားပြီး ပြန်သွားမလား။")
    )
      return;
    router.push(detailPath);
  }
  async function reload() {
    if (
      lock.current ||
      !window.confirm(
        "မသိမ်းရသေးသော ပြင်ဆင်ချက်များကို အစားထိုးပြီး Server အချက်အလက် ပြန်ယူမလား။",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      const next = await sheetRequest(`/${currentSheet.current.id}`);
      const nextItem = next.items.find(
        (value) => value.clientItemId === target.clientItemId,
      );
      if (!nextItem) throw new Error("ပစ္စည်း မရှိတော့ပါ။ စာရင်းသို့ ပြန်သွားပါ။");
      acknowledge(next);
      form.reset(valuesFor(nextItem));
      setPhotos({ ORIGINAL: KEEP, PACKAGED: KEEP });
      setBlocked(false);
      setNotice("Server အချက်အလက် ပြန်ယူပြီးပါပြီ။");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "ပြန်ယူမရပါ။");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(values: Values) {
    if (blocked || finalized) return;
    let current = currentSheet.current;
    let textSaved = false;
    try {
      if (form.formState.isDirty) {
        const edited = savePayload(current.title, [
          { id: target.clientItemId, inputs: values },
        ]).items[0];
        const payload = {
          title: current.title,
          version: current.version,
          items: current.items.map((entry) =>
            entry.clientItemId === target.clientItemId
              ? edited
              : {
                  clientItemId: entry.clientItemId,
                  ...Object.fromEntries(
                    [...textFields, ...numericFields].map((key) => [
                      key,
                      entry.inputs[key] ?? null,
                    ]),
                  ),
                },
          ),
        };
        current = await sheetRequest(`/${current.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        acknowledge(current);
        textSaved = true;
        const saved = current.items.find(
          (value) => value.clientItemId === target.clientItemId,
        );
        if (!saved)
          throw new CostingApiError(
            "သိမ်းပြီး ပစ္စည်း ID မတွေ့ပါ။ Server စာရင်း ပြန်စစ်ပါ။",
            502,
            true,
          );
        form.reset(valuesFor(saved));
      }
      // Image endpoints mutate the sheet version separately. Always acknowledge
      // each successful response before sending the next request.
      for (const slot of ["ORIGINAL", "PACKAGED"] as const) {
        const change = photos[slot];
        if (change.kind === "keep") continue;
        const saved = current.items.find(
          (value) => value.clientItemId === target.clientItemId,
        );
        if (!saved)
          throw new CostingApiError(
            "ပစ္စည်း ID မတွေ့ပါ။ Server စာရင်း ပြန်စစ်ပါ။",
            502,
            true,
          );
        const exists = slot === "ORIGINAL" ? saved.originalImage : saved.packagedImage;
        if (change.kind === "remove" && !exists) {
          setPhotos((previous) => ({ ...previous, [slot]: KEEP }));
          continue;
        }
        const path = `/${current.id}/items/${saved.id}/images/${slot}?version=${current.version}`;
        if (change.kind === "replace") {
          const body = new FormData();
          body.append("file", change.file, change.file.name);
          current = await sheetRequest(path, { method: "PUT", body });
        } else {
          current = await sheetRequest(path, { method: "DELETE" });
        }
        acknowledge(current);
        setPhotos((previous) => ({ ...previous, [slot]: KEEP }));
      }
      const saved = current.items.find(
        (value) => value.clientItemId === target.clientItemId,
      );
      if (!saved) throw new CostingApiError("Server စာရင်းကို ပြန်စစ်ပါ။", 502, true);
      router.push(`/factory/costing/products/${current.id}/${saved.id}`);
    } catch (error) {
      if (error instanceof CostingApiError && (error.status === 409 || error.uncertain))
        setBlocked(true);
      setNotice(
        `${textSaved ? "ပစ္စည်းအချက်အလက်ကို သိမ်းပြီးပါပြီ။ ပုံသိမ်းခြင်း မပြည့်စုံပါ။ " : ""}${error instanceof Error ? error.message : "သိမ်းမရပါ။"}`,
      );
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || blocked || finalized) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      await form.handleSubmit(save)();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function copyDraft() {
    if (lock.current || blocked) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      const next = await sheetRequest(`/${sheet.id}/copy`, {
        method: "POST",
        body: JSON.stringify({ version: sheet.version }),
      });
      setBlocked(true); // Never create a second copy if navigation cannot complete.
      const copied = next.items.find(
        (value) => value.clientItemId === target.clientItemId,
      );
      if (!copied)
        throw new Error("မိတ္တူဖန်တီးပြီးပါပြီ။ ပစ္စည်းကို စာရင်းမှ ပြန်ရွေးပါ။");
      router.push(`/factory/costing/products/${next.id}/${copied.id}/edit`);
    } catch (error) {
      if (error instanceof CostingApiError && (error.status === 409 || error.uncertain))
        setBlocked(true);
      setNotice(error instanceof Error ? error.message : "မိတ္တူဖန်တီးမရပါ။");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <header className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={back}
          className="h-auto min-h-11 px-0 py-2 text-xs leading-6"
        >
          <ArrowLeft className="mr-2 size-4" />
          ပစ္စည်းအသေးစိတ်သို့ ပြန်ရန်
        </Button>
        <p className="text-xs leading-7 text-muted-foreground">
          {sheet.title} · စာရင်း #{sheet.id} / ပစ္စည်း #{item.id}
        </p>
        <h1 className="text-xl font-semibold leading-9 sm:text-2xl">
          ကုန်ပစ္စည်း ပြင်ဆင်ရန်
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{finalized ? "အတည်ပြုပြီး" : "မူကြမ်း"}</Badge>
          <Badge variant="outline">{sheet.currencyCode}</Badge>
          <Badge variant="outline">Version {sheet.version}</Badge>
        </div>
      </header>
      {notice && (
        <Card className="rounded-2xl border-amber-300 shadow-none">
          <CardContent className="pt-0">
            <p role="alert" className="text-sm leading-7">
              {notice}
            </p>
          </CardContent>
        </Card>
      )}
      {blocked && (
        <Card className="rounded-2xl border-destructive/30 shadow-none">
          <CardContent className="space-y-3 pt-0">
            <p className="text-sm leading-7">
              Server စာရင်းပြောင်းထားခြင်း သို့မဟုတ် သိမ်းမှုရလဒ် မသေချာခြင်းကြောင့်
              ထပ်သိမ်းခြင်းကို ရပ်ထားပါသည်။ မူလပြင်ဆင်ချက်များကို ယခု page တွင်
              ဆက်ထိန်းထားပါသည်။ ပြန်ယူမီ လိုအပ်သောစာသားများကို ကူးယူထားပါ။
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void reload()}
              className="h-auto min-h-11 whitespace-normal py-2 text-xs leading-6"
            >
              <RefreshCw className="mr-2 size-4" />
              Server အချက်အလက် ပြန်ယူရန်
            </Button>
          </CardContent>
        </Card>
      )}
      {finalized ? (
        <Card className="rounded-2xl shadow-none">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base leading-8">
                အတည်ပြုပြီးစာရင်းကို တိုက်ရိုက်ပြင်မရပါ
              </h2>
            </CardTitle>
            <CardDescription className="text-sm leading-7">
              Costing စာရင်းတစ်ခုလုံးကို ပုံများနှင့်အတူ မူကြမ်းမိတ္တူဖန်တီးပြီး
              ရွေးထားသော ပစ္စည်းကို ပြင်နိုင်ပါသည်။ မူလအတည်ပြုစာရင်းကို မပြောင်းပါ။
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              disabled={busy || blocked}
              onClick={() => void copyDraft()}
              className="h-auto min-h-11 whitespace-normal py-2 text-xs leading-6"
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Copy className="mr-2 size-4" />
              )}
              စာရင်းကို မူကြမ်းမိတ္တူဖန်တီးပြီး ပြင်ရန်
            </Button>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate className="space-y-5">
          {Object.keys(form.formState.errors).length > 0 && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 p-4 text-xs leading-7 text-destructive"
            >
              အနီရောင်ပြထားသော အချက်အလက်များကို ပြင်ပေးပါ။
              <ul className="list-disc pl-5">
                {Object.entries(form.formState.errors).map(([key, error]) => (
                  <li key={key}>
                    {fieldLabels[key as keyof Values]}:{" "}
                    {String(error?.message || "အချက်အလက် စစ်ပါ။")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-70">
            <Section title="01 · ပစ္စည်းနှင့် တွက်ချက်ပုံ">
              <Field form={form} name="product" label="ပစ္စည်းအမည်" />
              <Field form={form} name="productType" label="ပစ္စည်းအမျိုးအစား">
                <select className={selectClass}>
                  <option value="WEIGHT">အလေးချိန် — kg → g</option>
                  <option value="VOLUME">အရည် — L → ml</option>
                  <option value="BOTTLED_DRINK">အချိုရည် / ရေဘူး</option>
                  <option value="PACKAGED_SNACK">မုန့် / အသင့်ထုပ်ပစ္စည်း</option>
                  <option value="COUNT">အရေအတွက်</option>
                </select>
              </Field>
              <Field
                form={form}
                name="containerName"
                label="မူလအထုပ် အမည် (ဥပမာ — ကတ်၊ ပုံး)"
              />
              <Field form={form} name="unitName" label="ယူနစ်အမည် (ဥပမာ — ဘူး၊ ခု)" />
              <PhotoEditor
                sheet={sheet}
                item={item}
                slot="ORIGINAL"
                change={photos.ORIGINAL}
                onChange={(next) =>
                  setPhotos((previous) => ({ ...previous, ORIGINAL: next }))
                }
                disabled={busy || blocked}
              />
            </Section>
            <Section title="02 · ဝယ်ယူပမာဏနှင့် ထုပ်ပိုးပမာဏ">
              <Field
                form={form}
                name="containers"
                label={`${containerName} အရေအတွက်`}
                numeric
              />
              {count ? (
                <Field
                  form={form}
                  name="unitsPerContainer"
                  label={`တစ်${containerName} တွင် ပါဝင်သော ${unitName}`}
                  numeric
                />
              ) : (
                <Field
                  form={form}
                  name="weightKg"
                  label={`မူလဝယ်ယူပမာဏ (${volume ? "L" : "kg"})`}
                  numeric
                />
              )}
              <Field
                form={form}
                name="lossKg"
                label={`အလျော့ပမာဏ (${count ? unitName : volume ? "L" : "kg"})`}
                numeric
              />
              <Field
                form={form}
                name="packGrams"
                label={`တစ်ရောင်းယူနစ် ပါဝင်ပမာဏ (${count ? unitName : volume ? "ml" : "g"})`}
                numeric
                description="ဥပမာ — 500g တစ်ထုပ်ဆို 500၊ တစ်ခုချင်းရောင်းလျှင် 1 ဖြည့်ပါ။"
              />
            </Section>
            <Section title="03 · ဝယ်ဈေးနှင့် ကုန်ကျစရိတ်">
              <Field form={form} name="purchasePriceMode" label="ဝယ်ဈေးသတ်မှတ်ပုံ">
                <select className={selectClass}>
                  <option value="total">စုစုပေါင်းဝယ်ဈေး</option>
                  <option value="container">မူလအထုပ် တစ်ခုချင်းဝယ်ဈေး</option>
                </select>
              </Field>
              <Field
                form={form}
                name="purchase"
                label={`ဝယ်ဈေး (${sheet.currencyCode})`}
                numeric
              />
              <Field
                form={form}
                name="processing"
                label={`ပြင်ဆင်စရိတ် စုစုပေါင်း (${sheet.currencyCode})`}
                numeric
              />
              <Field
                form={form}
                name="packaging"
                label={`တစ်ရောင်းယူနစ် ထုပ်ပိုးစရိတ် (${sheet.currencyCode})`}
                numeric
              />
              <PhotoEditor
                sheet={sheet}
                item={item}
                slot="PACKAGED"
                change={photos.PACKAGED}
                onChange={(next) =>
                  setPhotos((previous) => ({ ...previous, PACKAGED: next }))
                }
                disabled={busy || blocked}
              />
            </Section>
            <Section title="04 · ရောင်းဈေးနှင့် အမြတ်">
              <Field form={form} name="mode" label="ဈေးတွက်ချက်ပုံ">
                <select className={selectClass}>
                  <option value="price">ရောင်းဈေး ကိုယ်တိုင်သတ်မှတ်</option>
                  <option value="margin">အမြတ်အလိုက် ရောင်းဈေးတွက်ချက်</option>
                </select>
              </Field>
              {mode === "price" ? (
                <Field
                  form={form}
                  name="sellingPrice"
                  label={`တစ်ရောင်းယူနစ် ရောင်းဈေး (${sheet.currencyCode})`}
                  numeric
                />
              ) : (
                <>
                  <Field form={form} name="basis" label="အမြတ်တွက်ချက်ပုံ">
                    <select className={selectClass}>
                      <option value="margin">ရောင်းဈေးပေါ် အမြတ် (Margin)</option>
                      <option value="markup">ကုန်ကျစရိတ်ပေါ် အမြတ်တင် (Markup)</option>
                    </select>
                  </Field>
                  <Field
                    form={form}
                    name="targetPercent"
                    label="ရည်မှန်းအမြတ် (%)"
                    numeric
                  />
                  <Field
                    form={form}
                    name="rounding"
                    label={`ဈေးလုံးတင်ယူနစ် (${sheet.currencyCode})`}
                    description="1 ဆို ငွေတစ်ယူနစ်အလိုက်၊ 100 ဆို ရာပြည့်အထိ အပေါ်ဝိုင်းပါသည်။ Margin အနည်းငယ်တိုးသော်လည်း ဝိုင်းပြီးဈေး တူနေနိုင်ပါသည်။"
                    numeric
                  />
                </>
              )}
              <Field
                form={form}
                name="minimumMargin"
                label="အနည်းဆုံး Margin (%)"
                description="အနည်းဆုံးသတ်မှတ်ဈေးကို တွက်ပေးရန်ဖြစ်ပြီး ရောင်းဈေးကို အလိုအလျောက် မပြောင်းပါ။"
                numeric
              />
              <Field
                form={form}
                name="discount"
                label="လျှော့ဈေး (%)"
                numeric
                description="မူလရောင်းဈေးကို ထိန်းထားပြီး လျှော့ဈေးပြီးရောင်းဈေးနှင့် အမြတ်ကို ပြန်တွက်ပါသည်။"
              />
            </Section>
          </fieldset>
          <Card
            className="rounded-2xl bg-muted/20 shadow-none"
            aria-label="လက်ရှိတွက်ချက်ရလဒ်"
          >
            <CardHeader>
              <CardTitle>
                <h2 className="text-base leading-8">လက်ရှိတွက်ချက်ရလဒ်</h2>
              </CardTitle>
              <CardDescription className="text-xs leading-7">
                {form.formState.isDirty
                  ? "ပြင်ဆင်နေသောတန်ဖိုးများဖြင့် ချက်ချင်းပြန်တွက်ထားပါသည်။ Server မှာ မသိမ်းရသေးပါ။"
                  : "နောက်ဆုံးသိမ်းထားသော Server ရလဒ်ကို ပြထားပါသည်။"}
                {mode === "price"
                  ? " ရောင်းဈေးကို ကိုယ်တိုင်သတ်မှတ်ထားသောကြောင့် ဝယ်ဈေးပြောင်းလျှင် ကုန်ကျစရိတ်နှင့် အမြတ်သာ ပြောင်းပါသည်။ ရောင်းဈေးကို အမြတ်အလိုက် ပြောင်းလိုလျှင် ဈေးတွက်ချက်ပုံကို ပြောင်းပါ။"
                  : " ရည်မှန်းအမြတ်နှင့် ဈေးလုံးတင်ယူနစ်အလိုက် ရောင်းဈေးကို ပြန်တွက်ပေးပါသည်။"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!calculation.ready && (
                <div
                  role="status"
                  className="rounded-xl border border-amber-300 p-3 text-xs leading-7 text-amber-800 dark:text-amber-300"
                >
                  <ul className="list-disc pl-5">
                    {calculation.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {[
                  ["တစ်ယူနစ်ကုန်ကျစရိတ်", "costPerUnit"],
                  ["တစ်ယူနစ်ရောင်းဈေး", "price"],
                  ["လျှော့ဈေးပြီး တစ်ယူနစ်ရောင်းဈေး", "discountedPrice"],
                  ["တစ်ယူနစ်အမြတ်", "profitPerUnit"],
                  ["လျှော့ဈေးပြီး တစ်ယူနစ်အမြတ်", "discountedProfitPerUnit"],
                  ["မျှော်မှန်းအမြတ်", "profit"],
                  ["လျှော့ဈေးပြီး မျှော်မှန်းအမြတ်", "discountedProfit"],
                  ["မျှော်မှန်းရောင်းရငွေ", "revenue"],
                  ["လျှော့ဈေးပြီး ရောင်းရငွေ", "discountedRevenue"],
                  ["အနည်းဆုံး Margin ရရန် ရောင်းဈေး", "minimumPrice"],
                  ["Discount ပါလျှင် အနည်းဆုံးသတ်မှတ်ဈေး", "minimumListPrice"],
                ].map(([label, key]) => (
                  <div
                    key={key}
                    className="min-w-0 rounded-xl border border-border bg-background p-3"
                  >
                    <dt className="text-xs leading-7 text-muted-foreground">{label}</dt>
                    <dd
                      className={`break-words text-sm font-semibold leading-7 tabular-nums ${key === "discountedPrice" || key === "price" ? "text-blue-600 dark:text-blue-400" : ""}`}
                    >
                      {displayedMoney(key)}
                    </dd>
                  </div>
                ))}
                {[
                  ["လက်ရှိ Margin", "margin"],
                  ["လျှော့ဈေးပြီး Margin", "discountedMargin"],
                ].map(([label, key]) => (
                  <div
                    key={key}
                    className="min-w-0 rounded-xl border border-border bg-background p-3"
                  >
                    <dt className="text-xs leading-7 text-muted-foreground">{label}</dt>
                    <dd className="text-sm font-semibold leading-7 tabular-nums">
                      {displayedPercent(key)}
                    </dd>
                  </div>
                ))}
              </dl>
              {calculation.ready &&
                typeof result.discountedMargin === "number" &&
                watched.minimumMargin.trim() &&
                result.discountedMargin < Number(watched.minimumMargin) && (
                  <p
                    role="status"
                    className="rounded-xl bg-amber-50 p-3 text-xs leading-7 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    လျှော့ဈေးပြီး Margin သည် သတ်မှတ်ထားသော အနည်းဆုံး Margin ထက်
                    နည်းနေပါသည်။ ရောင်းဈေး၊ လျှော့ဈေးနှင့် ကုန်ကျစရိတ်ကို ပြန်စစ်ပါ။
                  </p>
                )}
              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold leading-7">
                  Margin အလိုက် ရောင်းဈေး နှိုင်းယှဉ်ရန်
                </h3>
                <dl className="grid grid-cols-3 gap-3">
                  {[15, 20, 25].map((target) => (
                    <div
                      key={target}
                      className="min-w-0 rounded-xl border border-border bg-background p-3"
                    >
                      <dt className="text-xs leading-7 text-muted-foreground">
                        {target}% Margin
                      </dt>
                      <dd className="break-words text-xs font-semibold leading-7 tabular-nums">
                        {displayedMoney(`margin${target}Price`)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <p className="text-xs leading-7 text-muted-foreground">
                Browser တွက်ချက်မှုသည် အကြိုကြည့်ရန်ဖြစ်ပါသည်။ သိမ်းပြီးရလာသော Server
                ရလဒ်ကို အတည်ယူပါ။ ထုတ်ယူနစ်၊ ရောင်းရငွေနှင့် အမြတ်သည် costing
                ခန့်မှန်းချက်ဖြစ်ပြီး လက်ရှိ stock နှင့် အမှန်တကယ်ရောင်းရငွေ မဟုတ်ပါ။
              </p>
            </CardContent>
          </Card>
          <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={back}
              className="h-auto min-h-11 py-2 text-xs leading-6"
            >
              မလုပ်တော့ပါ
            </Button>
            <Button
              type="submit"
              disabled={busy || blocked || !dirty}
              className="h-auto min-h-11 py-2 text-xs leading-6"
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              {busy ? "သိမ်းနေသည်…" : "ပြင်ဆင်ချက် သိမ်းမည်"}
            </Button>
          </div>
          <p role="status" className="text-xs leading-7 text-muted-foreground">
            {dirty
              ? "မသိမ်းရသေးသော ပြင်ဆင်ချက်ရှိပါသည်။"
              : "မသိမ်းရသေးသော ပြင်ဆင်ချက် မရှိပါ။"}{" "}
            ပုံများကို တစ်ပုံချင်း သိမ်းမည်ဖြစ်၍ ပုံ upload ပျက်ပါက စာသားနှင့်
            အောင်မြင်ပြီးပုံများကို Server မှာ သိမ်းပြီး ဖြစ်နိုင်ပါသည်။
          </p>
        </form>
      )}
    </>
  );
}

export default function CostingProductEditPage() {
  const params = useParams<{ sheetId: string; itemId: string }>();
  const router = useRouter();
  const sheetId = params?.sheetId,
    itemId = params?.itemId;
  const [sheet, setSheet] = React.useState<CostingSheet | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState("");
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSheet(null);
    setBusy(true);
    setError("");
    if (!validId(sheetId) || !validId(itemId)) {
      setError("ပစ္စည်းလင့်ခ် မမှန်ပါ။");
      setBusy(false);
      return () => {
        active = false;
        controller.abort();
      };
    }
    void sheetRequest(`/${sheetId}`, { signal: controller.signal })
      .then((next) => {
        if (!active) return;
        if (
          next.id !== Number(sheetId) ||
          !next.items.some((item) => item.id === Number(itemId))
        )
          throw new Error("ပစ္စည်း မတွေ့ပါ သို့မဟုတ် ပြောင်းလဲထားပါသည်။");
        setSheet(next);
      })
      .catch((reason) => {
        if (active && !controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "ဖွင့်မရပါ။");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [sheetId, itemId, revision]);
  const item = sheet?.items.find((value) => value.id === Number(itemId));
  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl space-y-5 p-4 text-foreground sm:p-6">
      {busy ? (
        <Card>
          <CardContent className="flex min-h-64 items-center justify-center gap-3 pt-0 text-sm text-muted-foreground">
            <LoadingScreen variant="section" title="ပစ္စည်းအချက်အလက် ရယူနေပါသည်…" />
          </CardContent>
        </Card>
      ) : error || !sheet || !item ? (
        <Card>
          <CardContent className="space-y-4 pt-0">
            <AlertCircle className="size-7 text-muted-foreground" />
            <h1 className="text-lg font-semibold leading-8">Edit page ဖွင့်မရပါ</h1>
            <p role="alert" className="text-sm leading-7">
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
              <Button
                type="button"
                onClick={() => router.push("/factory/costing/products")}
              >
                စာရင်းသို့ပြန်ရန်
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EditProduct key={`${sheet.id}:${item.id}`} initialSheet={sheet} target={item} />
      )}
    </main>
  );
}
