export type Place = { id: number; name: string; active: boolean };
export type Source = {
  costingSheetId: number;
  costingItemId: number;
  sourceVersion: number;
  barcode: string;
  productName: string;
  productType: string;
  packageSize: number;
  packageSizeUnit: string;
  saleUnit: string;
  expectedQuantity: number;
  costPerUnit: number;
  currency: string;
  packagedPhotoUrl: string | null;
  previousConfirmedQuantity?: number;
  previousReceipts?: unknown[];
};
export type Receipt = {
  id: number;
  receivingNumber: string;
  costingSheetId: number;
  costingItemId: number;
  sourceVersion: number;
  version: number;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  snapshot: {
    productName: string;
    productType: string;
    packageSize: number;
    packageSizeUnit: string;
    saleUnit: string;
    packagedPhotoUrl: string | null;
    inputs?: Record<string, unknown>;
    calculation?: { values?: Record<string, number> };
  };
  barcode: string;
  expectedQuantity: number;
  actualQuantity: number;
  costPerUnit: number;
  currency: string;
  saleUnit: string;
  difference: number;
  referenceValue: number;
  varianceReason: string | null;
  batch: string;
  warehouseId: number;
  locationId: number;
  receivedDate: string;
  expiryDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
};
export type Save = {
  costingSheetId: number;
  costingItemId: number;
  sourceVersion: number;
  version?: number;
  actualQuantity: number;
  varianceReason: string | null;
  batch: string;
  warehouseId: number;
  locationId: number;
  receivedDate: string;
  expiryDate: string | null;
  note: string | null;
};
export type Paged<T> = {
  content: T[];
  number: number;
  totalPages: number;
  totalElements: number;
};
export class ReceivingError extends Error {
  constructor(
    message: string,
    public status = 0,
    public uncertain = false,
  ) {
    super(message);
  }
}
export async function receivingRequest(
  path = "",
  options: RequestInit = {},
): Promise<unknown> {
  const mutation = !!options.method && options.method !== "GET";
  let response: Response;
  try {
    response = await fetch(`/api/factory/receivings${path}`, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(40000),
    });
  } catch {
    throw new ReceivingError(
      mutation
        ? "ဆက်သွယ်မှု ပြတ်သွားပါသည်။ လုပ်ဆောင်မှု ပြန်စစ်ရန်ကို နှိပ်ပါ။"
        : "Server ချိတ်ဆက်မရပါ။ ပြန်စမ်းပါ။",
      0,
      mutation,
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ReceivingError(
      typeof body?.message === "string"
        ? body.message
        : `API error ${response.status}`,
      response.status,
      mutation && (response.status >= 500 || response.status === 408),
    );
  if (body === null)
    throw new ReceivingError("Server response ဖတ်မရပါ။", 502, mutation);
  return body;
}
const id = (n: unknown) =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const version = (n: unknown) =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const num = (n: unknown) => typeof n === "number" && Number.isFinite(n);
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const quantity = (n: unknown) => id(n);
function invalid(): never {
  throw new ReceivingError(
    "Server data ပုံစံ/အရေအတွက် မမှန်ပါ။ လက်ရှိစာရင်းကို ပြန်စစ်ပါ။",
    502,
  );
}
export function decodeSource(v: unknown): Source {
  if (
    !obj(v) ||
    !id(v.costingSheetId) ||
    !id(v.costingItemId) ||
    !version(v.sourceVersion) ||
    !quantity(v.expectedQuantity) ||
    !num(v.costPerUnit) ||
    (v.costPerUnit as number) < 0 ||
    !num(v.packageSize) ||
    ![
      "productName",
      "productType",
      "barcode",
      "packageSizeUnit",
      "saleUnit",
      "currency",
    ].every((k) => typeof v[k] === "string") ||
    v.barcode !== `FC-${v.costingSheetId}-${v.costingItemId}`
  )
    return invalid();
  return v as Source;
}
export function decodeReceipt(v: unknown): Receipt {
  if (
    !obj(v) ||
    !id(v.id) ||
    !version(v.version) ||
    !id(v.warehouseId) ||
    !id(v.locationId) ||
    !quantity(v.actualQuantity) ||
    !quantity(v.expectedQuantity) ||
    !num(v.costPerUnit) ||
    !num(v.difference) ||
    !num(v.referenceValue) ||
    !obj(v.snapshot) ||
    typeof v.snapshot.productName !== "string" ||
    !["DRAFT", "CONFIRMED", "CANCELLED"].includes(String(v.status)) ||
    ![
      "receivingNumber",
      "batch",
      "receivedDate",
      "barcode",
      "currency",
      "saleUnit",
    ].every((k) => typeof v[k] === "string")
  )
    return invalid();
  decodeSource({
    ...v.snapshot,
    ...v,
    productName: v.snapshot.productName,
    productType: v.snapshot.productType,
    packageSize: v.snapshot.packageSize,
    packageSizeUnit: v.snapshot.packageSizeUnit,
  });
  return v as Receipt;
}
export function decodePlaces(v: unknown): Place[] {
  if (
    !Array.isArray(v) ||
    v.some(
      (p) =>
        !obj(p) ||
        !id(p.id) ||
        typeof p.name !== "string" ||
        typeof p.active !== "boolean",
    )
  )
    return invalid();
  return v;
}
export function decodePage<T>(
  v: unknown,
  decode: (value: unknown) => T,
): Paged<T> {
  if (
    !obj(v) ||
    !Array.isArray(v.content) ||
    !version(v.number) ||
    !version(v.totalPages) ||
    !version(v.totalElements)
  )
    return invalid();
  return {
    content: v.content.map(decode),
    number: v.number as number,
    totalPages: v.totalPages as number,
    totalElements: v.totalElements as number,
  };
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
    saleUnit: r.saleUnit,
  });
}
export function photoOf(s: Source): string | null {
  return s.packagedPhotoUrl
    ? `/api/factory/costings/${s.costingSheetId}/items/${s.costingItemId}/images/PACKAGED?v=${s.sourceVersion}`
    : null;
}
