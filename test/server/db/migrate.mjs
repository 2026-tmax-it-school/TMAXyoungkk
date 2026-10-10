/**
 * 버전 관리 마이그레이션(WP2 소유). server/db/migrations/NNN_이름.sql을 번호 순으로 한 번씩 적용한다.
 *
 * - 서버 시작 때 한 번 부른다. 이미 적용한 번호는 건너뛰므로 다시 돌려도 안전하다
 * - 한 트랜잭션 안에서 advisory 잠금을 먼저 잡는다. 서버 여러 대가 동시에 떠도 한 곳만 적용하고 나머지는 기다렸다가 건너뛴다
 *   (DDL도 트랜잭션 안이라 중간에 실패하면 아무것도 남지 않는다)
 * - 적용한 파일이 나중에 바뀌면(체크섬 불일치) 멈춘다. 스키마를 고칠 때는 새 번호 파일을 더한다
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** 마이그레이션 잠금 키(이 서버만 쓰는 임의 값) */
const MIGRATION_LOCK = 72_010_009;

/** 폴더의 마이그레이션 파일을 번호 순으로 읽는다. 줄 끝(CRLF)은 체크섬 전에 맞춘다. */
export function listMigrations(dir = MIGRATIONS_DIR) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const m = /^(\d+)_[\w-]+\.sql$/.exec(name);
    if (!m) continue;
    const sql = readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n');
    out.push({ version: Number(m[1]), name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  out.sort((a, b) => a.version - b.version);
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].version === out[i - 1].version) throw new Error(`마이그레이션 번호가 겹칩니다: ${out[i - 1].name}, ${out[i].name}`);
  }
  return out;
}

/** 아직 적용하지 않은 마이그레이션을 적용하고, 이번에 적용한 번호를 돌려준다. */
export async function migrate(db, { dir = MIGRATIONS_DIR } = {}) {
  const files = listMigrations(dir);
  return db.tx(async (q) => {
    await q.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`);
    await q.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version    integer PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );
    const { rows } = await q.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    const done = new Map(rows.map((r) => [Number(r.version), r]));
    for (const f of files) {
      const prev = done.get(f.version);
      if (prev && prev.checksum !== f.checksum) {
        throw new Error(`마이그레이션 ${prev.name}이 적용된 뒤 바뀌었습니다. 스키마는 새 번호 파일로 고칩니다`);
      }
    }
    const applied = [];
    for (const f of files) {
      if (done.has(f.version)) continue;
      await q.exec(f.sql);
      await q.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [f.version, f.name, f.checksum]);
      applied.push(f.version);
    }
    return applied;
  });
}
