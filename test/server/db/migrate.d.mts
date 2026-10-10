/**
 * migrate.mjs의 타입 선언(WP2 소유).
 */
import type { SqlDb } from './postgres-store.mjs';

export const MIGRATIONS_DIR: string;

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export function listMigrations(dir?: string): MigrationFile[];

/** 이번에 적용한 번호 */
export function migrate(db: SqlDb, opts?: { dir?: string }): Promise<number[]>;
