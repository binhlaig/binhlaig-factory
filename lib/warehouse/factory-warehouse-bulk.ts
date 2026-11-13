import {
  StockError,
  requestJson,
  type Balance,
  type Movement,
  type StockPage,
} from "./factory-stock-api";
import { decodeReceipt, type Receipt } from "@/lib/receiving-bulk-api";

export type BulkFields = {
  stockKind?: "BULK";
  packageUnit?: string;
  quantityPerPackage?: string;
  receivedPackageCount?: string | null;
  imageUrls?: string[];
};
export type WarehouseBalance = Balance & BulkFields;
export type WarehouseMovement = Movement & BulkFields;
export type BulkFilters = {
  search: string;
  warehouseId: string;
  locationId: string;
  batch: string;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function invalid(message = "Bulk Stock response ပုံစံ မမှန်ပါ။"): never {
  throw new StockError(message, 502);
}
function integer(v: unknown, zero = false): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < (zero ? 0 : 1))
    return invalid();
  return v;
}
// Preserve decimal quantities exactly. Never convert balances to floating-point arithmetic.
export function decimal(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER)
      return invalid(
        "ပမာဏကို precision မပျောက်သော decimal string အဖြစ် API မှ ပို့ရန်လိုပါသည်။",
      );
    v = String(v);
  }
  if (typeof v !== "string" || !/^-?\d{1,30}(?:\.\d{1,6})?$/.test(v))
    return invalid();
  const [whole, fraction = ""] = v.split(".");
  const negative = whole.startsWith("-");
  const w = BigInt(whole).toString().replace(/^-/, "");
  const f = fraction.replace(/0+$/, "");
  return `${negative && (w !== "0" || f) ? "-" : ""}${w}${f ? `.${f}` : ""}`;
}
function scaled(v: string): bigint {
  const n = decimal(v),
    negative = n.startsWith("-");
  const [w, f = ""] = n.replace(/^-/, "").split(".");
  const value = BigInt(w) * BigInt(1000000) + BigInt(f.padEnd(6, "0"));
  return negative ? -value : value;
}
function unscaled(v: bigint): string {
  const abs = v < BigInt(0) ? -v : v;
  return decimal(
    `${v < BigInt(0) ? "-" : ""}${abs / BigInt(1000000)}.${String(abs % BigInt(1000000)).padStart(6, "0")}`,
  );
}
export function quantity(v: string): string {
  const n = decimal(v),
    [w, f] = n.split(".");
  return `${w.startsWith("-") ? "-" : ""}${BigInt(w.replace(/^-/, "")).toLocaleString("en-US")}${f ? `.${f}` : ""}`;
}
export const isZero = (v: string) => scaled(v) === BigInt(0);
export const isPositive = (v: string) => scaled(v) > BigInt(0);
export function packageRemainder(
  qty: string,
  per: string,
  packageUnit: string,
  baseUnit: string,
): string {
  const q = scaled(qty),
    p = scaled(per);
  if (q < BigInt(0) || p <= BigInt(0)) return "—";
  const whole = q / p,
    loose = q % p;
  return `${whole.toLocaleString("en-US")} ${packageUnit}${loose ? ` + ${quantity(unscaled(loose))} ${baseUnit}` : ""}`;
}
export const stockKey = (r: {
  itemId: number;
  sourceVersion: number;
  warehouseId: number;
  locationId: number;
  batch: string;
}) =>
  JSON.stringify([
    r.itemId,
    r.sourceVersion,
    r.warehouseId,
    r.locationId,
    r.batch.trim().toUpperCase(),
  ]);
