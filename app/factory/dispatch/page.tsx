"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useZxing } from "react-zxing";
import JsBarcode from "jsbarcode";
import { motion } from "motion/react";
import { Truck, Package, Barcode, Camera, RefreshCw, MapPin, Phone, AlertCircle, Save, Printer, History, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter, DrawerClose } from "@/components/ui/drawer";

// Dispatch APIs verified against backend commit 3e1015da95cb85a2afe2d555cc42060171c29214.
// Stock changes only after the server commits a Dispatch confirmation.
type Line = {
  costingSheetId: number; costingItemId: number; sourceVersion: number;
  warehouseId: number; locationId: number; batch: string;
  productName: string; barcode: string; packageSize: number; packageSizeUnit: string;
  saleUnit: string; currency: string; unitPrice: string; quantity: string;
  orderLineReference: string; orderedQuantity: string; dispatchedQuantity: string|null; remainingToDispatchQuantity: string|null; outstandingReservedQuantity: string|null;
};
type Order = {
  id: string; orderNumber: string; status: "DRAFT" | "CONFIRMED" | "CANCELLED"; version: number;
  fulfillmentRevision:number; fulfillmentStatus:"NOT_DISPATCHED"|"PARTIALLY_DISPATCHED"|"DISPATCHED"|"UNKNOWN";
  customer: { id: string; name: string; code: string; type: "SHOP" | "CUSTOMER" };
  deliveryDate: string; phone: string; address: string; note: string; currency: string; total: string; lines: Line[];
};
type Pick = { quantity: string; checked: boolean; scans: number };
type Plan = {
  serverId?:string; serverVersion?:number; serverStatus?:"DRAFT"|"CONFIRMED"|"CANCELLED"; dispatchNumber?:string; fulfillmentRevision?:number;
  schema: 1; kind: "BROWSER_DISPATCH_PLAN"; id: string; scope: string; revision: number;
  orderId: string; orderNumber: string; customerName: string; orderVersion: number; signature: string;
  shipDate: string; driver: string; driverPhone: string; vehicle: string; note: string;
  picks: Record<string, Pick>; updatedAt: string;
};
const SCALE = BigInt(1000000), PAGE_SIZE = 8;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
function quantity(raw: string): bigint | null { return /^(?:0|[1-9]\d{0,23})$/.test(raw) ? BigInt(raw) : null; }
// Normalize only editable quantity text. API values remain strictly validated.
function quantityInput(raw: string): string {
  const ascii = raw.replace(/[\u1040-\u1049]/g, c => String(c.charCodeAt(0) - 0x1040)).trim();
  return /^\d+$/.test(ascii) ? ascii.replace(/^0+(?=\d)/, "") : ascii;
}
function quantityIssue(l: Line, raw: string): string | null {
  const max = limit(l), q = quantity(raw);
  if (max === null) return "လက်ရှိ ပို့ရန်ကျန်ပမာဏ မရသေးပါ။ စာရင်းပြန်တင်ပြီး စစ်ပါ။";
  if (max === BigInt(0)) {
    if (q === BigInt(0)) return null;
    return l.remainingToDispatchQuantity === "0"
      ? "ဤပစ္စည်းကို အပြည့်ပို့ပြီးဖြစ်ပါသည်။ ယခုပို့မည့်ပမာဏကို 0 ထားပါ။"
      : "ပို့ရန်ကျန်သော်လည်း အော်ဒါအတွက် ကြိုဖယ်ထားသောပမာဏ 0 ဖြစ်နေပါသည်။ ယခုပမာဏကို 0 ထားပြီး Order Reservation ကို စစ်ပါ။";
  }
  if (q === null) return `0 မှ ${units(max)} အတွင်း အပြည့်ကိန်း ဖြည့်ပါ။ မြန်မာဂဏန်းလည်း သုံးနိုင်ပါသည်။`;
  return q > max ? `ယခုပို့နိုင်သော ${units(max)} ${l.saleUnit} ထက် ကျော်နေပါသည်။` : null;
}
function decimal(raw: string): bigint {
  if (!/^\d{1,24}(?:\.\d{1,6})?$/.test(raw)) throw new Error("ငွေကြေးပုံစံ မမှန်ပါ။");
  const [w, f = ""] = raw.split("."); return BigInt(w) * SCALE + BigInt(f.padEnd(6, "0"));
}
function money(raw: bigint, currency: string) {
  const fraction = (raw % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${(raw / SCALE).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} ${currency === "MMK" ? "ကျပ်" : currency}`;
}
function units(raw: string | bigint) { return BigInt(raw).toLocaleString("en-US"); }
function lineKey(l: Line) { return JSON.stringify([l.costingItemId, l.sourceVersion, l.warehouseId, l.locationId, l.batch.trim().toUpperCase()]); }
function signature(o: Order) { return JSON.stringify([o.id, o.version, o.fulfillmentRevision, o.status, o.customer.id, o.lines.map(l => [lineKey(l), l.quantity, l.unitPrice, l.currency])]); }
function validDate(raw: string) { return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw && Number(raw.slice(0,4)) >= 1900; }
function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function sessionScope(value: unknown): string | null {
  if (!object(value)) return null;
  const u = object(value.user) ? value.user : {}; let claims: Record<string, unknown> = {};
  if (typeof value.accessToken === "string") try {
    const p = value.accessToken.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    const parsed: unknown = JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,"="))); if (object(parsed)) claims = parsed;
  } catch { /* Claims scope local storage only; the BFF and Spring validate authentication. */ }
  const shop = u.shopId ?? value.shopId ?? claims.shopId ?? claims.shop_id;
  const account = u.id || u.userId || value.userId || claims.sub;
  return /^[1-9]\d*$/.test(String(shop ?? "")) && (typeof account === "number" || typeof account === "string") && String(account).trim()
    ? JSON.stringify([String(shop), String(u.accountType ?? claims.accountType ?? u.role ?? "ACCOUNT"), String(account)]) : null;
}
function decodeOrder(v: unknown): Order {
  if (!object(v) || !uuid(v.id) || !version(v.version) || !["DRAFT","CONFIRMED","CANCELLED"].includes(String(v.status)) || !object(v.customer) || !uuid(v.customer.id) || !["name","code"].every(k=>typeof (v.customer as Record<string,unknown>)[k] === "string") || !["SHOP","CUSTOMER"].includes(String(v.customer.type)) || !["orderNumber","deliveryDate","currency","total"].every(k=>typeof v[k] === "string") || !Array.isArray(v.lines) || !v.lines.length || v.lines.length>100) throw new Error("Order API အချက်အလက်ပုံစံ မမှန်ပါ။");
  const keys = new Set<string>();
  for (const l of v.lines) {
    if (!object(l) || !["costingSheetId","costingItemId","warehouseId","locationId"].every(k=>id(l[k])) || !version(l.sourceVersion) || !["batch","productName","barcode","packageSizeUnit","saleUnit","currency","quantity","unitPrice"].every(k=>typeof l[k] === "string") || typeof l.packageSize !== "number" || !Number.isFinite(l.packageSize) || l.packageSize<=0 || quantity(String(l.quantity)) === null || quantity(String(l.quantity))! <= BigInt(0) || l.currency !== v.currency) throw new Error("Order ပစ္စည်းစာရင်း ပုံစံမမှန်ပါ။");
    decimal(String(l.unitPrice)); const key = lineKey(l as Line); if (keys.has(key)) throw new Error("Order ပစ္စည်းလိုင်း ထပ်နေပါသည်။"); keys.add(key);
  }
  decimal(String(v.total));
  return { ...v, phone: typeof v.phone === "string" ? v.phone : "", address: typeof v.address === "string" ? v.address : "", note: typeof v.note === "string" ? v.note : "" } as Order;
}
function planPrefix(scope: string) { return `binhlaig:factory:dispatch-plan:v1:${encodeURIComponent(scope)}:`; }
function newPlan(o: Order, scope: string, revision = 0): Plan {
  return {schema:1,kind:"BROWSER_DISPATCH_PLAN",id:crypto.randomUUID(),scope,revision,orderId:o.id,orderNumber:o.orderNumber,customerName:o.customer.name,orderVersion:o.version,fulfillmentRevision:o.fulfillmentRevision,signature:signature(o),shipDate:validDate(o.deliveryDate)?o.deliveryDate:localDate(),driver:"",driverPhone:"",vehicle:"",note:"",picks:Object.fromEntries(o.lines.map(l=>[lineKey(l),{quantity:(limit(l)??BigInt(0)).toString(),checked:false,scans:0}])),updatedAt:""};
}
function decodePlan(raw: string, scope: string): Plan {
  const p:unknown=JSON.parse(raw);
  if(!object(p)||p.schema!==1||p.kind!=="BROWSER_DISPATCH_PLAN"||p.scope!==scope||!uuid(p.id)||!uuid(p.orderId)||!version(p.orderVersion)||!version(p.revision)||!["orderNumber","customerName","signature","shipDate","driver","driverPhone","vehicle","note","updatedAt"].every(k=>typeof p[k]==="string")||!object(p.picks)||Object.keys(p.picks).length>100)throw new Error("မူကြမ်းပုံစံ မမှန်ပါ။ မူလမှတ်တမ်းကို မဖျက်ထားပါ။");
  for(const v of Object.values(p.picks))if(!object(v)||typeof v.quantity!=="string"||quantity(v.quantity)===null||typeof v.checked!=="boolean"||!Number.isSafeInteger(v.scans)||Number(v.scans)<0)throw new Error("မူကြမ်းပစ္စည်းပုံစံ မမှန်ပါ။");
  return p as Plan;
}
function readPlans(scope: string) {
  const list:Plan[]=[];let invalid=0;
  for(const key of Object.keys(localStorage))if(key.startsWith(planPrefix(scope)))try{const p=decodePlan(localStorage.getItem(key)||"",scope);if(key!==planPrefix(scope)+p.orderId)throw new Error("Key mismatch");list.push(p);}catch{invalid++;}
  return {list:list.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),warning:invalid?`ဖတ်မရသော မူကြမ်း ${invalid} ခုကို မူလအတိုင်း ထိန်းထားပါသည်။`:""};
}
function outstandingOrder(o: Order): boolean {
  return o.fulfillmentStatus !== "DISPATCHED" && o.lines.some(l => l.remainingToDispatchQuantity !== null && (quantity(l.remainingToDispatchQuantity) ?? BigInt(0)) > BigInt(0));
}
function shortfallLines(o: Order, p: Plan): Line[] {
  return o.lines.filter(l => {
    const remaining = l.remainingToDispatchQuantity === null ? null : quantity(l.remainingToDispatchQuantity);
    const actual = quantity(p.picks[lineKey(l)]?.quantity ?? "0");
    return remaining !== null && actual !== null && actual < remaining;
  });
}
function planIssues(o: Order, p: Plan): string[] {
  const errors:string[]=[];let selected=0;
  if(o.status!=="CONFIRMED")errors.push("ဤ Order သည် အတည်ပြုထားသော အော်ဒါ မဟုတ်တော့ပါ။");
  if(o.id!==p.orderId || p.orderVersion!==o.version || p.fulfillmentRevision!==o.fulfillmentRevision)errors.push("Order / ပို့ရန်ကျန်ပမာဏ ပြောင်းထားပါသည်။ လက်ကျန်အသစ်ကို စစ်ပြီး မူကြမ်းပြန်သိမ်းပါ။");
  if(!validDate(p.shipDate))errors.push("ပို့မည့်ရက် မှန်ကန်စွာ ဖြည့်ပါ။");
  if(!p.driver.trim())errors.push("ပို့ဆောင်မည့်သူ / ယာဉ်မောင်းအမည် ဖြည့်ပါ။");
  if(p.driver.length>200||p.driverPhone.length>50||p.vehicle.length>100||p.note.length>2000)errors.push("စာသားအရှည် ကန့်သတ်ချက်ကျော်နေပါသည်။");
  for(const l of o.lines){const pick=p.picks[lineKey(l)],q=pick?quantity(pick.quantity):BigInt(0);
    const problem=quantityIssue(l,pick?.quantity??"0");if(problem)errors.push(`${l.productName}: ${problem}`);
    if(q===null)continue;
    if(q>BigInt(0))selected++;
  }
  if(shortfallLines(o,p).length&&!p.note.trim())errors.push("အပြည့်မပို့နိုင်သည့် အကြောင်းပြချက် ဖြည့်ပါ။");
  if(!selected)errors.push("ပို့ရန်ပြင်ဆင်မည့် ပစ္စည်း အနည်းဆုံးတစ်မျိုး ရွေးပါ။");return errors;
}
function escapeHtml(raw: string) { return raw.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }
type Slip = {
  id:string; orderId:string; dispatchNumber:string; status:"DRAFT"|"CONFIRMED"|"CANCELLED";
  version:number; orderVersion:number; fulfillmentRevision:number; confirmedFulfillmentRevision:number|null;
  clientDraftId:string|null; dispatchDate:string; responsibleName:string; phone:string; vehicle:string; note:string;
  orderSnapshot:{id:string;orderNumber:string;customer:Order["customer"];deliveryDate:string;phone:string;address:string;note:string;currency:string;total:string};
  lines:Line[];currency:string;total:string;updatedAt:string;confirmedAt:string|null;
};
type Command = {scope:string;path:string;method:"POST"|"PUT";body:string;key:string};
class DispatchError extends Error {
  constructor(public status:number,public code:string,public details:unknown,public uncertain=false){super(({
    OVER_DISPATCH:"ပို့ရန်ကျန်သောပမာဏထက် ကျော်နေပါသည်။ လက်ကျန်အသစ်ကို စစ်ပါ။",
    RESERVATION_SHORTAGE:"အော်ဒါအတွက် ကြိုဖယ်ထားသောပမာဏ မလုံလောက်ပါ။",
    STALE_VERSION:"ဤ Dispatch ကို အခြားနေရာမှ ပြင်ထားပါသည်။ မှတ်တမ်းမှ ပြန်ဖွင့်ပါ။",
    STALE_FULFILLMENT_REVISION:"အခြား Dispatch တစ်ခုမှ ထုတ်ပို့ပြီးဖြစ်ပါသည်။ လက်ကျန်အသစ်ကို ပြန်စစ်ပါ။",
    DRAFT_FULFILLMENT_STALE:"လက်ကျန်အသစ်နှင့် ကိုက်ညီအောင် မူကြမ်းကို ပြန်သိမ်းပြီးမှ အတည်ပြုပါ။",
    STALE_ORDER_VERSION:"Order version ပြောင်းထားပါသည်။ Order ကို ပြန်စစ်ပါ။",
    ORDER_NOT_CONFIRMED:"မူလ Order သည် အတည်ပြုထားသော အော်ဒါ မဟုတ်တော့ပါ။",
    INVALID_STATUS:"ဤအခြေအနေတွင် ဆက်လုပ်၍ မရပါ။ မှတ်တမ်းမှ ပြန်ဖွင့်စစ်ပါ။",
    STOCK_SHORTAGE:"ဂိုဒေါင် Stock မလုံလောက်ပါ။",INACTIVE_LOCATION:"ဂိုဒေါင် / နေရာကို ပိတ်ထားပါသည်။",
    CLIENT_DRAFT_CONFLICT:"ဤမူကြမ်းအတွက် Server Dispatch ရှိပြီးသားပါ။ ရှိပြီးသားမှတ်တမ်းကို ဖွင့်ပါ။",
    RESERVATION_HISTORY_MISMATCH:"Stock နှင့် Reservation မှတ်တမ်း မကိုက်ပါ။ စီမံခန့်ခွဲသူထံ စစ်ဆေးခိုင်းပါ။",
    AUTH_REQUIRED:"Login ပြန်ဝင်ပါ။",FORBIDDEN:"Factory Owner အကောင့်ဖြင့် ဝင်ရန်လိုပါသည်။",
  } as Record<string,string>)[code] || code);}
}
async function api(path:string,options:RequestInit={}):Promise<unknown>{
  let res:Response;
  try{res=await fetch(`/api/factory/dispatches${path}`,{...options,credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...options.headers},signal:options.signal??AbortSignal.timeout(30000)});}
  catch(e){if(options.signal?.aborted)throw e;throw new DispatchError(0,"ဆက်သွယ်မှု မပြည့်စုံပါ။ မူလ Request ကို ပြန်စမ်းပါ။",null,true);}
  const payload=await res.json().catch(()=>null);
  if(!res.ok)throw new DispatchError(res.status,payload?.code||payload?.message||(res.status===401?"AUTH_REQUIRED":res.status===403?"FORBIDDEN":`API error ${res.status}`),payload?.details,res.status>=500);
  if(payload===null)throw new DispatchError(502,"API response ဖတ်မရပါ။",null,true);return payload;
}
async function pages<T>(path:string,decode:(v:unknown)=>T,signal?:AbortSignal):Promise<T[]>{
  const all:T[]=[];
  for(let page=0;page<10000;page++){
    const p=await api(`${path}${path.includes("?")?"&":"?"}page=${page}&size=100`,{signal});
    if(!object(p)||!Array.isArray(p.content)||p.page!==page||p.size!==100||!version(p.totalElements))throw new Error("Dispatch pagination မမှန်ပါ။");
    all.push(...p.content.map(decode));if(all.length>=Number(p.totalElements))return all;
    if(!p.content.length)break;
  }
  throw new Error("စာရင်း အပြည့်မရပါ။ Refresh လုပ်ပါ။");
}
function decodeSource(v:unknown):Order{
  if(!object(v)||!version(v.fulfillmentRevision)||!["NOT_DISPATCHED","PARTIALLY_DISPATCHED","DISPATCHED"].includes(String(v.fulfillmentStatus)))throw new Error("Dispatch source ပုံစံမမှန်ပါ။");
  const o=decodeOrder({...v,id:v.orderId,version:v.orderVersion,status:v.orderStatus});
  if(o.status!=="CONFIRMED")throw new Error("အတည်ပြုပြီး Order မှသာ Dispatch ပြုလုပ်နိုင်ပါသည်။");
  const refs=new Set<string>();
  for(const l of o.lines){
    if(typeof l.orderLineReference!=="string"||!l.orderLineReference||refs.has(l.orderLineReference)||![l.orderedQuantity,l.dispatchedQuantity,l.remainingToDispatchQuantity,l.outstandingReservedQuantity].every(x=>typeof x==="string"&&quantity(x)!==null))throw new Error("Dispatch ပမာဏ / လိုင်းရည်ညွှန်းချက် မမှန်ပါ။");
    refs.add(l.orderLineReference);const ordered=BigInt(l.orderedQuantity!),shipped=BigInt(l.dispatchedQuantity!),remaining=BigInt(l.remainingToDispatchQuantity!),reserved=BigInt(l.outstandingReservedQuantity!);
    if(ordered!==BigInt(l.quantity)||ordered!==shipped+remaining||reserved>remaining)throw new Error("ပို့ပြီး၊ ပို့ရန်ကျန်ပမာဏ မကိုက်ပါ။");
  }
  return o;
}
function decodeSlip(v:unknown):Slip{
  if(!object(v)||!uuid(v.id)||!uuid(v.orderId)||!version(v.version)||!version(v.orderVersion)||!version(v.fulfillmentRevision)||!["DRAFT","CONFIRMED","CANCELLED"].includes(String(v.status))||typeof v.dispatchNumber!=="string"||!object(v.orderSnapshot)||!Array.isArray(v.lines))throw new Error("Dispatch မှတ်တမ်းပုံစံ မမှန်ပါ။");
  const snapshot=v.orderSnapshot;
  decodeOrder({...snapshot,id:v.orderId,version:v.orderVersion,status:"CONFIRMED",lines:v.lines});
  if(!["dispatchDate","responsibleName","currency","total","updatedAt"].every(k=>typeof v[k]==="string")||!validDate(String(v.dispatchDate))||v.currency!==snapshot.currency||(v.clientDraftId!==null&&!uuid(v.clientDraftId)))throw new Error("Dispatch ရက် / ဈေးနှုန်း / ID မမှန်ပါ။");
  const refs=new Set<string>();let calculated=BigInt(0);
  for(const l of v.lines as Line[]){if(typeof l.orderLineReference!=="string"||!l.orderLineReference||refs.has(l.orderLineReference)||typeof l.orderedQuantity!=="string"||quantity(l.orderedQuantity)===null||BigInt(l.quantity)>BigInt(l.orderedQuantity))throw new Error("Dispatch လိုင်းရည်ညွှန်းချက် မမှန်ပါ။");refs.add(l.orderLineReference);calculated+=decimal(l.unitPrice)*BigInt(l.quantity);}
  if(calculated!==decimal(String(v.total)))throw new Error("Dispatch စုစုပေါင်းငွေ မကိုက်ပါ။");
  return {...v,phone:typeof v.phone==="string"?v.phone:"",vehicle:typeof v.vehicle==="string"?v.vehicle:"",note:typeof v.note==="string"?v.note:""} as Slip;
}
function sourceFromSlip(d:Slip):Order{
  return decodeOrder({...d.orderSnapshot,id:d.orderId,status:"CONFIRMED",version:d.orderVersion,fulfillmentRevision:d.fulfillmentRevision,fulfillmentStatus:"UNKNOWN",lines:d.lines.map(l=>({...l,quantity:l.orderedQuantity,dispatchedQuantity:null,remainingToDispatchQuantity:null,outstandingReservedQuantity:null}))});
}
function planFromSlip(d:Slip,o:Order,scope:string,previous?:Plan|null):Plan{
  return {...newPlan(o,scope),id:d.clientDraftId||d.id,serverId:d.id,serverVersion:d.version,serverStatus:d.status,dispatchNumber:d.dispatchNumber,orderVersion:d.orderVersion,fulfillmentRevision:d.fulfillmentRevision,signature:signature(o),shipDate:d.dispatchDate,driver:d.responsibleName,driverPhone:d.phone,vehicle:d.vehicle,note:d.note,updatedAt:d.updatedAt,
    picks:Object.fromEntries(o.lines.map(l=>{const selected=d.lines.find(x=>x.orderLineReference===l.orderLineReference),old=previous?.picks[lineKey(l)];return [lineKey(l),{quantity:selected?.quantity||"0",checked:!!selected&&old?.quantity===selected.quantity&&!!old.checked,scans:old?.quantity===selected?.quantity?old?.scans||0:0}];}))};
}
function editable(p:Plan){return JSON.stringify([p.id,p.orderId,p.orderVersion,p.fulfillmentRevision,p.shipDate,p.driver,p.driverPhone,p.vehicle,p.note,Object.entries(p.picks).map(([key,v])=>[key,v.quantity])]);}
function limit(l:Line):bigint|null{
  if(l.remainingToDispatchQuantity==null||l.outstandingReservedQuantity==null)return null;
  const a=quantity(l.remainingToDispatchQuantity),b=quantity(l.outstandingReservedQuantity);return a===null||b===null?null:a<b?a:b;
}
function payload(o:Order,p:Plan){return {orderId:o.id,orderVersion:p.orderVersion,fulfillmentRevision:p.fulfillmentRevision,dispatchDate:p.shipDate,responsibleName:p.driver.trim(),phone:p.driverPhone.trim(),vehicle:p.vehicle.trim(),note:p.note.trim(),...(p.serverId?{version:p.serverVersion}:{clientDraftId:p.id}),lines:o.lines.filter(l=>(quantity(p.picks[lineKey(l)]?.quantity||"")||BigInt(0))>BigInt(0)).map(l=>({orderLineReference:l.orderLineReference,quantity:p.picks[lineKey(l)].quantity}))};}
function commandPrefix(scope:string){return `binhlaig:factory:dispatch-api:pending:v1:${encodeURIComponent(scope)}:`;}
function readCommands(scope:string):Command[]{
  return Object.keys(localStorage).filter(k=>k.startsWith(commandPrefix(scope))).sort().map(key=>{
    const c:unknown=JSON.parse(localStorage.getItem(key)||"null");
    if(!object(c)||c.scope!==scope||typeof c.path!=="string"||!/^$|^\/[a-f0-9-]{36}(?:\/(?:confirm|cancel))?$/i.test(c.path)||!["POST","PUT"].includes(String(c.method))||typeof c.body!=="string"||typeof c.key!=="string"||!/^[A-Za-z0-9._:-]{8,128}$/.test(c.key)||key!==commandPrefix(scope)+c.key)throw new Error("မပြီးဆုံးသေးသော Request မှတ်တမ်းကို စစ်ရန်လိုပါသည်။");
    JSON.parse(c.body);return c as Command;
  });
}
function fulfillmentLabel(o:Order){return ({NOT_DISPATCHED:"မပို့ရသေး",PARTIALLY_DISPATCHED:"တစ်စိတ်တစ်ပိုင်းပို့ပြီး",DISPATCHED:"ပို့ပြီး",UNKNOWN:"လက်ရှိအခြေအနေ မရသေး"} as Record<string,string>)[o.fulfillmentStatus]||"—";}
function slipDocument(d:Slip,barcode:string){
  if(d.status!=="CONFIRMED")throw new Error("အတည်ပြုပြီးသော Dispatch မှသာ ပို့စာ ထုတ်နိုင်ပါသည်။");
  const o=d.orderSnapshot,rows=d.lines;
  return `<!doctype html><html lang="my"><head><meta charset="utf-8"><title>${escapeHtml(d.dispatchNumber)}</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:"Myanmar Text","Noto Sans Myanmar",Pyidaungsu,sans-serif;color:#17263d;font-size:12px;line-height:1.8}h1{font-size:22px;margin:0}.head{display:flex;justify-content:space-between;gap:20px}.barcode svg{max-width:240px;height:75px}.stamp{border:1px solid #b5d9c0;background:#f0fdf4;padding:10px;margin:15px 0}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{border:1px solid #ccd4df;padding:8px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}small{color:#52637b}.foot{display:flex;justify-content:space-between;margin-top:45px}p{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><div class="head"><div><h1>BINHLAIG · ပစ္စည်းပို့စာ</h1><b>${escapeHtml(d.dispatchNumber)}</b><br>Order: ${escapeHtml(o.orderNumber)}</div><div class="barcode">${barcode}</div></div><div class="stamp">ထုတ်ပို့မှု အတည်ပြုပြီး · ${escapeHtml(d.confirmedAt||d.dispatchDate)}<br><small>ဤပို့စာသည် ငွေလက်ခံပြေစာ မဟုတ်ပါ။</small></div><p><b>ပို့မည့်သူ:</b> ${escapeHtml(o.customer.name)} · ${escapeHtml(o.customer.code)}<br><b>လိပ်စာ:</b> ${escapeHtml(o.address||"—")}<br><b>ဖုန်း:</b> ${escapeHtml(o.phone||"—")}<br><b>ပို့မည့်ရက်:</b> ${escapeHtml(d.dispatchDate)}<br><b>ပို့ဆောင်သူ:</b> ${escapeHtml(d.responsibleName)} · ${escapeHtml(d.phone||"—")}<br><b>ယာဉ်:</b> ${escapeHtml(d.vehicle||"—")}</p><table><thead><tr><th>ပစ္စည်း / Batch</th><th>ပို့သည့်ပမာဏ</th><th>ကျသင့်ငွေ</th></tr></thead><tbody>${rows.map(l=>`<tr><td>${escapeHtml(l.productName)}<br><small>${escapeHtml(`${l.packageSize} ${l.packageSizeUnit} · ${l.batch}`)}</small></td><td>${units(l.quantity)} ${escapeHtml(l.saleUnit)}</td><td>${escapeHtml(money(decimal(l.unitPrice)*BigInt(l.quantity),l.currency))}</td></tr>`).join("")}</tbody></table><p><b>ယခုထုတ်ပို့ပစ္စည်းတန်ဖိုး:</b> ${escapeHtml(money(decimal(d.total),d.currency))}</p><p>${escapeHtml(d.note)}</p><div class="foot"><span>ပို့ဆောင်သူ: __________________</span><span>လက်ခံသူ: __________________</span></div></body></html>`;
}

function ProductImage({line}:{line:Line}) {
  const [failed,setFailed]=React.useState(false);const src=`/api/factory/costings/${line.costingSheetId}/items/${line.costingItemId}/images/PACKAGED?v=${line.sourceVersion}`;
  React.useEffect(()=>setFailed(false),[src]);
  return <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted">{failed?<Package className="size-7 text-muted-foreground"/>:<img src={src} alt={line.productName} className="size-full object-cover" loading="lazy" onError={()=>setFailed(true)}/>}</div>;
}
function ScanCamera({onScan,onClose}:{onScan:(code:string)=>void;onClose:()=>void}) {
  const locked=React.useRef(false);const [paused,setPaused]=React.useState(false),[error,setError]=React.useState("");
  const {ref}=useZxing({paused,formats:["code_128"],trySkew:true,timeBetweenDecodingAttempts:250,constraints:{audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}},onDecodeResult(result){const code=result.rawValue?.trim();if(!code||locked.current)return;locked.current=true;setPaused(true);onScan(code);},onError(){setError("Camera permission နှင့် HTTPS ကို စစ်ပါ။");}});
  React.useEffect(()=>{const hidden=()=>{if(document.hidden)onClose();};document.addEventListener("visibilitychange",hidden);return()=>document.removeEventListener("visibilitychange",hidden);},[onClose]);
  return <div className="space-y-3"><video ref={ref} autoPlay muted playsInline className="aspect-video w-full rounded-2xl bg-black object-cover" aria-label="Dispatch barcode camera"/>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}

