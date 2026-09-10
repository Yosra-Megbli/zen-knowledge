export interface Fixtures {
  companies: Record<string, string>;
  users: Record<string, { id: string; role: string; department_id: string | null }>;
  departments: Record<string, string>;
  documents: Record<string, string>;
}

export function fixtures(): Promise<Fixtures>;
