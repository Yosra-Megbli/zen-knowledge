import type { DefaultSession } from "next-auth";

// Extends Auth.js's built-in types with the fields this project's
// authorization context needs. These are the ONLY extra fields carried
// by the session/JWT — see auth.ts for where they are populated
// (exclusively from the database lookup in authorize(), never from
// client input) and lib/permissions/authContext.ts for how they are
// consumed.
declare module "next-auth" {
  interface User {
    companyId: string | null;
    role: "admin" | "contributor" | "employee";
    departmentId: string | null;
  }

  interface Session {
    user: {
      id: string;
      companyId: string | null;
      role: "admin" | "contributor" | "employee";
      departmentId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    companyId?: string | null;
    role?: "admin" | "contributor" | "employee";
    departmentId?: string | null;
  }
}
