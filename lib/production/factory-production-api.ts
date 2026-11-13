import { requestJson, StockError } from "@/lib/warehouse/factory-stock-api";
import { decodeReceipt, type Receipt } from "@/lib/receiving-bulk-api";
import { stockKey } from "@/lib/warehouse/factory-warehouse-bulk";
import { type Draft, type Source } from "@/lib/production/factory-production-model";
export type Save = {
  costingSheetId: number;
  costingItemId: number;
  sourceVersion: number;
  warehouseId: number;
  locationId: number;
  sourceBatch: string;
  bulkPackageCount: string;
  actualOutputQuantity: string | null;
  actualWasteQuantity: string | null;
  varianceReason: string;
  outputBatch: string;
  productionDate: string;
  responsibleName: string;
  note: string;
  version?: number;
};
export type Production = Save & {
  id: number;
  version: number;
  productionNumber: string;
  sourceReceivingId: number;
  snapshot: Receipt["snapshot"];
  barcode: string;
  currency: string;
  saleUnit: string;
  baseUnit: string;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  consumedBaseQuantity: string;
  expectedOutputQuantity: string;
  outputPackageBaseQuantity: string;
  variance: string | null;
  updatedAt: string;
  confirmedAt: string | null;
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min = 0) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
export function decodeProduction(v: unknown): Production {
  if (
    !obj(v) ||
    ![
      "id",
      "costingSheetId",
      "costingItemId",
      "warehouseId",
      "locationId",
      "sourceReceivingId",
    ].every((k) => integer(v[k], 1)) ||
    !integer(v.version) ||
    !integer(v.sourceVersion) ||
    !["DRAFT", "CONFIRMED", "CANCELLED"].includes(String(v.status)) ||
    ![
      "productionNumber",
      "sourceBatch",
      "outputBatch",
      "productionDate",
      "barcode",
      "currency",
      "saleUnit",
      "baseUnit",
      "updatedAt",
    ].every((k) => typeof v[k] === "string") ||
    !obj(v.snapshot) ||
    !obj(v.snapshot.bulk) ||
    v.snapshot.bulk.contractVersion !== 1 ||
    ![
      "bulkPackageCount",
      "consumedBaseQuantity",
      "expectedOutputQuantity",
      "outputPackageBaseQuantity",
    ].every(
      (k) =>
        typeof v[k] === "string" && /^\d+(?:\.\d{1,6})?$/.test(v[k] as string),
    ) ||
    !["actualOutputQuantity", "actualWasteQuantity"].every(
      (k) =>
        v[k] === null ||
        (typeof v[k] === "string" &&
          /^\d+(?:\.\d{1,6})?$/.test(v[k] as string)),
    ) ||
    !(
      v.variance === null ||
      (typeof v.variance === "string" && /^-?\d+$/.test(v.variance))
    ) ||
    (v.status === "CONFIRMED" &&
      (v.actualOutputQuantity === null ||
        v.actualWasteQuantity === null ||
        typeof v.confirmedAt !== "string"))
  )
    throw new StockError("Production API response ပုံစံမမှန်ပါ။", 502, true);
  for (const k of ["varianceReason", "responsibleName", "note"])
    if (v[k] !== null && typeof v[k] !== "string")
      throw new StockError("Production text မမှန်ပါ။", 502, true);
  return {
    ...v,
    varianceReason: v.varianceReason ?? "",
    responsibleName: v.responsibleName ?? "",
    note: v.note ?? "",
  } as Production;
}
const root = "/api/factory/productions";
export const getProduction = async (id: number) =>
  decodeProduction(await requestJson(`${root}/${id}`));
