import { OfficeDirectory } from "@/components/factory/office-directory";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return <OfficeDirectory mode="orders" customerId={customerId} />;
}