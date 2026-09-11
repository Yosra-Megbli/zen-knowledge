import { auth } from "../../auth.ts";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "../components/Logo.tsx";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-screen flex flex-col bg-paper-100">
      <header className="bg-ink-950 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Logo dark />
          <nav className="flex gap-6 text-sm font-medium text-ink-300">
            <Link href="/chat" className="hover:text-lime-400 transition-colors">Chat</Link>
            <Link href="/documents" className="hover:text-lime-400 transition-colors">Documents</Link>
            {isAdmin && (
              <Link href="/admin" className="hover:text-lime-400 transition-colors">Admin</Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-ink-300">
          <span>{user.email}</span>
          <span className="px-2 py-0.5 rounded-full bg-lime-500 text-ink-950 text-xs font-semibold capitalize">
            {user.role}
          </span>
          <form action="/api/auth/signout" method="POST">
            <button className="text-ink-300 hover:text-white transition-colors">Déconnexion</button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
