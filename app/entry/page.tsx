import { Suspense } from "react";
import { LoadingScreen } from "@/components/loading-screen";
import { BusinessAccessGate } from "@/components/factory/BusinessAccessGate";

export default function EntryPage() {
  return (
    <Suspense fallback={<LoadingScreen title="Checking business access…" />}>
      <BusinessAccessGate entry />
    </Suspense>
  );
}