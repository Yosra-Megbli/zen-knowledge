import { redirect } from "next/navigation";
import { auth } from "../auth.ts";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/chat");
  redirect("/login");
}