export function rowKey(r: WarehouseBalance | WarehouseMovement): string {
  return "quantity" in r ? stockKey(r) : r.id;
}
function text(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return invalid();
  return v;
}
function images(r: Receipt): string[] {
  const canonical = `/api/factory/costings/${r.costingSheetId}/items/${r.costingItemId}/images/ORIGINAL?v=${r.sourceVersion}`;
  const urls = [canonical];
  const supplied = r.snapshot.bulk?.originalPhotoUrl;
  // Authenticated images remain on the existing Costing proxy. Do not use packaged images for bulk.
  if (typeof supplied === "string") {
    try {
      const u = new URL(supplied, "https://same-origin.invalid");
      if (
        ["http:", "https:"].includes(u.protocol) &&
        /^\/api\/factory\/costings\/\d+\/items\/\d+\/images\/ORIGINAL$/.test(
          u.pathname,
        )
      )
        urls.push(u.pathname + u.search);
    } catch {
      /* Canonical fallback remains available. */
    }
  }
  return [...new Set(urls)];
}
export async function confirmedBulkReceipts(
  signal: AbortSignal,
): Promise<Receipt[]> {
  const receipts: Receipt[] = [];
  const seen = new Set<number>();
  let expectedTotal: number | undefined;
  // The existing history API is paginated. Never silently truncate an inventory join.
  for (let page = 0; ; page++) {
    const v = await requestJson(
      `/api/factory/receivings?status=CONFIRMED&page=${page}&size=100`,
      { signal },
    );
    if (
      !object(v) ||
      !Array.isArray(v.content) ||
      v.number !== page ||
      v.size !== 100 ||
      !Number.isSafeInteger(v.totalPages) ||
      Number(v.totalPages) < 0 ||
      !Number.isSafeInteger(v.totalElements) ||
      Number(v.totalElements) < 0
    )
      return invalid("Receiving history pagination မမှန်ပါ။");
    if (Number(v.totalElements) > 10000 || Number(v.totalPages) > 100)
      return invalid(
        "မှတ်တမ်း 10,000 ကျော်အတွက် server-side Bulk Stock search/pagination API ချိတ်ရန်လိုပါသည်။",
      );
    if (expectedTotal !== undefined && expectedTotal !== v.totalElements)
      return invalid("လက်ခံစာရင်း ပြောင်းလဲသွားပါသည်။ ပြန်တင်ရန် နှိပ်ပါ။");
    expectedTotal = Number(v.totalElements);
    for (const raw of v.content) {
      if (!object(raw) || raw.status !== "CONFIRMED") return invalid();
      const id = integer(raw.id);
      if (seen.has(id))
        return invalid("Receiving pagination ပြောင်းလဲသွားပါသည်။ ပြန်တင်ပါ။");
      seen.add(id);
      if (raw.stockKind === "BULK") receipts.push(decodeReceipt(raw));
    }
    if (page + 1 >= Number(v.totalPages)) {
      if (seen.size !== expectedTotal)
        return invalid("Receiving မှတ်တမ်း မပြည့်စုံပါ။ ပြန်တင်ပါ။");
      return receipts;
    }
    if (!v.content.length) return invalid();
  }
}
function receiptKey(r: Receipt) {
  return stockKey({
    itemId: r.costingItemId,
    sourceVersion: r.sourceVersion,
    warehouseId: r.warehouseId,
    locationId: r.locationId,
    batch: r.batch,
  });
}
function filtered<
  T extends {
    name: string;
    barcode: string;
    batch: string;
    warehouseId: number;
    locationId: number;
  },
