import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  authorizeCredentials,
  applyUserToToken,
  applyTokenToSessionUser,
  type AuthorizedUser,
  type MinimalToken,
} from "./lib/auth/callbacks.ts";

// Auth.js identifies the user. It is NOT a second authorization system:
// the only three fields this project cares about (companyId, role,
// departmentId) are copied here from a single database lookup and
// nowhere else — everything downstream (lib/permissions/authContext.ts,
// lib/db/withAuthContext.ts, PostgreSQL RLS) is the real security
// boundary. See README "Authentication architecture" for the full flow.
//
// The actual logic lives in lib/auth/callbacks.ts, free of any
// `next-auth`/`next/*` import, so it can be unit-tested directly via
// node:test (auth.ts itself cannot: next-auth's module graph pulls in
// "next/server", which only resolves inside Next.js's own bundler).
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      return applyUserToToken(token as MinimalToken, user as AuthorizedUser | null | undefined);
    },
    async session({ session, token }) {
      applyTokenToSessionUser(session.user, token as MinimalToken);
      return session;
    },
  },
});
