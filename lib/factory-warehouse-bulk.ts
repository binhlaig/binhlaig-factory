// Add this file as lib/receiving-bulk-api.ts. Existing receiving-api.ts is retained.
import {
  receivingRequest as request,
  decodeSource as legacySource,
  decodeReceipt as legacyReceipt,
  ReceivingError,
  type Source as OldSource,
  type Receipt as OldReceipt,
} from "@/lib/receiving-api";
export { ReceivingError, decodePlaces, decodePage } from "@/lib/receiving-api";
export type { Place, Paged } from "@/lib/receiving-api";
export type Bulk = {
  contractVersion: 1;
  packageUnit: string;
  quantityPerPackage: string;
  baseUnit: string;
  purchaseCostPerPackage: string;
  originalPhotoUrl: string | null;
};
export type Source = OldSource & { bulk?: Bulk; bulkPreview?: boolean };
export type Receipt = OldReceipt & {
  stockKind?: "BULK";
  bulkPackageCount?: string;
  bulkBaseQuantity?: string;
  snapshot: OldReceipt["snapshot"] & { bulk?: Bulk };
};
export type Save = {
  stockKind: "BULK";
  costingSheetId: number;
  costingItemId: number;
  sourceVersion: number;
  version?: number;
  bulkPackageCount: string;
  batch: string;
  warehouseId: number;
  locationId: number;
  receivedDate: string;
  expiryDate: string | null;
  note: string | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const SCALE = BigInt(1000000);
function scaled(value: unknown, zero = false): bigint {
  const text =
    typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(text))
    throw new Error("မူလအထုပ်ပမာဏ / တန်ဖိုး ပုံစံမမှန်ပါ။");
  const [whole, fraction = ""] = text.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
  if (
    (!zero && result <= BigInt(0)) ||
    result > BigInt("999999999999999999999999999999")
  )
    throw new Error("ပမာဏ / တန်ဖိုး ကန့်သတ်ချက်ကျော်ပါသည်။");
  return result;
}
function decimal(n: bigint): string {
  const whole = n / SCALE,
    fraction = (n % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
export function totalFor(count: string, perPackage: string): string | null {
  if (!/^[1-9]\d*$/.test(count) || count.length > 12) return null;
  try {
    const result = BigInt(count) * scaled(perPackage, true);
    if (result > BigInt("999999999999999999999999999999")) return null;
    return decimal(result);
  } catch {
    return null;
  }
}
export function displayDecimal(value: string): string {
  const [whole, fraction] = value.split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
function bulk(v: unknown): Bulk {
  if (
    !object(v) ||
    v.contractVersion !== 1 ||
    typeof v.quantityPerPackage !== "string" ||
    typeof v.purchaseCostPerPackage !== "string" ||
    typeof v.packageUnit !== "string" ||
    !v.packageUnit.trim() ||
    v.packageUnit.length > 50 ||
    typeof v.baseUnit !== "string" ||
    !v.baseUnit.trim() ||
    v.baseUnit.length > 30 ||
    (v.originalPhotoUrl !== null && typeof v.originalPhotoUrl !== "string")
  )
    throw new Error("Bulk Receiving API data မမှန်ပါ။");
  scaled(v.quantityPerPackage);
  scaled(v.purchaseCostPerPackage, true);
  return v as Bulk;
}
export function decodeSource(v: unknown): Source {
  const source = legacySource(v) as Source;
  if (source.bulk !== undefined)
    return {
      ...source,
      bulk: bulk(source.bulk),
      bulkPreview: source.bulkPreview === true,
    };
  return source;
}
export function decodeReceipt(v: unknown): Receipt {
  // Legacy finished-goods receipts remain viewable in History, never relabelled.
  if (!object(v) || v.stockKind !== "BULK") return legacyReceipt(v) as Receipt;
  if (!object(v.snapshot)) throw new Error("Bulk snapshot မမှန်ပါ။");
  const b = bulk(v.snapshot.bulk);
  if (
    typeof v.bulkPackageCount !== "string" ||
    !/^[1-9]\d*$/.test(v.bulkPackageCount) ||
    typeof v.bulkBaseQuantity !== "string" ||
    totalFor(v.bulkPackageCount, b.quantityPerPackage) !==
      decimal(scaled(v.bulkBaseQuantity))
  )
    throw new Error("အထုပ်အရေအတွက်နှင့် စုစုပေါင်းပမာဏ မကိုက်ပါ။");
  // Validate common IDs, source snapshot and statuses through the existing decoder.
  // actualQuantity in a BULK response is base-unit quantity; it may be decimal.
  legacyReceipt({ ...v, actualQuantity: 1 });
  if (
    typeof v.actualQuantity !== "number" ||
    !Number.isFinite(v.actualQuantity) ||
    v.actualQuantity <= 0 ||
    v.actualQuantity !== Number(v.bulkBaseQuantity) ||
    v.saleUnit !== b.baseUnit
  )
    throw new Error("Bulk Stock ယူနစ် မမှန်ပါ။");
  return { ...v, snapshot: { ...v.snapshot, bulk: b } } as Receipt;
}
export function sourceOf(r: Receipt): Source {
  return decodeSource({
    ...r.snapshot,
    costingSheetId: r.costingSheetId,
    costingItemId: r.costingItemId,
    sourceVersion: r.sourceVersion,
    barcode: r.barcode,
    expectedQuantity: r.expectedQuantity,
    costPerUnit: r.costPerUnit,
    currency: r.currency,
    saleUnit: r.snapshot.saleUnit ?? r.saleUnit,
    ...(r.stockKind === "BULK" ? { bulk: r.snapshot.bulk } : {}),
  });
}
// The existing authenticated Costing BFF serves original purchase images.
// originalPhotoUrl may be null even when a Costing original image exists.
export function photoCandidates(source: Source): string[] {
  const urls: string[] = [];
  if (
    [source.costingSheetId, source.costingItemId].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    ) &&
    Number.isSafeInteger(source.sourceVersion) &&
    source.sourceVersion >= 0
  ) {
    urls.push(
      `/api/factory/costings/${source.costingSheetId}/items/${source.costingItemId}/images/ORIGINAL?v=${source.sourceVersion}`,
    );
  }
  const supplied = source.bulk?.originalPhotoUrl?.trim();
  if (supplied && !/\/images\/PACKAGED(?:[/?]|$)/i.test(supplied)) {
    // Keep authenticated Costing image requests on the existing same-origin proxy.
    // Never place Bearer tokens in an image URL or substitute a PACKAGED photo.
    if (supplied.startsWith("/") && !supplied.startsWith("//"))
      urls.push(supplied);
    else {
      try {
        const url = new URL(supplied);
        if (["http:", "https:"].includes(url.protocol)) {
          urls.push(
            url.pathname.startsWith("/api/factory/costings/")
              ? `${url.pathname}${url.search}`
              : url.href,
          );
        }
      } catch {
        /* Invalid image metadata must not hide the Costing fallback. */
      }
    }
  }
  return [...new Set(urls)];
}
export function photoOf(source: Source): string | null {
  return photoCandidates(source)[0] ?? null;
}
export function isBulkReady(source: Source | null): boolean {
  return (
    !!source?.bulk && source.bulk.contractVersion === 1 && !source.bulkPreview
  );
}
function previewFromInputs(
  source: Source,
  inputs: Record<string, unknown>,
): Source {
  try {
    const count = ["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(
      source.productType,
    );
    const quantityPerPackage = decimal(
      scaled(count ? inputs.unitsPerContainer : inputs.weightKg),
    );
    const purchase = scaled(inputs.purchase, true);
    let cost = purchase;
    if (count && inputs.purchasePriceMode !== "container") {
      const containers = String(inputs.containers);
      if (
        !/^[1-9]\d*$/.test(containers) ||
        containers.length > 12 ||
        purchase % BigInt(containers) !== BigInt(0)
      )
        return source;
      cost = purchase / BigInt(containers);
    }
    // Weight/volume inputs contain a purchase basis, not necessarily a named sack.
    // Keep that distinction visible until the server supplies immutable bulk metadata.
    return {
      ...source,
      bulkPreview: true,
      bulk: {
        contractVersion: 1,
        packageUnit: count
          ? String(inputs.containerName || "မူလအထုပ်")
          : "မူလအထုပ်",
        quantityPerPackage,
        baseUnit: count
          ? String(inputs.unitName || "ခု")
          : source.productType === "VOLUME"
            ? "L"
            : "kg",
        purchaseCostPerPackage: decimal(cost),
        originalPhotoUrl: null,
      },
    };
  } catch {
    return source;
  }
}
export async function receivingRequest(
  path = "",
  options: RequestInit = {},
): Promise<unknown> {
  const method = options.method || "GET";
  if (method !== "GET" && /^(?:|\/\d+(?:\/confirm)?)$/.test(path)) {
    const body =
      typeof options.body === "string" ? JSON.parse(options.body) : null;
    if (
      !object(body) ||
      body.stockKind !== "BULK" ||
      ((path === "" || !path.endsWith("/confirm")) &&
        (typeof body.bulkPackageCount !== "string" ||
          !/^[1-9]\d*$/.test(body.bulkPackageCount)))
    )
      throw new ReceivingError(
        "Bulk Receiving request လိုအပ်ပါသည်။ Finished Goods API သို့ မပို့ရသေးပါ။",
        400,
      );
  }
  const response = await request(path, options);
  if (method !== "GET" || !path.startsWith("/sources?")) return response;
  const source = decodeSource(response);
  if (isBulkReady(source)) return source;
  // Read-only preview for the old backend. Mutations remain disabled.
  try {
    const res = await fetch(`/api/factory/costings/${source.costingSheetId}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
    if (!res.ok) return source;
    const sheet = await res.json();
    if (
      !object(sheet) ||
      sheet.version !== source.sourceVersion ||
      !Array.isArray(sheet.items)
    )
      return source;
    const item = sheet.items.find(
      (v) => object(v) && v.id === source.costingItemId,
    );
    return object(item) && object(item.inputs)
      ? previewFromInputs(source, item.inputs)
      : source;
  } catch {
    return source;
  }
}
