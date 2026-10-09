import { LoadingStatus } from "@/components/loading";

export default function Loading() {
  return <div className="panel p-6" aria-busy="true"><LoadingStatus /></div>;
}