export async function historyPage(page: number, status = "") {
  const v = await requestJson(
    `${root}?page=${page}&size=6${status ? `&status=${encodeURIComponent(status)}` : ""}`,
  );
  if (
    !obj(v) ||
    !Array.isArray(v.content) ||
    !integer(v.totalElements) ||
    !integer(v.number) ||
    !integer(v.totalPages)
  )
    throw new StockError("Production history ဖတ်မရပါ။", 502);
  return {
    content: v.content.map(decodeProduction),
    totalElements: v.totalElements as number,
    totalPages: v.totalPages as number,
  };
}
export function saveBody(source: Source, form: Draft, version?: number): Save {
  const r = source.receipt;
  return {
    costingSheetId: r.costingSheetId,
    costingItemId: r.costingItemId,
    sourceVersion: r.sourceVersion,
    warehouseId: r.warehouseId,
    locationId: r.locationId,
    sourceBatch: r.batch,
    bulkPackageCount: form.packages,
    actualOutputQuantity: form.actual || null,
    actualWasteQuantity: form.waste || null,
    varianceReason: form.reason,
    outputBatch: form.batch,
    productionDate: form.date,
    responsibleName: form.staff,
    note: form.note,
    ...(version === undefined ? {} : { version }),
  };
}
export type Operation = {
  method: "POST" | "PUT";
  path: string;
  key: string;
  body: Save | { version: number };
};
export function decodeOperation(raw: string): Operation {
  const v: unknown = JSON.parse(raw);
  if (
    !obj(v) ||
    !["POST", "PUT"].includes(String(v.method)) ||
    typeof v.path !== "string" ||
    !/^\/api\/factory\/productions(?:\/[1-9]\d*(?:\/confirm)?)?$/.test(
      v.path,
    ) ||
    typeof v.key !== "string" ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(v.key) ||
    !obj(v.body) ||
    (v.method === "PUT" &&
      !/^\/api\/factory\/productions\/[1-9]\d*$/.test(v.path))
  )
    throw new Error(
      "ယခင် request မှတ်တမ်း မမှန်ပါ။ မူလ data ကို မဖျက်ဘဲ စစ်ပါ။",
    );
  return v as Operation;
}
export async function perform(
  op: Operation,
  recovering = false,
): Promise<Production> {
  // PUT has no idempotency header contract. Resolve an uncertain PUT before retrying it.
  if (recovering && op.method === "PUT") {
    const current = await getProduction(Number(op.path.split("/").pop()));
    const body = op.body as Save;
    if (current.version !== body.version) {
      const same = Object.entries(body)
        .filter(([k]) => k !== "version")
        .every(([k, value]) => {
          const actual = current[k as keyof Production];
          const canonical = (value: string) =>
            value.includes(".")
              ? value.replace(/0+$/, "").replace(/\.$/, "")
              : value;
          return typeof actual === "string" &&
            typeof value === "string" &&
            /^\d+(?:\.\d+)?$/.test(value) &&
            /^\d+(?:\.\d+)?$/.test(actual)
            ? canonical(actual) === canonical(value)
            : actual === value;
        });
      if (current.version === (body.version ?? -1) + 1 && same) return current;
      throw new StockError(
        "Production ကို အခြားနေရာမှ ပြင်ထားပါသည်။ Server မှ ပြန်ဖွင့်ပြီး စစ်ပါ။",
        409,
      );
    }
  }
  const result = decodeProduction(
    await requestJson(op.path, {
      method: op.method,
      body: JSON.stringify(op.body),
      headers: { "Idempotency-Key": op.key },
    }),
  );
  if (op.path.endsWith("/confirm") && result.status !== "CONFIRMED")
    throw new StockError("Server က အတည်မပြုသေးပါ။", 502, true);
  return result;
}
export function formOf(p: Production): Draft {
  return {
    id: String(p.id),
    revision: p.version + 1,
    sourceKey: stockKey({
      itemId: p.costingItemId,
      sourceVersion: p.sourceVersion,
      warehouseId: p.warehouseId,
      locationId: p.locationId,
      batch: p.sourceBatch,
    }),
    packages: p.bulkPackageCount,
    actual: p.actualOutputQuantity ?? "",
    waste: p.actualWasteQuantity ?? "",
    reason: p.varianceReason,
    batch: p.outputBatch,
    date: p.productionDate,
    staff: p.responsibleName,
    note: p.note,
    updatedAt: p.updatedAt,
  };
}
export async function savedSource(
  p: Production,
  catalog: Source[],
): Promise<Source> {
  // The saved source is valid even when all Bulk stock has since been consumed.
  const receipt = decodeReceipt(
    await requestJson(`/api/factory/receivings/${p.sourceReceivingId}`),
  );
  if (
    receipt.costingSheetId !== p.costingSheetId ||
    receipt.costingItemId !== p.costingItemId ||
    receipt.sourceVersion !== p.sourceVersion ||
    receipt.stockKind !== "BULK"
  )
    throw new StockError("Production source မကိုက်ပါ။", 502);
  const snapshotReceipt = decodeReceipt({ ...receipt, snapshot: p.snapshot });
  const existing = catalog.find(
    (s) => stockKey(s.balance) === formOf(p).sourceKey,
  );
  return {
    receipt: snapshotReceipt,
    balance: existing?.balance ?? {
      itemId: p.costingItemId,
      sourceVersion: p.sourceVersion,
      warehouseId: p.warehouseId,
      locationId: p.locationId,
      batch: p.sourceBatch,
      barcode: p.barcode,
      name: p.snapshot.productName,
      unit: p.baseUnit,
      quantity: "0",
      receivedQuantity: null,
      soldQuantity: null,
      stockKind: "BULK",
      packageUnit: p.snapshot.bulk!.packageUnit,
      quantityPerPackage: p.snapshot.bulk!.quantityPerPackage,
      imageUrls: [
        `/api/factory/costings/${p.costingSheetId}/items/${p.costingItemId}/images/ORIGINAL?v=${p.sourceVersion}`,
      ],
    },
  };
}
