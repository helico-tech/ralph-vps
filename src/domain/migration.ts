export interface Migration {
  id: string;
  description: string;
  apply: (projectRoot: string) => Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  // Migrations will be added here as the schema evolves
];

export function pendingMigrations(appliedIds: string[]): Migration[] {
  return MIGRATIONS.filter((m) => !appliedIds.includes(m.id));
}
