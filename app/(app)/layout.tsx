import { auth } from "../../auth.ts";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-bold text-lg tracking-tight text-indigo-700">ZEN Knowledge</span>
          <nav className="flex gap-6 text-sm font-medium text-gray-600">
            <Link href="/chat" className="hover:text-indigo-700 transition-colors">Chat</Link>
            <Link href="/documents" className="hover:text-indigo-700 transition-colors">Documents</Link>
            {isAdmin && (
              <Link href="/admin" className="hover:text-indigo-700 transition-colors">Admin</Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>{user.email}</span>
          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium capitalize">
            {user.role}
          </span>
          <form action="/api/auth/signout" method="POST">
            <button className="text-gray-400 hover:text-gray-700 transition-colors">Déconnexion</button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
