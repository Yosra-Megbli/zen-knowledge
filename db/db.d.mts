import type { Client, PoolClient } from "pg";

export interface AuthContextLike {
  companyId?: string;
  role?: string;
  departmentId?: string;
}

export function getMigrationClient(): Promise<Client>;
export function getAppClient(): Promise<Client>;
export function withAuthContext<T>(
  client: Client,
  ctx: AuthContextLike,
  fn: (client: Client | PoolClient) => Promise<T>
): Promise<T>;
