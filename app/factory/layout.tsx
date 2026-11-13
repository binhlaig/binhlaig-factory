import { Suspense, type ReactNode } from "react";

// import AuthTokenSync from "@/components/AuthTokenSync";
// import AuthTokenGuard from "@/components/auth/AuthTokenGuard";
// import SyncUser from "@/components/auth/SyncUser";
import { BusinessAccessGate } from "@/components/factory/BusinessAccessGate";

import { LoadingScreen } from "@/components/loading-screen";
import { FactoryShell } from "@/components/factory/factoryShell";

export default function FactoryLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingScreen variant="page" title="Loading Factory…" />}>
     

     
        <BusinessAccessGate>
          <FactoryShell>
            {children}</FactoryShell>
        </BusinessAccessGate>
    
    </Suspense>
  );
}