export default function DispatchPage() {
  const {data:session,status}=useSession();const scope=sessionScope(session),scopeRef=React.useRef(scope);scopeRef.current=scope;
  const [orders,setOrders]=React.useState<Order[]>([]),[order,setOrder]=React.useState<Order|null>(null),[plan,setPlan]=React.useState<Plan|null>(null),[slip,setSlip]=React.useState<Slip|null>(null);
  const [loading,setLoading]=React.useState(false),[opening,setOpening]=React.useState(false),[saving,setSaving]=React.useState(false),[printing,setPrinting]=React.useState(false),[error,setError]=React.useState("");
  const [page,setPage]=React.useState(0),[revision,setRevision]=React.useState(0),[base,setBase]=React.useState("");
  const [message,setMessage]=React.useState(""),[warning,setWarning]=React.useState(""),[conflict,setConflict]=React.useState(false),[plans,setPlans]=React.useState<Slip[]>([]),[legacy,setLegacy]=React.useState<Plan[]>([]);
  const [camera,setCamera]=React.useState(false),[history,setHistory]=React.useState(false),[sourceReady,setSourceReady]=React.useState(false);
  const [historyQuery,setHistoryQuery]=React.useState(""),[historyStatus,setHistoryStatus]=React.useState("ALL");
  const [command,setCommand]=React.useState<Command|null>(null),[storageBlocked,setStorageBlocked]=React.useState(false),[existingId,setExistingId]=React.useState<string|null>(null);
  const [pending,setPending]=React.useState<{kind:"order"|"dispatch";id:string}|{kind:"reset"|"confirm"|"cancel"|"review"}|{kind:"import";draft:Plan}|null>(null);
  const [scanResult,setScanResult]=React.useState<string|null>(null);
  const [scanFilter,setScanFilter]=React.useState("");
  const requestId=React.useRef(0),writeBusy=React.useRef(false),planRef=React.useRef(plan),orderRef=React.useRef(order);planRef.current=plan;orderRef.current=order;
  const busy=loading||opening,locked=!!plan?.serverStatus&&plan.serverStatus!=="DRAFT";
  const dirty=!!plan&&editable(plan)!==base,readonly=busy||saving||printing||!!command||storageBlocked;
  const closeCamera=React.useCallback(()=>setCamera(false),[]);
  const refreshPlans=React.useCallback(async()=>{
    if(!scope)return;const captured=scope;
    try{const list=await pages("",decodeSlip);if(scopeRef.current===captured)setPlans(list);}catch(e){if(scopeRef.current===captured)setWarning(e instanceof Error?e.message:"Dispatch မှတ်တမ်း မရပါ။");}
    try{const old=readPlans(scope);if(scopeRef.current===captured){setLegacy(old.list);if(old.warning)setWarning(old.warning);}}catch{if(scopeRef.current===captured)setWarning("ယခင် Browser မူကြမ်းများကို ဖတ်မရပါ။ မူလ data ကို မဖျက်ထားပါ။");}
  },[scope]);
  React.useEffect(()=>{
    ++requestId.current;setOrders([]);setOrder(null);setPlan(null);setSlip(null);planRef.current=null;orderRef.current=null;setBase("");setError("");setMessage("");setWarning("");setConflict(false);setPlans([]);setLegacy([]);setHistory(false);setCamera(false);setPending(null);setScanResult(null);setScanFilter("");setPage(0);setSaving(false);setPrinting(false);setSourceReady(false);setCommand(null);setStorageBlocked(false);setExistingId(null);setOpening(false);setHistoryQuery("");setHistoryStatus("ALL");
    if(scope)try{const commands=readCommands(scope);if(commands.length){setCommand(commands[0]);setMessage("မပြီးဆုံးသေးသော Request ရှိပါသည်။ မူလ Request ကို ပြန်စမ်းပါ။");}}catch(e){setStorageBlocked(true);setWarning(e instanceof Error?e.message:"Retry မှတ်တမ်း ဖတ်မရပါ။");}
    void refreshPlans();
  },[scope,refreshPlans]);
  React.useEffect(()=>{
    if(status!=="authenticated"||!scope||writeBusy.current)return;
    const controller=new AbortController();let active=true;setLoading(true);setError("");
    void pages("/sources",decodeSource,controller.signal).then(rows=>{
      if(!active)return;setOrders(rows);const selected=orderRef.current;
      if(selected){const current=rows.find(o=>o.id===selected.id);if(current){setOrder(current);orderRef.current=current;setSourceReady(true);}else setSourceReady(false);}
    }).catch(e=>{if(active){setSourceReady(false);setError(e instanceof Error?e.message:"Order စာရင်း မရပါ။");}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[scope,status,revision]);
  React.useEffect(()=>{
    const refresh=()=>{if(!document.hidden&&!writeBusy.current)setRevision(v=>v+1);};const timer=window.setInterval(refresh,30000);window.addEventListener("focus",refresh);window.addEventListener("factory-stock-changed",refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("factory-stock-changed",refresh);};
  },[scope]);
  const readSource=async(id:string)=>decodeSource(await api(`/sources/${id}`));
  const install=(o:Order,p:Plan,d:Slip|null,ready:boolean)=>{setOrder(o);orderRef.current=o;planRef.current=p;setPlan(p);setSlip(d);setBase(editable(p));setSourceReady(ready);setConflict(false);setHistory(false);setError("");setExistingId(null);};
  const installSlip=async(d:Slip,captured:string,previous?:Plan|null)=>{
    let o:Order,ready=true;
    try{o=await readSource(d.orderId);}catch{o=sourceFromSlip(d);ready=false;}
    if(scopeRef.current!==captured)return;
    install(o,planFromSlip(d,o,captured,previous),d,ready);
    if(!ready)setMessage("Dispatch မှတ်တမ်းကို ပြထားပါသည်။ မူလ Order ၏ လက်ရှိပမာဏ မရသေးပါ။ မူကြမ်းပြင်ရန် Order ကို ပြန်စစ်ပါ။");
  };
  const openOrder=async(orderId:string)=>{
    if(!scope||writeBusy.current||command)return;const captured=scope,request=++requestId.current;setOpening(true);setError("");setMessage("");
    try{const o=await readSource(orderId);if(request===requestId.current&&captured===scopeRef.current){if(!outstandingOrder(o)){setMessage("ဤအော်ဒါကို အပြည့်ပို့ပြီးဖြစ်ပါသည်။ ပို့ပြီးမှတ်တမ်းကို History တွင် ကြည့်ပါ။");setHistory(true);void refreshPlans();return;}install(o,newPlan(o,captured),null,true);}}
    catch(e){if(request===requestId.current&&captured===scopeRef.current)setError(e instanceof Error?e.message:"Order ဖွင့်မရပါ။");}
    finally{if(request===requestId.current&&captured===scopeRef.current)setOpening(false);}
  };
  const openDispatch=async(id:string)=>{
    if(!scope||writeBusy.current||command)return;const captured=scope,request=++requestId.current;setOpening(true);setMessage("");
    try{const d=decodeSlip(await api(`/${id}`));if(request===requestId.current&&captured===scopeRef.current)await installSlip(d,captured);}
    catch(e){if(request===requestId.current&&captured===scopeRef.current)setError(e instanceof Error?e.message:"Dispatch ဖွင့်မရပါ။");}
    finally{if(request===requestId.current&&captured===scopeRef.current)setOpening(false);}
  };
  const chooseOrder=(id:string)=>{if(readonly)return;if(dirty)setPending({kind:"order",id});else void openOrder(id);};
  const chooseDispatch=(id:string)=>{if(readonly)return;if(dirty)setPending({kind:"dispatch",id});else void openDispatch(id);};
  const patch=(value:Partial<Plan>)=>{const p=planRef.current;if(!p||p.scope!==scopeRef.current||readonly||locked||!sourceReady)return;const next={...p,...value};planRef.current=next;setPlan(next);setMessage("");};
  const updatePick=(line:Line,value:Partial<Pick>)=>{const p=planRef.current;if(!p)return;const key=lineKey(line),old=p.picks[key]||{quantity:"0",checked:false,scans:0};patch({picks:{...p.picks,[key]:{...old,...value}}});};
  const shortages=order&&plan&&!locked?shortfallLines(order,plan):[];
  const issues=order&&plan&&!locked?planIssues(order,plan):[],selectedLines=order?.lines.filter(l=>(quantity(plan?.picks[lineKey(l)]?.quantity||"")||BigInt(0))>BigInt(0))||[];
  const selectedUnits=selectedLines.reduce((n,l)=>n+(quantity(plan?.picks[lineKey(l)]?.quantity||"")||BigInt(0)),BigInt(0));
  const total=selectedLines.reduce((n,l)=>n+decimal(l.unitPrice)*(quantity(plan?.picks[lineKey(l)]?.quantity||"")||BigInt(0)),BigInt(0));
  const stale=!!order&&!!plan&&!locked&&(!sourceReady||plan.orderVersion!==order.version||plan.fulfillmentRevision!==order.fulfillmentRevision);
  const settle=(c:Command)=>{try{const key=commandPrefix(c.scope)+c.key;if(localStorage.getItem(key)===JSON.stringify(c))localStorage.removeItem(key);setCommand(readCommands(c.scope)[0]||null);}catch{setCommand(c);setWarning("Retry မှတ်တမ်း မရှင်းနိုင်သေးပါ။ Storage ကို စစ်ပါ။");}};
  const execute=async(c:Command)=>{
    if(writeBusy.current||scopeRef.current!==c.scope)return;writeBusy.current=true;setSaving(true);setMessage("");setExistingId(null);let persisted=false,mutationAccepted=false;
    try{
      const key=commandPrefix(c.scope)+c.key,old=localStorage.getItem(key);if(old&&old!==JSON.stringify(c))throw new Error("မူလ Request နှင့် မကိုက်ပါ။");localStorage.setItem(key,JSON.stringify(c));persisted=true;setCommand(c);
      const response=await api(c.path,{method:c.method,body:c.body,headers:{"Idempotency-Key":c.key}});mutationAccepted=true;const result=decodeSlip(response);
      // Durable replay responses can be historical. Read canonical state before enabling edits.
      const current=decodeSlip(await api(`/${result.id}`));if(scopeRef.current!==c.scope)return;
      await installSlip(current,c.scope,planRef.current);if(scopeRef.current!==c.scope)return;settle(c);
      setMessage(current.status==="CONFIRMED"?"ထုတ်ပို့မှု အတည်ပြုပြီးပါပြီ။ Stock နှင့် ကြိုဖယ်ထားသောပမာဏကို လျှော့ပြီးဖြစ်ပါသည်။":current.status==="CANCELLED"?"Dispatch မူကြမ်း ပယ်ဖျက်ပြီးပါပြီ။ Stock မပြောင်းပါ။":"Server တွင် Dispatch မူကြမ်း သိမ်းပြီးပါပြီ။ Stock မပြောင်းသေးပါ။");
      void refreshPlans();setRevision(v=>v+1);window.dispatchEvent(new Event("factory-stock-changed"));window.dispatchEvent(new Event("factory-packing-changed"));
    }catch(e){
      if(scopeRef.current!==c.scope)return;
      if(!persisted){setMessage("Retry မှတ်တမ်းကို မသိမ်းနိုင်သဖြင့် Server သို့ မပို့ရသေးပါ။ Browser Storage ကို စစ်ပါ။");return;}
      if(mutationAccepted){setMessage("Server သို့ Request ပို့ပြီးပါပြီ။ နောက်ဆုံးအခြေအနေကို မဖတ်ရသေးသဖြင့် မူလ Request ကို ပြန်စမ်းပါ။");return;}
      if(c.method==="PUT"&&e instanceof DispatchError&&e.uncertain){
        try{const current=decodeSlip(await api(c.path));if(scopeRef.current!==c.scope)return;if(current.version>JSON.parse(c.body).version){await installSlip(current,c.scope);settle(c);setMessage("Server ၏ နောက်ဆုံး Dispatch ကို ပြန်ဖတ်ပြီးပါပြီ။ ပြင်ဆင်မှုများကို စစ်ပါ။");void refreshPlans();return;}}catch{/* preserve exact unresolved PUT; never overwrite a newer server version */}
      }
      if(!(e instanceof DispatchError)||!e.uncertain)settle(c);
      if(e instanceof DispatchError){
        if(e.code==="STALE_VERSION")setConflict(true);
        if(e.code==="CLIENT_DRAFT_CONFLICT"&&object(e.details)&&uuid(e.details.dispatchId))setExistingId(e.details.dispatchId);
        if(["STALE_FULFILLMENT_REVISION","DRAFT_FULFILLMENT_STALE","STALE_ORDER_VERSION","OVER_DISPATCH","RESERVATION_SHORTAGE","ORDER_NOT_CONFIRMED"].includes(e.code)){
          setRevision(v=>v+1);const selected=planRef.current;if(selected)try{const current=await readSource(selected.orderId);if(scopeRef.current===c.scope){setOrder(current);orderRef.current=current;setSourceReady(true);}}catch{if(scopeRef.current===c.scope)setSourceReady(false);}
        }
      }
      setMessage(e instanceof Error?e.message:"Dispatch သိမ်းမရပါ။");
    }finally{writeBusy.current=false;if(scopeRef.current===c.scope)setSaving(false);}
  };
  const save=async()=>{
    const p=planRef.current,o=orderRef.current;if(!scope||!o||!p||readonly||locked||issues.length||stale||conflict)return;
    await execute({scope,path:p.serverId?`/${p.serverId}`:"",method:p.serverId?"PUT":"POST",body:JSON.stringify(payload(o,p)),key:crypto.randomUUID()});
  };
  const transition=async(action:"confirm"|"cancel")=>{
    const p=planRef.current;if(!scope||!p?.serverId||readonly||locked||writeBusy.current||action==="confirm"&&(dirty||issues.length||conflict))return;
    if(action==="confirm"){
      const captured=scope;writeBusy.current=true;setSaving(true);
      try{const current=await readSource(p.orderId);if(scopeRef.current!==captured)return;setOrder(current);orderRef.current=current;setSourceReady(true);if(current.version!==p.orderVersion||current.fulfillmentRevision!==p.fulfillmentRevision){setMessage("လက်ကျန်ပြောင်းထားပါသည်။ လက်ကျန်အသစ်ကို စစ်ပြီး မူကြမ်းပြန်သိမ်းပါ။");setPending({kind:"review"});return;}}
      catch(e){if(scopeRef.current===captured){setSourceReady(false);setMessage(e instanceof Error?e.message:"Order စစ်မရပါ။");}return;}
      finally{writeBusy.current=false;if(scopeRef.current===captured)setSaving(false);}
      if(scopeRef.current!==captured)return;
    }
    const body=action==="confirm"?{version:p.serverVersion,orderVersion:p.orderVersion,fulfillmentRevision:p.fulfillmentRevision}:{version:p.serverVersion};
    await execute({scope,path:`/${p.serverId}/${action}`,method:"POST",body:JSON.stringify(body),key:crypto.randomUUID()});
  };
  const review=()=>{
    const p=planRef.current,o=orderRef.current;if(!p||!o||!sourceReady||locked||readonly)return;
    patch({orderVersion:o.version,fulfillmentRevision:o.fulfillmentRevision,signature:signature(o),picks:Object.fromEntries(o.lines.map(l=>[lineKey(l),{quantity:p.picks[lineKey(l)]?.quantity||"0",checked:false,scans:0}]))});setMessage("လက်ကျန်အသစ်ကို ယူထားပါသည်။ ပမာဏကို စစ်ပြီး မူကြမ်းကို ပြန်သိမ်းပါ။");
  };
  const importLegacy=async(old:Plan)=>{
    if(!scope||readonly||writeBusy.current)return;const captured=scope;setOpening(true);
    try{const current=await readSource(old.orderId);if(scopeRef.current!==captured)return;
      const keys=new Set(current.lines.map(lineKey));if(Object.entries(old.picks).some(([k,v])=>(quantity(v.quantity)||BigInt(0))>BigInt(0)&&!keys.has(k)))throw new Error("ယခင်မူကြမ်းတွင် လက်ရှိ Order နှင့် မကိုက်သော ပစ္စည်းလိုင်း ရှိပါသည်။ မူလမှတ်တမ်းကို မဖျက်ထားပါ။");
      const next={...newPlan(current,captured),id:old.id,shipDate:old.shipDate,driver:old.driver,driverPhone:old.driverPhone,vehicle:old.vehicle,note:old.note,picks:Object.fromEntries(current.lines.map(l=>[lineKey(l),{quantity:old.picks[lineKey(l)]?.quantity||"0",checked:false,scans:0}]))};
      install(current,next,null,true);setBase("");setMessage("Browser မူကြမ်းကို ယူထားပါသည်။ လက်ရှိ ပို့ရန်ကျန်ပမာဏနှင့် Batch ကို စစ်ပြီး Server တွင် သိမ်းပါ။ မူလ Browser မှတ်တမ်းကို မဖျက်ထားပါ။");
    }catch(e){if(scopeRef.current===captured)setMessage(e instanceof Error?e.message:"မူကြမ်း ယူမရပါ။");}finally{if(scopeRef.current===captured)setOpening(false);}
  };
  const print=async()=>{
    if(!scope||!slip||slip.status!=="CONFIRMED"||readonly)return;
    const popup=window.open("","_blank","width=1000,height=800");if(!popup){setMessage("Print window ဖွင့်ရန် Browser popup permission ပေးပါ။");return;}
    const captured=scope;setPrinting(true);popup.document.write("<!doctype html><meta charset='utf-8'><p>Dispatch စစ်နေပါသည်…</p>");popup.document.close();
    try{const current=decodeSlip(await api(`/${slip.id}`));if(scopeRef.current!==captured){popup.close();return;}if(current.status!=="CONFIRMED")throw new Error("အတည်ပြုပြီး Dispatch မှသာ ပို့စာ ထုတ်နိုင်ပါသည်။");
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");JsBarcode(svg,current.dispatchNumber,{format:"CODE128",width:2,height:40,margin:5,displayValue:true});
      popup.document.open();popup.document.write(slipDocument(current,new XMLSerializer().serializeToString(svg)));popup.document.close();await popup.document.fonts.ready;await new Promise<void>(resolve=>popup.requestAnimationFrame(()=>popup.requestAnimationFrame(()=>resolve())));
      if(scopeRef.current!==captured){popup.close();return;}if(!popup.closed){popup.focus();popup.print();}
    }catch(e){if(!popup.closed)popup.close();if(scopeRef.current===captured)setMessage(e instanceof Error?e.message:"ပို့စာ ထုတ်မရပါ။");}finally{if(scopeRef.current===captured)setPrinting(false);}
  };
  const filtered=orders.filter(o=>outstandingOrder(o)&&(!scanFilter||[o.orderNumber,o.id,o.customer.code,o.customer.id].some(v=>v.trim().toUpperCase()===scanFilter)));
  const scanCode=(scanResult||"").trim().toUpperCase();
  const matchedOrders=scanCode?orders.filter(o=>outstandingOrder(o)&&(o.orderNumber.trim().toUpperCase()===scanCode||o.id.toUpperCase()===scanCode||o.customer.code.trim().toUpperCase()===scanCode||o.customer.id.toUpperCase()===scanCode)):[];
  const pagesCount=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)),currentPage=Math.min(page,pagesCount-1),visible=filtered.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  if(status==="loading")return <p role="status" className="p-6">Login အချက်အလက် စစ်နေပါသည်…</p>;
  if(status!=="authenticated")return <p role="alert" className="p-6">Dispatch အသုံးပြုရန် Login ဝင်ပါ။</p>;
  return <main className="mx-auto max-w-[1600px] space-y-5 p-4 pb-10 md:p-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Factory · Dispatch</p><h1 className="text-2xl font-bold leading-relaxed sm:text-3xl">ပစ္စည်းပို့ရန် ပြင်ဆင်ခြင်း</h1><p className="mt-1 text-sm leading-7 text-muted-foreground">အော်ဒါရွေးပါ။ ပစ္စည်းနှင့် Batch စစ်ပါ။ ပို့ရန်စာရင်း ပြင်ဆင်ပါ။</p></div><div className="flex flex-wrap gap-2"><motion.button type="button" disabled={readonly} onClick={()=>setCamera(true)} initial="rest" animate="rest" whileHover="hover" whileTap={{scale:.94}} aria-label="Order သို့မဟုတ် Customer ID Camera Scan ဖတ်ရန်" className="group flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"><motion.span variants={{rest:{rotate:0,scale:1},hover:{rotate:-8,scale:1.12}}} transition={{type:"spring",stiffness:350,damping:18}}><Camera className="size-4"/></motion.span><span className="text-sm font-medium">Scan</span><motion.span variants={{rest:{width:0,opacity:0},hover:{width:16,opacity:1}}} className="overflow-hidden"><Barcode className="size-4"/></motion.span></motion.button>{scanFilter&&<Button type="button" variant="ghost" onClick={()=>{setScanFilter("");setPage(0);}}>အားလုံးပြရန်</Button>}<Button variant="outline" onClick={()=>{refreshPlans();setHistory(true);}}><History className="mr-2 size-4"/>ပို့ဆောင်မှုမှတ်တမ်း</Button><Button variant="outline" disabled={busy||saving} onClick={()=>{setRevision(v=>v+1);refreshPlans();}} aria-label="Order စာရင်းပြန်တင်ရန်"><RefreshCw className={`mr-2 size-4 ${busy?"animate-spin":""}`}/>ပြန်တင်မည်</Button></div></header>
    {command&&<div role="status" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-7 text-amber-950 dark:bg-amber-950/30 dark:text-amber-200"><p>မပြီးဆုံးသေးသော Request ရှိပါသည်။ မူလ Request ကို ပြန်ပို့ပြီး Server အခြေအနေကို စစ်ပါ။</p><Button variant="outline" disabled={saving||busy||printing} onClick={()=>void execute(command)}>မူလ Request ပြန်စမ်းမည်</Button></div>}
    {existingId&&<Button variant="outline" disabled={readonly} onClick={()=>void openDispatch(existingId)}>ရှိပြီးသား Dispatch ဖွင့်မည်</Button>}
    {!scope&&<p role="alert" className="rounded-xl border p-4 text-destructive">Login ဆိုင်နှင့် အကောင့် ID မရသေးပါ။ မူကြမ်းသိမ်းရန် အချက်အလက်လိုအပ်ပါသည်။</p>}
    {error&&<p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-7 text-destructive">{error}</p>}
    {message&&<p role="status" className="flex items-start gap-2 rounded-xl border bg-muted/40 p-4 text-sm leading-7"><AlertCircle className="mt-1 size-4 shrink-0"/>{message}</p>}
    {warning&&<p role="alert" className="text-sm leading-7 text-amber-700 dark:text-amber-300">{warning}</p>}
    <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)] min-[73.75rem]:grid-cols-[240px_minmax(0,1fr)_280px] 2xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      <section className="min-w-0 space-y-3"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><ClipboardList className="size-4"/>ပို့ရန် Order</h2><Badge variant="secondary">{filtered.length}</Badge></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{visible.map(o=><button key={o.id} type="button" disabled={readonly} onClick={()=>chooseOrder(o.id)} className={`min-w-0 rounded-2xl border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${order?.id===o.id?"border-primary bg-primary/5 ring-1 ring-primary/20":"hover:border-primary/40"}`} aria-label={`${o.orderNumber} ဖွင့်ရန်`}><div className="flex items-center justify-between gap-2"><span className="font-mono text-sm font-semibold">{o.orderNumber}</span><Badge variant="outline" className="text-[10px]">{fulfillmentLabel(o)}</Badge></div><p className="mt-3 truncate font-semibold">{o.customer.name}</p><p className="mt-1 text-xs leading-6 text-muted-foreground">{o.deliveryDate} · {o.lines.length} မျိုး</p><p className="mt-2 text-sm font-bold text-primary">{money(decimal(o.total),o.currency)}</p></button>)}</div>{!visible.length&&<div className="rounded-2xl border border-dashed p-6 text-center text-sm leading-7 text-muted-foreground">{busy?"Order စာရင်း ရယူနေပါသည်…":scanFilter?"Scan နှင့်ကိုက်ညီသော ပို့ရန်အော်ဒါ မရှိပါ။ အားလုံးပြရန် နှိပ်နိုင်ပါသည်။":"ပို့ရန်ကျန်သော Order မရှိပါ။ ပို့ပြီးအော်ဒါများကို History တွင် ကြည့်နိုင်ပါသည်။"}</div>}<div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">{currentPage+1} / {pagesCount}</p><div className="flex gap-1"><Button variant="outline" size="icon" aria-label="ယခင် Order စာမျက်နှာ" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}><ChevronLeft className="size-4"/></Button><Button variant="outline" size="icon" aria-label="နောက် Order စာမျက်နှာ" disabled={currentPage+1>=pagesCount} onClick={()=>setPage(currentPage+1)}><ChevronRight className="size-4"/></Button></div></div></section>
      <section className="min-w-0 space-y-4">{!order||!plan?<div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed bg-muted/10 px-6 text-center"><span className="mb-4 flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary"><Truck className="size-10"/></span><h2 className="text-lg font-semibold">ပို့ရန် Order ရွေးပါ</h2><p className="mt-2 max-w-sm text-sm leading-7 text-muted-foreground">ဘယ်ဘက်စာရင်းမှ ရွေးနိုင်သလို Order နံပါတ် Barcode ကို Scan ဖတ်နိုင်ပါသည်။</p></div>:<><div className="rounded-2xl border bg-card px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="text-xs text-muted-foreground">ရွေးထားသောအော်ဒါ · {plan.dispatchNumber||"မူကြမ်း"}</p><p className="mt-1 break-words text-sm font-semibold"><span className="font-mono">{order.orderNumber}</span> · {order.customer.name}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{plan.serverStatus==="CONFIRMED"?fulfillmentLabel(order):plan.serverStatus||"မသိမ်းရသေး"}</Badge>{outstandingOrder(order)&&<Button variant="outline" size="sm" disabled={readonly} onClick={()=>setPending({kind:"reset"})}>Dispatch အသစ်</Button>}</div></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-6 text-muted-foreground"><span>{order.customer.code}</span>{order.phone&&<span className="flex items-center gap-1"><Phone className="size-3"/>{order.phone}</span>}<span className="flex min-w-0 items-start gap-1"><MapPin className="mt-1 size-3 shrink-0"/><span className="break-words">{order.address||"ပို့မည့်လိပ်စာ မရှိသေးပါ။"}</span></span><span>{dirty?"မသိမ်းရသေး":"သိမ်းထားသည့်ပုံစံ"}</span></div>{order.note&&<p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">အော်ဒါမှတ်ချက် · {order.note}</p>}</div>
        {(stale||conflict)&&<div role="alert" className="rounded-xl bg-destructive/5 p-4 text-sm leading-7 text-destructive">{conflict?"မူကြမ်းကို အခြား Tab မှ ပြင်ထားပါသည်။ မှတ်တမ်းမှ ပြန်ဖွင့်ပါ။":"Order / ပို့ရန်ကျန်ပမာဏ ပြောင်းထားပါသည်။ လက်ကျန်အသစ်ကို စစ်ပြီး မူကြမ်းပြန်သိမ်းပါ။"}{stale&&sourceReady&&<Button variant="outline" className="mt-2" disabled={readonly} onClick={()=>setPending({kind:"review"})}>လက်ကျန်အသစ် စစ်မည်</Button>}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><Package className="size-5 text-primary"/>{locked?"ဤ Dispatch ၏ ပစ္စည်းများ":"ယခုပြင်ဆင်မည့် ပစ္စည်းများ"}</h3><Button variant="outline" size="sm" disabled={readonly||locked||stale||conflict||!sourceReady} onClick={()=>patch({picks:Object.fromEntries(order.lines.map(l=>[lineKey(l),{quantity:(limit(l)||BigInt(0)).toString(),checked:false,scans:0}]))})}>ပို့ရန်ကျန်သမျှ ရွေးမည်</Button></div>
        <fieldset disabled={readonly||locked||stale||conflict||!sourceReady} className="min-w-0 space-y-3">{(locked?order.lines.filter(l=>(quantity(plan.picks[lineKey(l)]?.quantity||"")||BigInt(0))>BigInt(0)):order.lines).map((l,i)=>{const key=lineKey(l),pick=plan.picks[key]||{quantity:"0",checked:false,scans:0},max=limit(l),problem=locked?null:quantityIssue(l,pick.quantity),invalid=!!problem;return <Card key={key} className="gap-0 rounded-2xl p-0"><CardContent className="space-y-4 p-4"><div className="flex items-start gap-3"><ProductImage line={l}/><div className="min-w-0 flex-1"><h4 className="break-words font-semibold leading-7">{l.productName}</h4><p className="text-xs leading-6 text-muted-foreground">{l.packageSize} {l.packageSizeUnit} / {l.saleUnit}</p><p className="break-all font-mono text-[11px] leading-5 text-muted-foreground">{l.barcode}</p></div></div><div className="grid gap-2 sm:grid-cols-2"><p className="rounded-lg bg-muted/50 p-2 text-xs leading-6"><span className="text-muted-foreground">Batch</span><br/><strong className="break-all">{l.batch}</strong></p><p className="rounded-lg bg-muted/50 p-2 text-xs leading-6"><span className="text-muted-foreground">ဂိုဒေါင် / နေရာ</span><br/><strong>#{l.warehouseId} / #{l.locationId}</strong></p></div><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs text-muted-foreground">မှာယူထားသောပမာဏ</p><p className="mt-1 text-lg font-bold">{units(l.quantity)} <span className="text-sm font-normal">{l.saleUnit}</span></p><p className="mt-1 text-xs leading-6 text-muted-foreground">ပို့ပြီး {l.dispatchedQuantity===null?"မရသေး":units(l.dispatchedQuantity)} · ကျန် {l.remainingToDispatchQuantity===null?"မရသေး":units(l.remainingToDispatchQuantity)} {l.saleUnit}</p></div><div className="w-40 space-y-2"><Label htmlFor={`dispatch-qty-${i}`} className="text-xs">{locked?"ဤ Dispatch ပမာဏ":"ယခုပို့မည့်ပမာဏ"}</Label><div className="flex items-center rounded-xl border"><Input id={`dispatch-qty-${i}`} value={pick.quantity} onChange={e=>updatePick(l,{quantity:quantityInput(e.target.value),checked:false,scans:0})} type="text" inputMode="numeric" autoComplete="off" aria-invalid={invalid} aria-describedby={`dispatch-qty-help-${i}`} className="w-full border-0 text-center text-lg font-semibold shadow-none"/><span className="mr-3 shrink-0 text-xs text-muted-foreground">{l.saleUnit}</span></div></div></div>{!locked&&<p id={`dispatch-qty-help-${i}`} className="text-xs leading-6 text-muted-foreground">ပို့ရန်ကျန် {l.remainingToDispatchQuantity===null?"မရသေး":units(l.remainingToDispatchQuantity)} · ကြိုဖယ်ထား {l.outstandingReservedQuantity===null?"မရသေး":units(l.outstandingReservedQuantity)} · ယခုပို့နိုင် {max===null?"မရသေး":units(max)} {l.saleUnit}{max===BigInt(0)&&<span className="block text-amber-700 dark:text-amber-300">{l.remainingToDispatchQuantity==="0"?"ဤပစ္စည်းကို အပြည့်ပို့ပြီးဖြစ်ပါသည်။":"ပို့ရန်ကျန်သော်လည်း အော်ဒါအတွက် ကြိုဖယ်ထားသော Stock မရှိသေးပါ။ Order Reservation ကို စစ်ရန်လိုပါသည်။"}</span>}</p>}{invalid&&<p role="alert" className="text-xs leading-6 text-destructive">{problem}</p>}</CardContent></Card>;})}</fieldset>
        <Card className="gap-0 rounded-2xl p-0"><CardContent className="space-y-4 p-4 sm:p-5"><h3 className="flex items-center gap-2 font-semibold"><Truck className="size-5 text-primary"/>ပို့ဆောင်သူအချက်အလက်</h3><fieldset disabled={readonly||locked||stale||conflict||!sourceReady} className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="dispatch-date">ပို့မည့်ရက် *</Label><Input id="dispatch-date" type="date" value={plan.shipDate} onChange={e=>patch({shipDate:e.target.value})}/></div><div className="space-y-2"><Label htmlFor="dispatch-driver">ပို့ဆောင်သူ / ယာဉ်မောင်း *</Label><Input id="dispatch-driver" maxLength={200} value={plan.driver} onChange={e=>patch({driver:e.target.value})} placeholder="အမည်ဖြည့်ပါ"/></div><div className="space-y-2"><Label htmlFor="dispatch-phone">ယာဉ်မောင်းဖုန်း</Label><Input id="dispatch-phone" type="tel" maxLength={50} value={plan.driverPhone} onChange={e=>patch({driverPhone:e.target.value})}/></div><div className="space-y-2"><Label htmlFor="dispatch-vehicle">ယာဉ်နံပါတ်</Label><Input id="dispatch-vehicle" maxLength={100} value={plan.vehicle} onChange={e=>patch({vehicle:e.target.value})} placeholder="ဥပမာ 1A-1234"/></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="dispatch-note">{shortages.length?"အပြည့်မပို့နိုင်သည့် အကြောင်းပြချက် *":"ပို့ဆောင်ရေးမှတ်ချက်"}</Label>{shortages.length>0&&<div className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{shortages.map(l=><p key={lineKey(l)}>{l.productName} · ပို့ရန်ကျန် {units(l.remainingToDispatchQuantity!)} · ယခုပို့မည် {plan.picks[lineKey(l)]?.quantity||"0"} {l.saleUnit}</p>)}<p>အောက်တွင် ပမာဏမပြည့်သည့် အကြောင်းရင်းကို ရေးပါ။ ပို့စာနှင့် မှတ်တမ်းတွင် သိမ်းထားပါမည်။</p></div>}<textarea id="dispatch-note" rows={3} required={shortages.length>0} aria-invalid={shortages.length>0&&!plan.note.trim()} maxLength={2000} value={plan.note} onChange={e=>patch({note:e.target.value})} className="w-full rounded-xl border bg-background p-3 text-sm" placeholder={shortages.length?"ဥပမာ — အထုပ် ၂ ဘူး ပျက်စီးနေ၍ ၈ ဘူးသာ ပို့ပါသည်။":"ပို့ရန်အချိန်၊ လမ်းညွှန်ချက်…"}/></div></fieldset></CardContent></Card>
      </>}</section>
      <aside className="min-w-0 space-y-4 lg:col-start-2 min-[73.75rem]:sticky min-[73.75rem]:top-6 min-[73.75rem]:col-start-3 min-[73.75rem]:row-start-1"><Card className="gap-0 rounded-2xl p-0"><CardContent className="space-y-5 p-5"><h2 className="font-semibold">{locked?"ထုတ်ပို့မှု အကျဉ်းချုပ်":"ပို့ရန်အစီအစဉ် အကျဉ်းချုပ်"}</h2><div className="rounded-2xl bg-primary/5 p-4"><p className="text-xs text-muted-foreground">{locked?"ဤ Dispatch ပို့သည့်ပမာဏ":"ယခုပြင်ဆင်မည့် ပစ္စည်း"}</p><p className="mt-2 text-3xl font-bold text-primary">{units(selectedUnits)} <span className="text-base font-medium">ယူနစ်</span></p><p className="mt-2 text-xs leading-6 text-muted-foreground">{selectedLines.length} မျိုး / Batch · ယူနစ်မတူလျှင် အထက်ပါပေါင်းလဒ်သည် ရေတွက်မှုသာ ဖြစ်သည်။</p></div><dl className="space-y-3 text-sm"><div className="flex justify-between gap-2"><dt className="text-muted-foreground">အော်ဒါ</dt><dd className="break-all text-right font-mono font-semibold">{order?.orderNumber||"—"}</dd></div><div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">ပို့မည့်သူ</dt><dd className="break-words text-right font-semibold">{order?.customer.name||"—"}</dd></div><div className="flex justify-between gap-2"><dt className="shrink-0 text-muted-foreground">ပို့မည့်ရက်</dt><dd>{plan?.shipDate||"—"}</dd></div></dl><div className="border-t pt-4"><p className="text-xs text-muted-foreground">Dispatch ပစ္စည်းတန်ဖိုး · အော်ဒါဈေးအတိုင်း</p><p className="mt-2 break-words text-2xl font-bold">{money(total,order?.currency||"MMK")}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">ငွေလက်ခံမှု မဟုတ်ပါ။ ပို့ဆောင်ခ မပါဝင်ပါ။</p></div>{issues.length>0&&<div className="space-y-1 text-xs leading-6 text-amber-800 dark:text-amber-300">{issues.slice(0,4).map(e=><p key={e}>{e}</p>)}</div>}<div className="space-y-2">{!locked&&<Button className="w-full" disabled={!plan||!dirty||readonly||locked||!!issues.length||stale||conflict||!sourceReady} onClick={()=>void save()}><Save className="mr-2 size-4"/>{saving?"သိမ်းနေသည်…":"Server မူကြမ်းသိမ်းရန်"}</Button>}<Button variant="outline" className="w-full" disabled={!slip||slip.status!=="CONFIRMED"||readonly} onClick={()=>void print()}><Printer className="mr-2 size-4"/>{printing?"Print ပြင်ဆင်နေသည်…":"ပို့စာ ထုတ်ရန်"}</Button>{plan?.serverId&&plan.serverStatus==="DRAFT"&&<><Button className="w-full" disabled={readonly||dirty||stale||conflict||!!issues.length||!sourceReady} onClick={()=>setPending({kind:"confirm"})}><Truck className="mr-2 size-4"/>ထုတ်ပို့မှုအတည်ပြုရန်</Button><Button variant="outline" className="w-full" disabled={readonly} onClick={()=>setPending({kind:"cancel"})}>မူကြမ်း ပယ်ဖျက်မည်</Button></>}{locked&&order&&outstandingOrder(order)&&sourceReady&&<Button variant="outline" className="h-auto w-full whitespace-normal" disabled={readonly} onClick={()=>chooseOrder(plan!.orderId)}>ဤ Order အတွက် Dispatch အသစ်</Button>}</div><p className="text-[11px] leading-6 text-muted-foreground">မူကြမ်းနှင့် ထုတ်ပို့မှုမှတ်တမ်းများကို Server တွင် သိမ်းပါမည်။ အတည်ပြုပြီးမှ ပို့စာ ထုတ်နိုင်ပါမည်။</p></CardContent></Card></aside>
    </div>
    <Dialog open={camera} onOpenChange={setCamera}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Order / Customer Scan</DialogTitle><DialogDescription>Order Barcode သို့မဟုတ် Customer ID Barcode ကို Camera ရှေ့တွင် ထားပါ။</DialogDescription></DialogHeader>{camera&&<ScanCamera onClose={closeCamera} onScan={value=>{setCamera(false);setScanResult(value);}}/>}</DialogContent></Dialog>
    <Dialog open={scanResult!==null} onOpenChange={open=>{if(!open)setScanResult(null);}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Scan ရလဒ်</DialogTitle><DialogDescription>တွေ့ရှိသော အော်ဒါကို စစ်ဆေးပြီး ရွေးပါ။</DialogDescription></DialogHeader>
      <p className="break-all rounded-xl bg-muted p-3 font-mono text-sm">{scanResult}</p>
      {matchedOrders.length?<div className="max-h-80 space-y-2 overflow-y-auto">{matchedOrders.map(o=><div key={o.id} className="rounded-2xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="break-all font-mono text-sm font-semibold">{o.orderNumber}</p><p className="mt-1 break-words text-sm">{o.customer.name} · {o.customer.code}</p><p className="mt-1 text-xs text-muted-foreground">{o.deliveryDate} · {o.lines.length} မျိုး</p></div><Badge variant="outline">{fulfillmentLabel(o)}</Badge></div><Button type="button" className="mt-3 w-full" disabled={readonly} onClick={()=>{setScanFilter(scanCode);setPage(0);setScanResult(null);chooseOrder(o.id);}}>ဤအော်ဒါကို ရွေးမည်</Button></div>)}</div>:<p role="status" className="rounded-xl border border-dashed p-4 text-sm leading-7 text-muted-foreground">{loading||error?"Order စာရင်းကို မစစ်နိုင်သေးပါ။ ပြန်တင်ပြီး ထပ်စမ်းပါ။":"ဤ Order နံပါတ် သို့မဟုတ် Customer ID အတွက် ပို့ရန်ကျန်သော အော်ဒါ မတွေ့ပါ။"}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setScanResult(null)}>ပိတ်မည်</Button><Button type="button" variant="outline" disabled={readonly} onClick={()=>{setScanResult(null);setCamera(true);}}>ထပ် Scan ဖတ်မည်</Button></div>
    </DialogContent></Dialog>
    <Dialog open={!!pending} onOpenChange={open=>{if(!open)setPending(null);}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{pending?.kind==="confirm"?"ထုတ်ပို့မှု အတည်ပြုမလား။":pending?.kind==="cancel"?"Dispatch မူကြမ်း ပယ်ဖျက်မလား။":pending?.kind==="review"?"လက်ရှိ ပို့ရန်ကျန်ပမာဏကို စစ်ပါ":pending?.kind==="import"?"ယခင် Browser မူကြမ်းကို ယူမလား။":pending?.kind==="reset"?"ဤ Order အတွက် Dispatch အသစ် စတင်မလား။":"မသိမ်းရသေးသော ပြင်ဆင်မှုကို ပယ်မလား။"}</DialogTitle><DialogDescription>{pending?.kind==="confirm"?"အောက်ပါပမာဏကို Stock မှ နှုတ်ပြီး အော်ဒါအတွက် ကြိုဖယ်ထားသောပမာဏကိုပါ လျှော့ပါမည်။ အတည်ပြုပြီးလျှင် တိုက်ရိုက်ပြင် / ပယ်ဖျက်၍ မရပါ။":pending?.kind==="cancel"?"Server မူကြမ်းကို ပယ်ဖျက်ပါမည်။ မသိမ်းရသေးသော ပြင်ဆင်မှုများကို မသုံးပါ။ Stock မပြောင်းပါ။":pending?.kind==="review"?"မူကြမ်းပမာဏကို အလိုအလျောက် မလျှော့ထားပါ။ လက်ကျန်အသစ်ဖြင့် စစ်ပြီး မူကြမ်းကို ပြန်သိမ်းပါ။":pending?.kind==="import"?"မူလ Browser မှတ်တမ်းကို မဖျက်ပါ။ လက်ရှိ Server Order၊ ပို့ရန်ကျန်ပမာဏနှင့် ဈေးကို စစ်ပြီးမှ သိမ်းပါ။":"မသိမ်းရသေးသော ပြင်ဆင်မှုများကို ပယ်ပါမည်။ Server မှတ်တမ်းများကို မပြောင်းပါ။"}</DialogDescription></DialogHeader>
      {pending&&["confirm","review"].includes(pending.kind)&&<div className="max-h-64 space-y-2 overflow-y-auto">{order?.lines.filter(l=>pending.kind==="review"||shortages.length>0||(quantity(plan?.picks[lineKey(l)]?.quantity||"")||BigInt(0))>BigInt(0)).map(l=><div key={lineKey(l)} className="rounded-xl border p-3 text-sm leading-7"><p className="font-semibold">{l.productName} · {l.batch}</p><p>ယခုပို့မည် {plan?.picks[lineKey(l)]?.quantity||"0"} {l.saleUnit} · လက်ကျန် {l.remainingToDispatchQuantity===null?"မရသေး":units(l.remainingToDispatchQuantity)}</p><p className="text-xs text-muted-foreground">ကြိုဖယ်ထားသော ကျန်ပမာဏ {l.outstandingReservedQuantity===null?"မရသေး":units(l.outstandingReservedQuantity)}</p></div>)}</div>}
      {pending?.kind==="confirm"&&shortages.length>0&&<div className="rounded-xl bg-amber-50 p-3 text-sm leading-7 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-semibold">အပြည့်မပို့နိုင်သည့် အကြောင်းပြချက်</p><p className="whitespace-pre-wrap break-words">{plan?.note}</p><p className="mt-2 text-xs">မပို့ရသေးသောပမာဏကို ပို့ရန်ကျန်အဖြစ် ဆက်ပြထားပါမည်။</p></div>}
      {pending?.kind==="import"&&<div className="rounded-xl bg-muted p-3 text-sm leading-7"><p>{pending.draft.orderNumber} · {pending.draft.customerName}</p><p>ပို့ဆောင်သူ · {pending.draft.driver||"—"}</p></div>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setPending(null)}>ပြန်သွားမည်</Button><Button disabled={readonly} onClick={()=>{const action=pending;setPending(null);if(action?.kind==="confirm")void transition("confirm");else if(action?.kind==="cancel")void transition("cancel");else if(action?.kind==="review")review();else if(action?.kind==="import")void importLegacy(action.draft);else if(action?.kind==="order")void openOrder(action.id);else if(action?.kind==="dispatch")void openDispatch(action.id);else if(action?.kind==="reset"&&order)void openOrder(order.id);}}>{pending?.kind==="confirm"?"အတည်ပြုမည်":"ဆက်လုပ်မည်"}</Button></div>
    </DialogContent></Dialog>
    <Drawer open={history} swipeDirection="right" onOpenChange={setHistory}><DrawerContent side="right" className="w-full sm:w-[32rem]" showHandle={false}><DrawerHeader><div className="flex justify-between gap-3"><div><DrawerTitle>Dispatch မှတ်တမ်းများ</DrawerTitle><DrawerDescription>Server တွင် သိမ်းထားသော မူကြမ်းနှင့် ထုတ်ပို့မှုများ</DrawerDescription></div><DrawerClose aria-label="ပို့ဆောင်မှုမှတ်တမ်းပိတ်ရန်"/></div></DrawerHeader><DrawerBody className="space-y-3"><div className="flex gap-2"><Input aria-label="Dispatch မှတ်တမ်းရှာရန်" placeholder="Dispatch / Order / Customer ရှာရန်" value={historyQuery} onChange={e=>setHistoryQuery(e.target.value)}/><select aria-label="Dispatch အခြေအနေ" className="rounded-xl border bg-background px-2 text-xs" value={historyStatus} onChange={e=>setHistoryStatus(e.target.value)}>{["ALL","DRAFT","CONFIRMED","CANCELLED"].map(v=><option value={v} key={v}>{v}</option>)}</select></div>{!plans.length&&<p className="py-6 text-center text-sm text-muted-foreground">Server Dispatch မှတ်တမ်း မရှိသေးပါ။</p>}{plans.filter(d=>(historyStatus==="ALL"||d.status===historyStatus)&&[d.dispatchNumber,d.orderSnapshot.orderNumber,d.orderSnapshot.customer.name].some(v=>v.toLowerCase().includes(historyQuery.trim().toLowerCase()))).map(d=><button type="button" key={d.id} className="w-full rounded-2xl border p-4 text-left hover:border-primary" disabled={readonly} onClick={()=>chooseDispatch(d.id)}><div className="flex justify-between gap-2"><span className="font-mono text-sm font-semibold">{d.dispatchNumber}</span><Badge variant="outline">{d.status}</Badge></div><p className="mt-2 font-semibold">{d.orderSnapshot.customer.name}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">{d.orderSnapshot.orderNumber} · {d.dispatchDate}<br/>{d.responsibleName} · {money(decimal(d.total),d.currency)}</p></button>)}{!!legacy.length&&<div className="space-y-2 border-t pt-4"><h3 className="text-sm font-semibold">ယခင် Browser မူကြမ်းများ</h3><p className="text-xs leading-6 text-muted-foreground">Server ထဲ ယူမသိမ်းမီ လက်ရှိပမာဏကို ပြန်စစ်ရပါမည်။ မူလ data ကို မဖျက်ပါ။</p>{legacy.map(p=><button key={p.id} type="button" disabled={readonly} className="w-full rounded-xl border border-dashed p-3 text-left text-sm" onClick={()=>setPending({kind:"import",draft:p})}><p className="font-semibold">{p.orderNumber} · {p.customerName}</p><p className="mt-1 text-xs text-muted-foreground">{p.shipDate} · {p.driver} · Browser မူကြမ်းယူရန်</p></button>)}</div>}</DrawerBody><DrawerFooter><Button variant="outline" className="w-full" onClick={()=>setHistory(false)}>ပိတ်မည်</Button></DrawerFooter></DrawerContent></Drawer>

  </main>;
}