>(rows: T[], f: BulkFilters): T[] {
  const search = f.search.trim().toLocaleLowerCase();
  return rows.filter(
    (r) =>
      (!f.warehouseId || String(r.warehouseId) === f.warehouseId) &&
      (!f.locationId || String(r.locationId) === f.locationId) &&
      (!f.batch ||
        r.batch.trim().toUpperCase() === f.batch.trim().toUpperCase()) &&
      (!search ||
        r.name.toLocaleLowerCase().includes(search) ||
        r.barcode.toLocaleLowerCase().includes(search)),
  );
}
function slice<T>(rows: T[], page: number, size: number): StockPage<T> {
  return {
    content: rows.slice(page * size, (page + 1) * size),
    page,
    size,
    totalElements: rows.length,
  };
}
export function bulkBalances(
  raw: unknown,
  receipts: Receipt[],
  filters: BulkFilters,
  page: number,
  size: number,
): StockPage<WarehouseBalance> {
  if (!Array.isArray(raw))
    return invalid("Bulk balance API မှ array response လိုအပ်ပါသည်။");
  const groups = new Map<
    string,
    { receipt: Receipt; received: bigint; packages: bigint }
  >();
  for (const r of receipts) {
    const k = receiptKey(r),
      old = groups.get(k);
    groups.set(k, {
      receipt: r,
      received: (old?.received ?? BigInt(0)) + scaled(r.bulkBaseQuantity!),
      packages: (old?.packages ?? BigInt(0)) + BigInt(r.bulkPackageCount!),
    });
  }
  const keys = new Set<string>();
  const rows = raw
    .map((r): WarehouseBalance => {
      if (!object(r)) return invalid();
      const itemId = integer(r.item_id),
        sourceVersion = integer(r.source_version, true),
        warehouseId = integer(r.warehouse_id),
        locationId = integer(r.location_id);
      const batch = text(r.batch),
        key = stockKey({
          itemId,
          sourceVersion,
          warehouseId,
          locationId,
          batch,
        });
      if (keys.has(key)) return invalid("Bulk balance identity ထပ်နေပါသည်။");
      keys.add(key);
      const match = groups.get(key),
        receipt = match?.receipt;
      const b = receipt?.snapshot.bulk;
      const per = decimal(r.quantity_per_package ?? b?.quantityPerPackage),
        unit = text(r.base_unit ?? b?.baseUnit),
        packageUnit = text(r.package_unit ?? b?.packageUnit);
      const qty = decimal(r.base_quantity ?? r.quantity);
      if (!isPositive(per) || scaled(qty) < BigInt(0)) return invalid();
      if (
        b &&
        (per !== decimal(b.quantityPerPackage) ||
          unit !== b.baseUnit ||
          packageUnit !== b.packageUnit)
      )
        return invalid("Bulk balance နှင့် Receiving snapshot ယူနစ်မကိုက်ပါ။");
      const sheet = receipt?.costingSheetId ?? integer(r.sheet_id);
      return {
        itemId,
        sourceVersion,
        warehouseId,
        locationId,
        batch,
        barcode:
          receipt?.barcode ??
          (typeof r.barcode === "string" ? r.barcode : `FC-${sheet}-${itemId}`),
        name:
          receipt?.snapshot.productName ??
          (typeof r.product_name === "string"
            ? r.product_name
            : `ပစ္စည်း #${itemId}`),
        unit,
        quantity: qty,
        // No sale/production totals are invented from the remaining balance.
        receivedQuantity: match ? unscaled(match.received) : null,
        soldQuantity: null,
        stockKind: "BULK",
        packageUnit,
        quantityPerPackage: per,
        receivedPackageCount: match ? match.packages.toString() : null,
        imageUrls: receipt
          ? images(receipt)
          : [
              `/api/factory/costings/${sheet}/items/${itemId}/images/ORIGINAL?v=${sourceVersion}`,
            ],
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || rowKey(a).localeCompare(rowKey(b)),
    );
  return slice(filtered(rows, filters), page, size);
}
export function bulkReceivingHistory(
  receipts: Receipt[],
  filters: BulkFilters,
  page: number,
  size: number,
): StockPage<WarehouseMovement> {
  const rows = receipts
    .map((r): WarehouseMovement => {
      const b = r.snapshot.bulk!;
      const at = r.confirmedAt;
      if (!at || !Number.isFinite(Date.parse(at)))
        return invalid("Confirmed Receiving timestamp မရှိပါ။");
      return {
        id: `bulk-receiving-${r.id}`,
        receivingId: r.id,
        warehouseId: r.warehouseId,
        locationId: r.locationId,
        batch: r.batch,
        barcode: r.barcode,
        name: r.snapshot.productName,
        unit: b.baseUnit,
        delta: decimal(r.bulkBaseQuantity),
        type: "STOCK_IN",
        createdAt: at,
        stockKind: "BULK",
        packageUnit: b.packageUnit,
        quantityPerPackage: b.quantityPerPackage,
        receivedPackageCount: r.bulkPackageCount!,
        imageUrls: images(r),
      };
    })
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.receivingId - a.receivingId,
    );
  return slice(filtered(rows, filters), page, size);
}
