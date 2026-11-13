"use client";

import * as React from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  sheetRequest,
  type CostingSheet,
  type CostingServerItem,
} from "@/lib/costing-api";

// Internal factory identifier: stable across price edits, distinct for copied items.
export function costingBarcode(sheetId: number, itemId: number) {
  if (![sheetId, itemId].every((id) => Number.isSafeInteger(id) && id > 0))
    throw new Error("Invalid product ID");
  return `FC-${sheetId}-${itemId}`;
}
export function parseCostingBarcode(value: string) {
  const match = /^FC-([1-9]\d*)-([1-9]\d*)$/i.exec(value.trim());
  if (!match) return null;
  const sheetId = Number(match[1]),
    itemId = Number(match[2]);
  return [sheetId, itemId].every(Number.isSafeInteger)
    ? { sheetId, itemId }
    : null;
}
export async function findCostingBarcode(value: string) {
  const ids = parseCostingBarcode(value);
  if (!ids)
    throw new Error("Barcode ကို FC-စာရင်းID-ပစ္စည်းID ပုံစံဖြင့် ထည့်ပါ။");
  // Existing API enforces the signed-in owner's shop; never fetch an untrusted URL.
  const sheet = await sheetRequest(`/${ids.sheetId}`);
  const item = sheet.items.find((entry) => entry.id === ids.itemId);
  if (!item)
    throw new Error(
      "ဒီ barcode အတွက် ပစ္စည်းမတွေ့ပါ။ ဖျက်ထားပြီး ဖြစ်နိုင်ပါသည်။",
    );
  return { sheet, item };
}
export function CostingBarcode({
  sheetId,
  itemId,
}: {
  sheetId: number;
  itemId: number;
}) {
  const code = costingBarcode(sheetId, itemId);
  const svg = React.useRef<SVGSVGElement>(null);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    if (svg.current)
      JsBarcode(svg.current, code, {
        format: "CODE128",
        displayValue: true,
        fontSize: 14,
        height: 50,
        width: 2,
        margin: 12,
        background: "#ffffff",
        lineColor: "#000000",
      });
  }, [code]);
  function download() {
    if (!svg.current) return;
    const content = new XMLSerializer().serializeToString(svg.current);
    const url = URL.createObjectURL(
      new Blob([content], { type: "image/svg+xml" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${code}.svg`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="my-3 min-w-0 rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-medium">ပစ္စည်း Barcode</p>
      <div className="mt-2 overflow-x-auto rounded-lg bg-white">
        <svg
          ref={svg}
          role="img"
          aria-label={`Barcode ${code}`}
          className="mx-auto block"
        />
      </div>
      <p className="mt-2 break-all font-mono text-xs">{code}</p>
      <div className="mt-2 flex flex-wrap gap-2 print:hidden">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setMessage("Barcode ကူးယူပြီးပါပြီ။");
            } catch {
              setMessage("အပေါ်က barcode စာသားကို ရွေးပြီး ကူးယူပါ။");
            }
          }}
        >
          Code ကူးရန်
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={download}>
          Barcode SVG သိမ်းရန်
        </Button>
      </div>
      <p role="status" className="mt-1 text-xs">
        {message}
      </p>
    </div>
  );
}
export function CostingBarcodeSearch() {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<{
    sheet: CostingSheet;
    item: CostingServerItem;
  } | null>(null);
  const sequence = React.useRef(0);
  const locked = React.useRef(false);
  const id = React.useId();
  React.useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const found = await findCostingBarcode(value);
      if (request === sequence.current) setResult(found);
    } catch (e) {
      if (request === sequence.current)
        setError(e instanceof Error ? e.message : "ရှာမရပါ။");
    } finally {
      locked.current = false;
      if (request === sequence.current) setBusy(false);
    }
  }
  return (
    <section
      className="my-4 space-y-3 rounded-2xl border border-border bg-card p-4 print:hidden"
      aria-label="Barcode ဖြင့် ပစ္စည်းရှာရန်"
    >
      <form
        onSubmit={search}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-sm font-medium">
            Barcode ဖြင့် တိုက်ရိုက်ရှာရန်
          </label>
          <Input
            id={id}
            value={value}
            disabled={busy}
            onChange={(e) => {
              setValue(e.target.value);
              setResult(null);
              setError("");
            }}
            placeholder="FC-12-34"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="mt-2"
          />
        </div>
        <Button type="submit" disabled={busy || !value.trim()}>
          {busy ? "ရှာနေသည်…" : "Barcode ရှာမည်"}
        </Button>
      </form>
      <p className="text-xs leading-6 text-muted-foreground">
        ဒီအကွက်ကို နှိပ်ပြီး barcode ရိုက်ထည့်ပါ သို့မဟုတ် scanner ဖြင့် ဖတ်ပြီး
        Enter နှိပ်ပါ။
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
        >
          <div>
            <p className="text-sm font-semibold">
              {String(result.item.inputs.product || "အမည်မဖြည့်ရသေးပါ")}
            </p>
            <p className="text-xs text-muted-foreground">
              {result.sheet.title}
            </p>
          </div>
          <Link
            href={`/factory/costing/products/${result.sheet.id}/${result.item.id}`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            ပစ္စည်းကြည့်ရန်
          </Link>
        </div>
      )}
    </section>
  );
}
