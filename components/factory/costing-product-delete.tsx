"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, RefreshCw, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CostingApiError,
  costingRequest,
  sheetRequest,
  type CostingSheet,
  type CostingServerItem,
} from "@/lib/costing-api";

function deletionError(reason: unknown, fallback: string): string {
  if (reason instanceof CostingApiError && reason.code === "COSTING_REFERENCED") {
    return "Receiving နှင့် ဆက်စပ်မှတ်တမ်းရှိသဖြင့် အပြီးဖျက်မရပါ။ စာရင်းမှဖယ်သိမ်းမည် ကို အသုံးပြုပါ။";
  }
  if (reason instanceof CostingApiError && reason.status === 409) {
    if (/Referenced Costing history|foreign key|constraint/i.test(reason.message)) {
      return "Server က ဆက်စပ်မှတ်တမ်း သို့မဟုတ် အချက်အလက်မကိုက်ညီမှုကြောင့် ဖျက်ခွင့်ငြင်းထားပါသည်။ အတည်ပြုပြီးသားဖြစ်ခြင်းတစ်ခုတည်းကို ဆိုလိုခြင်းမဟုတ်ပါ။ Server စာရင်းပြန်ယူပြီး ဆက်ဖြစ်နေပါက Receiving နှင့် ဆက်စပ်မှတ်တမ်းများကို Backend မှ စစ်ရန်လိုပါသည်။";
    }
    return "Server က ဖျက်ခွင့်ငြင်းထားပါသည် (409)။ စာရင်း version ပြောင်းထားခြင်း သို့မဟုတ် ဆက်စပ်မှတ်တမ်းရှိခြင်း ဖြစ်နိုင်ပါသည်။ Server စာရင်းပြန်ယူပြီး စစ်ပါ။";
  }
  if (reason instanceof CostingApiError && reason.uncertain) {
    return "ဖျက်ခြင်းရလဒ် မသေချာသေးပါ။ Request ကို ထပ်မပို့မီ Server စာရင်းပြန်ယူ၍ ပစ္စည်းရှိသေးလား စစ်ပါ။";
  }
  return reason instanceof Error ? reason.message : fallback;
}

type Props = {
  sheet: CostingSheet;
  item: CostingServerItem;
  disabled?: boolean;
  unsavedChanges?: boolean;
  onAcquire?: () => boolean;
  onRelease?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onUncertain?: () => void;
  onBeforeNavigate?: () => void;
  onReload: () => void | Promise<void>;
  onDeleted?: () => void;
};

