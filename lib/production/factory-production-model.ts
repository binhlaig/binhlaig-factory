import type { Receipt } from "@/lib/receiving-bulk-api";
import type { WarehouseBalance } from "@/lib/warehouse/factory-warehouse-bulk";
import { quantity, stockKey } from "@/lib/warehouse/factory-warehouse-bulk";
export type Source = { balance: WarehouseBalance; receipt: Receipt };
export type Draft = {
  id: string;
  revision: number;
  sourceKey: string;
  packages: string;
  actual: string;
  waste: string;
  reason: string;
  batch: string;
  date: string;
  staff: string;
  note: string;
  updatedAt: string;
};
const SCALE = BigInt(1000000);
export function decimal(v: unknown): bigint {
  const s =
    typeof v === "number" &&
    Number.isFinite(v) &&
    Math.abs(v) <= Number.MAX_SAFE_INTEGER
      ? String(v)
      : v;
  if (typeof s !== "string" || !/^\d{1,30}(?:\.\d{1,6})?$/.test(s))
    throw Error("ပမာဏကို အပေါင်းကိန်း၊ ဒဿမ ၆ နေရာအထိ ဖြည့်ပါ။");
  const [w, f = ""] = s.split(".");
  return BigInt(w) * SCALE + BigInt(f.padEnd(6, "0"));
}
export function plain(v: bigint): string {
  const sign = v < BigInt(0) ? "-" : "",
    abs = v < BigInt(0) ? -v : v;
  const f = String(abs % SCALE)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${sign}${abs / SCALE}${f ? `.${f}` : ""}`;
}
function multiply(a: bigint, b: bigint) {
  const n = a * b;
  if (n % SCALE) throw Error("တွက်ချက်ရလဒ်သည် ဒဿမ ၆ နေရာထက် ကျော်နေပါသည်။");
  return n / SCALE;
}
export function whole(v: string): bigint {
  if (!/^[1-9]\d{0,23}$/.test(v))
    throw Error(
      "ထုတ်လုပ်ရရှိမှုကို အပေါင်းအပြည့်ကိန်း၊ အများဆုံး ၂၄ လုံး ဖြည့်ပါ။",
    );
  return BigInt(v);
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function validDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "1900-01-01") return false;
  const d = new Date(v + "T12:00:00");
  return (
    Number.isFinite(+d) &&
    d.getFullYear() === Number(v.slice(0, 4)) &&
    d.getMonth() + 1 === Number(v.slice(5, 7)) &&
    d.getDate() === Number(v.slice(8, 10))
  );
}
export function fresh(source: Source, staff: string): Draft {
  const id = crypto.randomUUID();
  return {
    id,
    revision: 0,
    sourceKey: stockKey(source.balance),
    packages: "1",
    actual: "",
    waste: "",
    reason: "",
    batch: `FG-${today().replace(/-/g, "")}-${id.slice(0, 6).toUpperCase()}`,
    date: today(),
    staff,
    note: "",
    updatedAt: "",
  };
}
export function plan(source: Source, form: Draft) {
  const b = source.balance,
    r = source.receipt,
    bulk = r.snapshot.bulk!;
  const inputs = r.snapshot.inputs;
  const countType = ["COUNT", "BOTTLED_DRINK", "PACKAGED_SNACK"].includes(
    r.snapshot.productType,
  );
  const per = decimal(bulk.quantityPerPackage);
  let basis = countType
    ? multiply(decimal(inputs?.containers), decimal(inputs?.unitsPerContainer))
    : decimal(inputs?.weightKg ?? bulk.quantityPerPackage);
  if (basis <= BigInt(0) || per <= BigInt(0))
    throw Error("Costing မူလတွက်ချက်ပမာဏ မပြည့်စုံပါ။");
  if (!/^[1-9]\d{0,11}$/.test(form.packages))
    throw Error("ထုတ်ယူမည့်အထုပ်ကို အပြည့်ကိန်း၊ အများဆုံး ၁၂ လုံး ဖြည့်ပါ။");
  const packages = decimal(form.packages);
  if (packages <= BigInt(0))
    throw Error("ထုတ်ယူမည့် အထုပ်အရေအတွက်ကို သုညထက်ကြီးသောပမာဏ ဖြည့်ပါ။");
  const used = multiply(packages, per),
    balance = decimal(b.quantity);
  if (countType && used % SCALE)
    throw Error("ခု / ဘူး အရေအတွက်သည် အပြည့်ကိန်း ဖြစ်ရပါမည်။");
  const units = BigInt(r.expectedQuantity);
  if (units <= BigInt(0)) throw Error("Costing ရည်မှန်းချက် မရှိပါ။");
  const expected = (units * used) / basis;
  let packageBase = decimal(r.snapshot.packageSize);
  const unit = r.snapshot.packageSizeUnit;
  if (
    (unit === "g" && bulk.baseUnit === "kg") ||
    (unit === "ml" && bulk.baseUnit === "L")
  ) {
    if (packageBase % BigInt(1000))
      throw Error("ထုပ်ပိုးပမာဏ precision မကိုက်ပါ။");
    packageBase /= BigInt(1000);
  } else if (!(countType && unit === "unit") && unit !== bulk.baseUnit)
    throw Error("Costing ထုပ်ပိုးယူနစ်နှင့် Bulk ယူနစ် မကိုက်ပါ။");
  if (packageBase <= BigInt(0))
    throw Error("Costing တစ်ထုပ်ပါပမာဏ လိုအပ်ပါသည်။");
  const actual = form.actual ? whole(form.actual) : null;
  const waste = form.waste ? decimal(form.waste) : null;
  const residual =
    actual !== null && waste !== null
      ? used - actual * packageBase - waste
      : null;
  const standardResidual = basis - units * packageBase;
  if (standardResidual < BigInt(0))
    throw Error(
      "ဤ Costing တွင် ထပ်ပေါင်းကုန်ကြမ်း သို့မဟုတ် ယူနစ်ပြောင်းလဲမှုကို စစ်ရန်လိုပါသည်။",
    );
  return {
    used,
    remaining: balance - used,
    expected,
    actual,
    waste,
    residual,
    basis,
    per,
    packageBase,
    standardResidual,
    variance: actual === null ? null : actual - expected,
    counted: countType,
  };
}
export function validate(
  source: Source | null,
  form: Draft | null,
  review = false,
): string[] {
  if (!source || !form) return ["Warehouse ပစ္စည်း / Batch ကို အရင်ရွေးပါ။"];
  const errors: string[] = [];
  try {
    const p = plan(source, form);
    if (p.remaining < BigInt(0))
      errors.push("ဂိုဒေါင်လက်ကျန်ထက် ပိုထုတ်ယူ၍မရပါ။");
    if (p.actual !== null && p.actual * p.packageBase > p.used)
      errors.push("ထုတ်ကုန်ပမာဏသည် ထုတ်ယူပမာဏထက် ပိုနေပါသည်။");
    if (p.waste !== null && p.waste > p.used)
      errors.push("အလေအလွင့်သည် ထုတ်ယူပမာဏထက် ပိုနေပါသည်။");
    if (p.residual !== null && p.residual !== BigInt(0))
      errors.push("ထုတ်ကုန်နှင့် အလေအလွင့်ပေါင်းသည် ထုတ်ယူပမာဏနှင့် မညီသေးပါ။");
    if (p.variance !== null && p.variance !== BigInt(0) && !form.reason.trim())
      errors.push("ကွာခြားရသည့်အကြောင်းရင်း ဖြည့်ပါ။");
    if (review) {
      if (p.actual === null)
        errors.push("တကယ်ထုတ်လုပ်ရရှိသော အထုပ်အရေအတွက် ဖြည့်ပါ။");
      if (p.waste === null)
        errors.push("တကယ်အလေအလွင့် ဖြည့်ပါ။ မရှိလျှင် 0 ဖြည့်ပါ။");
      if (p.residual !== null && p.residual !== BigInt(0))
        errors.push(
          p.residual < BigInt(0)
            ? "ထုတ်ကုန်နှင့် အလေအလွင့် ပေါင်းပမာဏသည် ထုတ်ယူပမာဏထက် ပိုနေပါသည်။"
            : "ထုတ်ယူပမာဏ၊ ထုတ်ကုန်နှင့် အလေအလွင့် မညီသေးပါ။ ကျန်ပမာဏကို ပြန်စစ်ပါ။",
        );
      if (
        p.variance !== null &&
        p.variance !== BigInt(0) &&
        !form.reason.trim()
      )
        errors.push("ရည်မှန်းချက်နှင့် ကွာခြားရသည့်အကြောင်းရင်း ဖြည့်ပါ။");
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "ပမာဏစစ်ပါ။");
  }
  if (!form.batch.trim() || form.batch.length > 100)
    errors.push("Output Batch 1–100 စာလုံး ဖြည့်ပါ။");
  if (!validDate(form.date)) errors.push("ထုတ်လုပ်ရက် စစ်ပါ။");
  if ((review && !form.staff.trim()) || form.staff.length > 200)
    errors.push("တာဝန်ခံအမည် ဖြည့်ပါ။");
  if (form.reason.length > 500 || form.note.length > 2000)
    errors.push("မှတ်ချက် စာသားရှည်လွန်းပါသည်။");
  return [...new Set(errors)];
}
export function decodeDrafts(raw: string | null): Draft[] {
  if (raw === null) return [];
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    throw Error("မူကြမ်းဒေတာ ဖတ်မရပါ။ မူလဒေတာကို မရေးထပ်ပါ။");
  }
  if (v?.schema !== 1 || !Array.isArray(v.records) || v.records.length > 200)
    throw Error("မူကြမ်းဒေတာ ဖတ်မရပါ။ ရှိပြီးသားကို မရေးထပ်ပါ။");
  const seen = new Set<string>();
  return v.records.map((r: Draft) => {
    if (
      !r ||
      [
        "id",
        "sourceKey",
        "packages",
        "actual",
        "waste",
        "reason",
        "batch",
        "date",
        "staff",
        "note",
        "updatedAt",
      ].some(
        (k) => typeof (r as unknown as Record<string, unknown>)[k] !== "string",
      ) ||
      !r.id ||
      seen.has(r.id) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      !Number.isFinite(Date.parse(r.updatedAt))
    )
      throw Error("မူကြမ်းဒေတာ ပျက်နေပါသည်။");
    seen.add(r.id);
    return r;
  });
}
export const fmt = (v: bigint | null | undefined) =>
  v == null ? "—" : quantity(plain(v));
