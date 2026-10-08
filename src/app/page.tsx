import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/auth/session";

export default async function Home() {
  redirect(await getIdentity() ? "/dashboard" : "/login");
}
