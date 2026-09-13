import { auth, signOut } from "../../auth.ts";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
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

  // Dedicated UI state for an authenticated user with no company_id:
  // Preserves fail-closed security (no RLS queries or children components run)
  // while explaining the situation clearly to the user instead of generic 401s.
  if (!user.companyId) {
    return (
      <div className="min-h-screen flex flex-col bg-paper-100">
        <header className="bg-ink-950 px-4 sm:px-6 py-3 flex items-center justify-between">
          <Logo dark />
          <div className="flex items-center gap-3 text-sm text-ink-300">
            <span className="hidden sm:inline">{user.email}</span>
            <form action={handleSignOut}>
              <button className="text-ink-300 hover:text-white transition-colors">Déconnexion</button>
            </form>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-ink-100 p-6 sm:p-8 max-w-md w-full shadow-sm text-center">
            <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto mb-4">
              <ShieldAlert size={24} />
            </div>
            <h1 className="text-lg font-semibold text-ink-900 mb-2">
              Compte non rattaché à une organisation
            </h1>
            <p className="text-sm text-ink-500 mb-6 leading-relaxed">
              Votre compte utilisateur (<strong className="text-ink-700">{user.email}</strong>) est bien authentifié, mais il n&apos;est actuellement rattaché à aucune société dans le système.
            </p>
            <div className="bg-paper-100 rounded-xl p-4 text-xs text-ink-600 text-left mb-6 border border-ink-100">
              <p className="font-medium text-ink-700 mb-1">Que devez-vous faire ?</p>
              <p>Veuillez contacter votre administrateur pour configurer votre accès et rattacher votre compte à votre entreprise.</p>
            </div>
            <form action={handleSignOut}>
              <button
                type="submit"
                className="w-full bg-ink-900 hover:bg-ink-800 text-white font-medium py-2.5 px-4 rounded-xl text-sm transition-colors"
              >
                Se déconnecter
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

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
