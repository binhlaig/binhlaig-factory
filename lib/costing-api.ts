export type CostingResult = { ready: boolean; errors: string[]; values: Record<string, number | null> };
export type CostingServerItem = { id: number; clientItemId: string; displayOrder: number; inputs: Record<string, string | number | null>; originalImage: boolean; packagedImage: boolean; calculation: CostingResult };
export type CostingSheet = { archived?: boolean; archivedAt?: string | null; archivedByAccountId?: number | null; id: number; title: string; currencyCode: string; status: 'DRAFT' | 'FINALIZED'; version: number; calculationVersion: number; updatedAt: string; items: CostingServerItem[]; totals: { includedItems: number; totalItems: number; packedCost: number | null; revenue: number | null; profit: number | null; discountedRevenue: number | null; discountedProfit: number | null; combinedMargin: number | null } };
export type CostingList = { content: CostingSheet[]; totalPages: number; totalElements: number; number: number };
export class CostingApiError extends Error { constructor(message: string, public status: number, public uncertain = false, public code?: string) { super(message); } }
const BASE = '/api/factory/costings';
export const numericFields = ['containers','unitsPerContainer','weightKg','purchase','processing','lossKg','packGrams','packaging','sellingPrice','targetPercent','minimumMargin','discount','rounding'] as const;
export const textFields = ['product','productType','containerName','unitName','purchasePriceMode','mode','basis'] as const;
export function savePayload(title: string, items: {id: string; inputs: Record<string, string | undefined>}[], version?: number) {
  return { title: title.trim(), ...(version !== undefined ? { version } : {}), items: items.map(item => ({ clientItemId: item.id,
    ...Object.fromEntries(textFields.map(key=>[key,item.inputs[key]?.trim() || null])),
    ...Object.fromEntries(numericFields.map(key=>{
      const raw=item.inputs[key]?.trim();
      if(!raw || key==='rounding' && Number(raw)===0) return [key,null];
      const value=Number(raw);
      if(!Number.isFinite(value)) throw new Error(`${key}: မှန်ကန်သောကိန်းဂဏန်း ဖြည့်ပါ။`);
      return [key,value];
    }))
  })) };
}
export function decodeSheet(value: unknown): CostingSheet {
  if(!value || typeof value!=='object') throw new CostingApiError('Server response ပုံစံ မမှန်ပါ။ စာရင်းပြန်ဖွင့်စစ်ပါ။',502,true);
  const s=value as CostingSheet;
  if(!Number.isSafeInteger(s.id)||s.id<=0||!Number.isSafeInteger(s.version)||s.version<0||!['DRAFT','FINALIZED'].includes(s.status)||typeof s.title!=='string'||typeof s.currencyCode!=='string'||!Array.isArray(s.items)||!s.totals||s.items.some(i=>!Number.isSafeInteger(i.id)||typeof i.clientItemId!=='string'||!i.inputs||!i.calculation||typeof i.calculation.ready!=='boolean'||!Array.isArray(i.calculation.errors)||!i.calculation.values||typeof i.originalImage!=='boolean'||typeof i.packagedImage!=='boolean')||new Set(s.items.map(i=>i.clientItemId)).size!==s.items.length) throw new CostingApiError('Server response ပုံစံ မမှန်ပါ။ စာရင်းပြန်ဖွင့်စစ်ပါ။',502,true);
  return s;
}
export async function costingRequest(path='', options: RequestInit={}): Promise<unknown> {
  const method=options.method || 'GET', mutation=method!=='GET';
  let response:Response;
  try { response=await fetch(`${BASE}${path}`,{...options,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers},signal:options.signal??AbortSignal.timeout(45000)}); }
  catch { throw new CostingApiError(mutation?'ဆက်သွယ်မှု ပြတ်သွားပါသည်။ Server စာရင်းကို ပြန်စစ်ပြီးမှ ဆက်လုပ်ပါ။':'Server ချိတ်ဆက်မရပါ။ ပြန်စမ်းပါ။',0,mutation); }
  if(response.status===204 && response.ok) return null;
  const body=await response.json().catch(()=>null);
  if(!response.ok){const labels:Record<number,string>={400:'ဖြည့်ထားသောအချက်အလက် စစ်ပါ။',401:'Login session ကုန်ဆုံးပါပြီ။ ပြန်ဝင်ပါ။',403:'FACTORY ဆိုင်၏ Owner account ဖြင့်သာ သုံးနိုင်ပါသည်။',404:'စာရင်း မတွေ့ပါ သို့မဟုတ် အသုံးပြုခွင့်မရှိပါ။',409:'စာရင်းပြောင်းထားပါသည် သို့မဟုတ် အတည်ပြုပြီးဖြစ်ပါသည်။ Server စာရင်းကို ပြန်ဖွင့်စစ်ပါ။',413:'ဖိုင်အရွယ်အစား ကြီးလွန်းပါသည်။'};throw new CostingApiError(`${labels[response.status]||'Server လုပ်ဆောင်ချက် မအောင်မြင်ပါ။'} ${typeof body?.message==='string'?body.message:''}`,response.status,mutation&&response.status>=500,typeof body?.code==='string'?body.code:undefined);}
  if(!body) throw new CostingApiError('Server response ဖတ်မရပါ။ စာရင်းပြန်ဖွင့်စစ်ပါ။',502,mutation);
  return body;
}
export async function sheetRequest(path='',options:RequestInit={}) { return decodeSheet(await costingRequest(path,options)); }
export async function listCostings(page=0, search='',status=''):Promise<CostingList>{
  const q=new URLSearchParams({page:String(page),size:'12',search,...(status?{status}: {})});const result=await costingRequest(`?${q}`) as CostingList;
  if(!result||!Array.isArray(result.content)||!Number.isInteger(result.totalPages)||!Number.isInteger(result.number))throw new CostingApiError('စာရင်း response မမှန်ပါ။',502);
  return {...result,content:result.content.map(decodeSheet)};
}
export function photoUrl(sheet:CostingSheet,item:CostingServerItem,slot:'ORIGINAL'|'PACKAGED'){return `${BASE}/${sheet.id}/items/${item.id}/images/${slot}?v=${sheet.version}`;}
export function jpegBlob(data:string){const [header,body]=data.split(',');if(header!=='data:image/jpeg;base64'||!body)throw new Error('JPEG ပုံသာ upload လုပ်နိုင်ပါသည်။');return new Blob([Uint8Array.from(atob(body),c=>c.charCodeAt(0))],{type:'image/jpeg'});}
// Always use each mutation's returned version. Keep local photos untouched until all operations succeed.
export async function syncPhotos(sheet:CostingSheet,items:{id:string;inputs:{originalImage?:string;packedImage?:string}}[],ack:(s:CostingSheet)=>Promise<void>){
  let current=sheet;
  for(const local of items){
    for(const [field,slot,flag] of [['originalImage','ORIGINAL','originalImage'],['packedImage','PACKAGED','packagedImage']] as const){
      const server=current.items.find(i=>i.clientItemId===local.id);if(!server)throw new Error('Server ပစ္စည်း ID မတွေ့ပါ။');
      const desired=local.inputs[field]||'';
      const path=`/${current.id}/items/${server.id}/images/${slot}?version=${current.version}`;
      if(desired.startsWith('data:image/jpeg;base64,')){const form=new FormData();form.append('file',jpegBlob(desired),'photo.jpg');current=await sheetRequest(path,{method:'PUT',body:form});await ack(current);}
      else if(!desired && server[flag]){current=await sheetRequest(path,{method:'DELETE'});await ack(current);}
    }
  }
  return current;
}