export function CostingProductDelete({
  sheet,
  item,
  disabled = false,
  unsavedChanges = false,
  onAcquire,
  onRelease,
  onBusyChange,
  onUncertain,
  onBeforeNavigate,
  onReload,
  onDeleted,
}: Props) {
  const router = useRouter();
  const inputId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const [error, setError] = React.useState("");
  const lock = React.useRef(false);
  const name =
    String(item.inputs.product || "အမည်မဖြည့်ရသေးပါ").trim() || "အမည်မဖြည့်ရသေးပါ";
  const allowed = sheet.items.some(
    (entry) => entry.id === item.id && entry.clientItemId === item.clientItemId,
  );
  React.useEffect(() => {
    setConfirmation("");
    setError("");
    setBlocked(false);
    setOpen(false);
  }, [sheet, item.id]);
  function changeOpen(next: boolean) {
    if (lock.current) return;
    setOpen(next);
    if (next) {
      setConfirmation("");
      if (!blocked) setError("");
    }
  }
  async function reloadServer() {
    if (lock.current || busy) return;
    lock.current = true;
    setBusy(true);
    try {
      await onReload();
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Server စာရင်း ပြန်ယူမရပါ။ ထပ်စမ်းပါ။");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (lock.current || disabled || blocked || !allowed || confirmation.trim() !== name)
      return;
    if (onAcquire && !onAcquire()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      onBusyChange?.(true);
      // Dedicated item deletion permits finalized sheets without opening generic
      // finalized edits. Backend preserves the remaining items and snapshots.
      const result = await sheetRequest(
        `/${sheet.id}/items/${item.id}?version=${sheet.version}`,
        { method: "DELETE" },
      );
      if (
        result.id !== sheet.id ||
        result.items.some((entry) => entry.clientItemId === item.clientItemId)
      ) {
        throw new CostingApiError(
          "ဖျက်ခြင်းရလဒ် မသေချာပါ။ Server စာရင်းကို ပြန်စစ်ပါ။",
          502,
          true,
        );
      }
      setBlocked(true); // Do not repeat a successful mutation if navigation stalls.
      onBeforeNavigate?.();
      if (onDeleted) {
        setOpen(false);
        onDeleted();
      } else router.replace("/factory/costing/products");
    } catch (reason) {
      if (reason instanceof CostingApiError && reason.status !== 409 && reason.uncertain) {
        setBlocked(true);
        onUncertain?.();
      }
      setError(deletionError(reason, "ပစ္စည်းဖျက်မရပါ။"));
    } finally {
      lock.current = false;
      setBusy(false);
      try { onRelease?.(); }
      finally { onBusyChange?.(false); }
    }
  }
  if (!allowed)
    return (
      <Button
        type="button"
        variant="destructive"
        disabled
        title={"ပစ္စည်းအချက်အလက်ကို ပြန်တင်စစ်ဆေးပါ။"}
        className="h-auto min-h-11 border border-destructive/25 py-2 text-xs leading-6 disabled:bg-destructive/10 disabled:text-destructive disabled:opacity-100"
      >
        <Trash2 className="mr-2 size-4" />
        ပစ္စည်းဖျက်ရန်
      </Button>
    );
  return (
    <>
      <CostingArchive sheet={sheet} item={item} disabled={disabled || busy || blocked} unsavedChanges={unsavedChanges}
        onAcquire={onAcquire} onRelease={onRelease} onBusyChange={onBusyChange} onUncertain={onUncertain}
        onBeforeNavigate={onBeforeNavigate} onReload={onReload} onDeleted={onDeleted} />
      <Button
        type="button"
        variant="destructive"
        disabled={disabled || busy}
        onClick={() => changeOpen(true)}
        className="h-auto min-h-11 py-2 text-xs leading-6"
      >
        <Trash2 className="mr-2 size-4" />
        ပစ္စည်းဖျက်ရန်
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base leading-8">
              ကုန်ပစ္စည်းကို အပြီးဖျက်မလား။
            </DialogTitle>
            <DialogDescription className="text-sm leading-7">
              ရွေးထားသော ပစ္စည်းနှင့် ၎င်း၏ပုံများကို ဤ costing စာရင်းမှ ဖယ်ရှားပါမည်။
              အခြားပစ္စည်းများကို ဆက်ထိန်းထားပါမည်။
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm leading-7">
              <p className="break-words font-semibold">{name}</p>
              <p className="text-xs text-muted-foreground">
                {sheet.title} · စာရင်း #{sheet.id} / ပစ္စည်း #{item.id}
              </p>
            </div>
            {sheet.items.length === 1 && (
              <p className="rounded-xl bg-amber-50 p-3 text-xs leading-7 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                ဤပစ္စည်းသည် နောက်ဆုံးကျန်သော ပစ္စည်းဖြစ်ပါသည်။ ဖျက်ပြီးလျှင် costing
                စာရင်းအလွတ်ကို ဆက်ထားပါမည်။
              </p>
            )}
            {unsavedChanges && (
              <p className="text-xs leading-7 text-destructive">
                Edit form မှ မသိမ်းရသေးသော ပြင်ဆင်ချက်များကိုလည်း ချန်ထားမည်ဖြစ်ပါသည်။
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor={inputId} className="text-xs leading-7">
                အတည်ပြုရန် အထက်ပါ ပစ္စည်းအမည်ကို ပြန်ရိုက်ပါ
              </Label>
              <Input
                id={inputId}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                disabled={busy || blocked}
                aria-describedby={`${inputId}-description`}
                className="h-11 text-sm"
              />
              <p
                id={`${inputId}-description`}
                className="text-xs leading-6 text-muted-foreground"
              >
                ဖျက်ပြီးသော ပစ္စည်းကို ဤလုပ်ဆောင်ချက်မှ ပြန်ယူမရပါ။
              </p>
            </div>
            {error && (
              <p role="alert" className="text-xs leading-7 text-destructive">
                {error}
              </p>
            )}
            {(blocked || error) && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-xs leading-7 text-muted-foreground">
                  {blocked ? "ရလဒ်မသေချာသေးသဖြင့် ထပ်မဖျက်မီ Server စာရင်း ပြန်ယူစစ်ဆေးပါ။" : "ဖျက်ခြင်း မအောင်မြင်သေးပါ။ Server စာရင်းပြန်ယူနိုင်သလို Dialog ကို ပိတ်နိုင်ပါသည်။"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void reloadServer()}
                  className="h-auto min-h-10 whitespace-normal py-2 text-xs leading-6"
                >
                  <RefreshCw className="mr-2 size-4" />
                  Server စာရင်း ပြန်ယူရန်
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => changeOpen(false)}
              className="h-auto min-h-11 py-2 text-xs leading-6"
            >
              မဖျက်တော့ပါ
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disabled || busy || blocked || confirmation.trim() !== name}
              onClick={() => void remove()}
              className="h-auto min-h-11 py-2 text-xs leading-6"
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 size-4" />
              )}
              {busy ? "ဖျက်နေသည်…" : "အပြီးဖျက်မည်"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type SheetDeleteProps = Pick<
  Props,
  | "sheet"
  | "disabled"
  | "onAcquire"
  | "onRelease"
  | "onBusyChange"
  | "onUncertain"
  | "onReload"
  | "onDeleted"
>;

export function CostingSheetDelete({
  sheet,
  disabled = false,
  onAcquire,
  onRelease,
  onBusyChange,
  onUncertain,
  onReload,
  onDeleted,
}: SheetDeleteProps) {
  const router = useRouter();
  const inputId = React.useId();
  const lock = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const [error, setError] = React.useState("");
  const name = sheet.title.trim();
  React.useEffect(() => {
    setConfirmation("");
    setError("");
    setBlocked(false);
    setOpen(false);
  }, [sheet]);
  function changeOpen(next: boolean) {
    if (lock.current) return;
    setOpen(next);
    if (next) {
      setConfirmation("");
      if (!blocked) setError("");
    }
  }
  async function reloadServer() {
    if (lock.current || busy) return;
    lock.current = true;
    setBusy(true);
    try {
      await onReload();
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Server စာရင်း ပြန်ယူမရပါ။ ထပ်စမ်းပါ။");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (lock.current || disabled || blocked || !name || confirmation.trim() !== name)
      return;
    if (onAcquire && !onAcquire()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      onBusyChange?.(true);
      // This endpoint deletes the sheet AND its products/photos. Never use it
      // for a single card; single-product deletion above uses versioned DELETE.
      await costingRequest(`/${sheet.id}?version=${sheet.version}`, { method: "DELETE" });
      setBlocked(true);
      setOpen(false);
      if (onDeleted) onDeleted();
      else router.replace("/factory/costing/products");
    } catch (reason) {
      if (reason instanceof CostingApiError && reason.status !== 409 && reason.uncertain) {
        setBlocked(true);
        onUncertain?.();
      }
      setError(deletionError(reason, "အတွဲဖျက်မရပါ။"));
    } finally {
      lock.current = false;
      setBusy(false);
      try { onRelease?.(); }
      finally { onBusyChange?.(false); }
    }
  }
  return (
    <>
      <CostingArchive sheet={sheet} disabled={disabled || busy || blocked}
        onAcquire={onAcquire} onRelease={onRelease} onBusyChange={onBusyChange} onUncertain={onUncertain}
        onReload={onReload} onDeleted={onDeleted} />
      <Button
        type="button"
        variant="destructive"
        disabled={disabled || busy}
        onClick={() => changeOpen(true)}
        className="h-auto min-h-11 whitespace-normal py-2 text-xs leading-6"
      >
        <Trash2 className="mr-2 size-4" />
        အတွဲတစ်ခုလုံးဖျက်ရန်
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base leading-8">
              ပစ္စည်းအတွဲတစ်ခုလုံးကို ဖျက်မလား။
            </DialogTitle>
            <DialogDescription className="text-sm leading-7">
              ဤ costing စာရင်းနှင့် အတွင်းရှိ ပစ္စည်းအားလုံး၊ ပုံအားလုံးကို ဖျက်ပါမည်။
              အခြားအတွဲများကို မပြောင်းပါ။
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <p className="break-words text-sm font-semibold leading-7">{sheet.title}</p>
              <p className="text-xs leading-7 text-muted-foreground">
                စာရင်း #{sheet.id} · ပစ္စည်း {sheet.items.length} မျိုး
              </p>
              <ul className="mt-2 list-disc pl-5 text-xs leading-7">
                {sheet.items.slice(0, 5).map((item) => (
                  <li key={item.id} className="break-words">
                    {String(item.inputs.product || "အမည်မဖြည့်ရသေးပါ")}
                  </li>
                ))}
              </ul>
              {sheet.items.length > 5 && (
                <p className="text-xs leading-7 text-muted-foreground">
                  နှင့် အခြား {sheet.items.length - 5} မျိုး
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={inputId} className="text-xs leading-7">
                အတည်ပြုရန် အထက်ပါ အတွဲအမည်ကို ပြန်ရိုက်ပါ
              </Label>
              <Input
                id={inputId}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                disabled={busy || blocked}
                className="h-11 text-sm"
                aria-describedby={`${inputId}-description`}
              />
              <p
                id={`${inputId}-description`}
                className="text-xs leading-7 text-destructive"
              >
                အတွဲထဲက ပစ္စည်းအားလုံးကို အပြီးဖျက်မည်ဖြစ်ပြီး ပြန်ယူမရပါ။
              </p>
            </div>
            {error && (
              <p role="alert" className="text-xs leading-7 text-destructive">
                {error}
              </p>
            )}
            {(blocked || error) && (
              <div className="space-y-2">
                <p className="text-xs leading-7 text-muted-foreground">
                  {blocked ? "ရလဒ်မသေချာသေးသဖြင့် ထပ်မဖျက်မီ Server စာရင်းကို ပြန်စစ်ပါ။" : "ဖျက်ခြင်း မအောင်မြင်သေးပါ။ Server စာရင်းပြန်ယူပြီး စစ်ပါ။"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void reloadServer()}
                  className="h-auto min-h-10 whitespace-normal py-2 text-xs leading-6"
                >
                  <RefreshCw className="mr-2 size-4" />
                  Server စာရင်း ပြန်ယူရန်
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => changeOpen(false)}
              className="h-auto min-h-11 py-2 text-xs leading-6"
            >
              မဖျက်တော့ပါ
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                disabled || busy || blocked || !name || confirmation.trim() !== name
              }
              onClick={() => void remove()}
              className="h-auto min-h-11 whitespace-normal py-2 text-xs leading-6"
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 size-4" />
              )}
              {busy ? "ဖျက်နေသည်…" : "အတွဲအားလုံး အပြီးဖျက်မည်"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Archiving is an explicit visibility action, independent of permanent deletion.
function CostingArchive(props: Omit<Props, "item"> & { item?: CostingServerItem }) {
  const router = useRouter();
  const inputId = React.useId();
  const lock = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState("");
  const name = String(props.item?.inputs.product || props.sheet.title).trim();
  React.useEffect(() => {
    setOpen(false); setBlocked(false); setConfirmation(""); setError("");
  }, [props.sheet, props.item?.id]);
  function changeOpen(next: boolean) {
    if (lock.current) return;
    setOpen(next);
    if (next) { setConfirmation(""); if (!blocked) setError(""); }
  }
  async function archive() {
    if (lock.current || busy || props.disabled || blocked || confirmation.trim() !== name) return;
    if (props.onAcquire && !props.onAcquire()) return;
    lock.current = true; setBusy(true); setError("");
    try {
      props.onBusyChange?.(true);
      const path = props.item
        ? "/" + props.sheet.id + "/items/" + props.item.id + "/archive"
        : "/" + props.sheet.id + "/archive";
      const result = await sheetRequest(path, { method: "POST", body: JSON.stringify({ version: props.sheet.version }) });
      if (result.id !== props.sheet.id || (props.item
          ? result.items.some(entry => entry.id === props.item!.id)
          : result.archived !== true)) {
        throw new CostingApiError("Archive ရလဒ် မသေချာပါ။ Server စာရင်း ပြန်ယူပါ။", 502, true);
      }
      setBlocked(true); setOpen(false);
      props.onBeforeNavigate?.();
      if (props.onDeleted) props.onDeleted();
      else router.replace("/factory/costing/products");
    } catch (reason) {
      if (reason instanceof CostingApiError && reason.uncertain) {
        setBlocked(true); props.onUncertain?.();
      }
      setError(reason instanceof Error ? reason.message : "စာရင်းမှဖယ်သိမ်းမရပါ။");
    } finally {
      lock.current = false; setBusy(false);
      try { props.onRelease?.(); } finally { props.onBusyChange?.(false); }
    }
  }
  async function reload() {
    if (lock.current || busy) return;
    if (props.onAcquire && !props.onAcquire()) return;
    lock.current = true; setBusy(true);
    try {
      props.onBusyChange?.(true); await props.onReload(); setBlocked(false); setError(""); setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Server စာရင်း ပြန်ယူမရပါ။");
    } finally {
      lock.current = false; setBusy(false);
      try { props.onRelease?.(); } finally { props.onBusyChange?.(false); }
    }
  }
  return <>
    <Button type="button" variant="outline" disabled={props.disabled || busy || props.sheet.archived}
      onClick={() => changeOpen(true)} className="h-auto min-h-11 py-2 text-xs leading-6">
      <Archive className="mr-2 size-4" />စာရင်းမှဖယ်သိမ်းမည်
    </Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base leading-8">စာရင်းမှဖယ်သိမ်းမည်</DialogTitle>
          <DialogDescription className="text-sm leading-7">
            {props.item ? "ဤပစ္စည်းကို" : "ဤအတွဲကို"} ပုံမှန် Costing စာရင်းနှင့် Receiving အသစ် ရွေးချယ်မှုမှ ဖယ်သိမ်းပါမည်။
            လက်ကျန်၊ ပုံများနှင့် ယခင်မှတ်တမ်းများကို ထိန်းသိမ်းထားပါမည်။
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm leading-7">
            <p className="break-words font-semibold">{name}</p>
            <p className="text-xs text-muted-foreground">{props.sheet.title} · စာရင်း #{props.sheet.id}</p>
          </div>
          {props.unsavedChanges && <p className="text-xs leading-7 text-destructive">မသိမ်းရသေးသော ပြင်ဆင်ချက်များ ရှိပါသည်။</p>}
          <div className="space-y-2">
            <Label htmlFor={inputId} className="text-xs leading-7">အတည်ပြုရန် အထက်ပါအမည်ကို ပြန်ရိုက်ပါ</Label>
            <Input id={inputId} value={confirmation} onChange={event => setConfirmation(event.target.value)}
              disabled={busy || blocked} autoComplete="off" className="h-11 text-sm" />
          </div>
          {error && <p role="alert" className="text-xs leading-7 text-destructive">{error}</p>}
          {(blocked || error) && <Button type="button" variant="outline" disabled={busy} onClick={() => void reload()}
            className="h-auto min-h-10 py-2 text-xs leading-6"><RefreshCw className="mr-2 size-4" />Server စာရင်း ပြန်ယူရန်</Button>}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}
            className="h-auto min-h-11 py-2 text-xs leading-6">မဖယ်သိမ်းတော့ပါ</Button>
          <Button type="button" disabled={props.disabled || busy || blocked || !name || confirmation.trim() !== name}
            onClick={() => void archive()} className="h-auto min-h-11 py-2 text-xs leading-6">
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Archive className="mr-2 size-4" />}
            {busy ? "ဖယ်သိမ်းနေသည်…" : "စာရင်းမှဖယ်သိမ်းမည်"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
