import { auth } from "../../auth.ts";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-screen flex flex-col bg-cream-50">
      <header className="bg-white border-b border-ink-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-ink-950">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-clay-500 text-white text-xs font-display">
              Z
            </span>
            ZEN Knowledge
          </span>
          <nav className="flex gap-6 text-sm font-medium text-ink-500">
            <Link href="/chat" className="hover:text-clay-600 transition-colors">Chat</Link>
            <Link href="/documents" className="hover:text-clay-600 transition-colors">Documents</Link>
            {isAdmin && (
              <Link href="/admin" className="hover:text-clay-600 transition-colors">Admin</Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-ink-500">
          <span>{user.email}</span>
          <span className="px-2 py-0.5 rounded-full bg-clay-50 text-clay-700 text-xs font-medium capitalize">
            {user.role}
          </span>
          <form action="/api/auth/signout" method="POST">
            <button className="text-ink-300 hover:text-ink-700 transition-colors">Déconnexion</button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
