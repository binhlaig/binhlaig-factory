export type Place = { id: number; name: string; active: boolean };
export type Balance = {
  itemId: number;
  sourceVersion: number;
  warehouseId: number;
  locationId: number;
  batch: string;
  barcode: string;
  name: string;
  unit: string;
  quantity: string;
  receivedQuantity: string | null;
  soldQuantity: string | null;
};
export type Movement = {
  id: string;
  receivingId: number;
  warehouseId: number;
  locationId: number;
  batch: string;
  barcode: string;
  name: string;
  unit: string;
  delta: string;
  type: "STOCK_IN" | "SALE_OUT";
  createdAt: string;
};
export type StockPage<T> = {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
};
export type ReceiptOption = {
  id: number;
  receivingNumber: string;
  barcode: string;
  name: string;
  batch: string;
  unit: string;
  actualQuantity: string;
  warehouseId: number;
  locationId: number;
};
export type PosProduct = {
  id: number;
  name: string;
  barcode: string;
  sku: string;
};
export class StockError extends Error {
  constructor(
    message: string,
    public status = 0,
    public uncertain = false,
  ) {
    super(message);
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function invalid(): never {
  throw new StockError("Server data ပုံစံ/အရေအတွက် မမှန်ပါ။ ပြန်စစ်ပါ။", 502);
}
export function integer(v: unknown, signed = false): string {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) return invalid();
    v = String(v);
  }
  if (typeof v !== "string" || !(signed ? /^-?\d+$/ : /^\d+$/).test(v))
    return invalid();
  return BigInt(v).toString();
}
export const quantity = (v: string) => BigInt(v).toLocaleString("en-US");
export async function requestJson(
  url: string,
  options: RequestInit = {},
): Promise<unknown> {
  const mutation = !!options.method && options.method !== "GET";
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(30000),
    });
  } catch {
    throw new StockError(
      mutation
        ? "ဆက်သွယ်မှုပြတ်သွားပါသည်။ ချိတ်ဆက်မှု အောင်မြင်ပြီးဖြစ်နိုင်သဖြင့် ထပ်မပို့မီ စစ်ပါ။"
        : "Server ချိတ်ဆက်မရပါ။ ပြန်စမ်းပါ။",
      0,
      mutation,
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new StockError(
      typeof body?.message === "string"
        ? body.message
        : response.status === 401
          ? "Login ပြန်ဝင်ပါ။"
          : `API error ${response.status}`,
      response.status,
      mutation && response.status >= 500,
    );
  if (body === null)
    throw new StockError("Server response ဖတ်မရပါ။", 502, mutation);
  return body;
}
export function decodePlaces(v: unknown): Place[] {
  if (
    !Array.isArray(v) ||
    v.some(
      (p) =>
        !object(p) ||
        !id(p.id) ||
        typeof p.name !== "string" ||
        typeof p.active !== "boolean",
    )
  )
    return invalid();
  return v;
}
export function decodeBalances(v: unknown): StockPage<Balance> {
  return decodePage(v, (r) => {
    if (
      !id(r.item_id) ||
      !count(r.source_version) ||
      !id(r.warehouse_id) ||
      !id(r.location_id) ||
      !["barcode", "product_name", "sale_unit"].every(
        (k) => typeof r[k] === "string",
      ) ||
      typeof (r.normalized_batch ?? r.batch) !== "string"
    )
      return invalid();
    return {
      itemId: r.item_id,
      sourceVersion: r.source_version,
      warehouseId: r.warehouse_id,
      locationId: r.location_id,
      barcode: r.barcode as string,
      name: r.product_name as string,
      unit: r.sale_unit as string,
      batch: (r.normalized_batch ?? r.batch) as string,
      quantity: integer(r.remaining_quantity ?? r.quantity),
      receivedQuantity:
        r.received_quantity == null ? null : integer(r.received_quantity),
      soldQuantity: r.sold_quantity == null ? null : integer(r.sold_quantity),
    };
  });
}
export function decodeMovements(v: unknown): StockPage<Movement> {
  return decodePage(v, (r) => {
    if (
      !id(r.receiving_id) ||
      !id(r.warehouse_id) ||
      !id(r.location_id) ||
      ![
        "barcode",
        "product_name",
        "sale_unit",
        "movement_id",
        "normalized_batch",
        "created_at",
      ].every((k) => typeof r[k] === "string") ||
      !["STOCK_IN", "SALE_OUT"].includes(String(r.type)) ||
      !Number.isFinite(new Date(r.created_at as string).getTime())
    )
      return invalid();
    const delta = integer(r.quantity_delta, true);
    if (
      (r.type === "STOCK_IN" && BigInt(delta) <= BigInt(0)) ||
      (r.type === "SALE_OUT" && BigInt(delta) >= BigInt(0))
    )
      return invalid();
    return {
      id: r.movement_id as string,
      receivingId: r.receiving_id,
      warehouseId: r.warehouse_id,
      locationId: r.location_id,
      barcode: r.barcode as string,
      name: r.product_name as string,
      unit: r.sale_unit as string,
      batch: r.normalized_batch as string,
      delta,
      type: r.type as Movement["type"],
      createdAt: r.created_at as string,
    };
  });
}
function decodePage<T>(
  v: unknown,
  row: (r: Record<string, unknown>) => T,
): StockPage<T> {
  if (
    !object(v) ||
    !Array.isArray(v.content) ||
    !count(v.page) ||
    !id(v.size) ||
    !count(v.totalElements)
  )
    return invalid();
  return {
    content: v.content.map((r) => (object(r) ? row(r) : invalid())),
    page: v.page,
    size: v.size,
    totalElements: v.totalElements,
  };
}
export function decodeProducts(v: unknown): PosProduct[] {
  if (!Array.isArray(v)) return invalid();
  return v.map((p) => {
    if (!object(p) || !id(p.id) || typeof p.product_name !== "string")
      return invalid();
    return {
      id: p.id,
      name: p.product_name,
      barcode: typeof p.barcode === "string" ? p.barcode : "",
      sku: typeof p.sku === "string" ? p.sku : "",
    };
  });
}
export function decodeReceiptOptions(v: unknown): {
  content: ReceiptOption[];
  page: number;
  totalPages: number;
} {
  if (
    !object(v) ||
    !Array.isArray(v.content) ||
    !count(v.number) ||
    !count(v.totalPages)
  )
    return invalid();
  return {
    page: v.number,
    totalPages: v.totalPages,
    content: v.content.map((r) => {
      if (
        !object(r) ||
        r.status !== "CONFIRMED" ||
        !id(r.id) ||
        !id(r.warehouseId) ||
        !id(r.locationId) ||
        !object(r.snapshot) ||
        typeof r.snapshot.productName !== "string" ||
        !["receivingNumber", "barcode", "batch", "saleUnit"].every(
          (k) => typeof r[k] === "string",
        )
      )
        return invalid();
      return {
        id: r.id,
        receivingNumber: r.receivingNumber as string,
        barcode: r.barcode as string,
        name: r.snapshot.productName,
        batch: r.batch as string,
        unit: r.saleUnit as string,
        actualQuantity: integer(r.actualQuantity),
        warehouseId: r.warehouseId,
        locationId: r.locationId,
      };
    }),
  };
}
