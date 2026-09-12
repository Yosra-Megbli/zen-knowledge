import { auth, signOut } from "../../auth.ts";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "../components/Logo.tsx";

// A plain <form action="/api/auth/signout"> POST has no CSRF token —
// Auth.js rejects it and redirects to its own unstyled error page
// (?error=MissingCSRF) instead of actually signing out. signOut() as
// a Server Action goes through Auth.js's own internals directly, csrf
// token included, and lands exactly on /login as requested.
async function handleSignOut() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const isAdmin = user.role === "admin";

  return (
    <div className="min-h-screen flex flex-col bg-paper-100">
      <header className="bg-ink-950 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 sm:gap-8">
          <Logo dark />
          <nav className="flex gap-4 sm:gap-6 text-sm font-medium text-ink-300">
            <Link href="/chat" className="hover:text-lime-400 transition-colors">Chat</Link>
            <Link href="/documents" className="hover:text-lime-400 transition-colors">Documents</Link>
            {isAdmin && (
              <Link href="/admin" className="hover:text-lime-400 transition-colors">Admin</Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 text-sm text-ink-300">
          {/* Long emails crowd out the badge/logout on narrow screens —
              the role badge alone is enough context there. */}
          <span className="hidden sm:inline">{user.email}</span>
          <span className="px-2 py-0.5 rounded-full bg-lime-500 text-ink-950 text-xs font-semibold capitalize">
            {user.role}
          </span>
          <form action={handleSignOut}>
            <button className="text-ink-300 hover:text-white transition-colors">Déconnexion</button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
