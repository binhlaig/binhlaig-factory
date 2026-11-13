import type { ReactNode } from "react";
import { CostingRouteWorkspace } from "@/components/factory/costing-workspace";

export default function CostingLayout({ children }: { children: ReactNode }) {
  return <CostingRouteWorkspace>{children}</CostingRouteWorkspace>;
}