/**
 * 커뮤니티 PostgreSQL 저장소(WP2 소유, 2026-10-10). server/community.mjs createMemoryCommunityStore와 메서드·결과가 같다.
 * 표는 마이그레이션 005_community.sql의 community_posts·community_photos다. db는 postgres-store.mjs sqlDb()로 감싼 연결이다.
 * 글 하나와 사진은 한 트랜잭션으로 넣는다(사진만 남는 글이 생기지 않게).
 */

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const msOf = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Date.parse(v));

const POST_COLS = 'post_id, account_id, user_id, author_nickname, kind, title, body, created_at';

function rowToPost(r, photos) {
  return {
    id: r.post_id,
    accountId: r.account_id,
    userId: r.user_id,
    nickname: r.author_nickname,
    kind: r.kind,
    title: r.title,
    body: r.body,
    createdAt: msOf(r.created_at),
    photos,
  };
}

export function createPgCommunityStore(db) {
  return {
    kind: 'postgres',

    async insertPost(rec) {
      await db.tx(async (q) => {
        await q.query(`INSERT INTO community_posts (${POST_COLS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
          rec.id,
          rec.accountId,
          rec.userId,
          rec.nickname,
          rec.kind,
          rec.title,
          rec.body,
          iso(rec.createdAt),
        ]);
        let idx = 0;
        for (const p of rec.photos) {
          await q.query('INSERT INTO community_photos (photo_id, post_id, idx, mime, bytes) VALUES ($1, $2, $3, $4, $5)', [
            p.id,
            rec.id,
            idx,
            p.mime,
            p.bytes,
          ]);
          idx += 1;
        }
      });
    },

    async list({ before, limit, kind }) {
      const params = [];
      const where = [];
      if (kind) {
        params.push(kind);
        where.push(`kind = $${params.length}`);
      }
      if (before) {
        params.push(iso(before.createdAt), before.id);
        where.push(`(created_at, post_id) < ($${params.length - 1}::timestamptz, $${params.length})`);
      }
      params.push(limit);
      const { rows } = await db.query(
        `SELECT ${POST_COLS} FROM community_posts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, post_id DESC LIMIT $${params.length}`,
        params,
      );
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.post_id);
      const photos = await db.query('SELECT photo_id, post_id, mime FROM community_photos WHERE post_id = ANY($1::text[]) ORDER BY post_id, idx', [ids]);
      const byPost = new Map();
      for (const p of photos.rows) {
        if (!byPost.has(p.post_id)) byPost.set(p.post_id, []);
        byPost.get(p.post_id).push({ id: p.photo_id, mime: p.mime });
      }
      return rows.map((r) => rowToPost(r, byPost.get(r.post_id) ?? []));
    },

    async removePost(id, accountId) {
      const { rows } = await db.query('DELETE FROM community_posts WHERE post_id = $1 AND account_id = $2 RETURNING post_id', [id, accountId]);
      return rows.length > 0;
    },

    async removeByAccount(accountId) {
      const { rows } = await db.query('DELETE FROM community_posts WHERE account_id = $1 RETURNING post_id', [accountId]);
      return rows.length;
    },

    async photo(id) {
      const { rows } = await db.query('SELECT mime, bytes FROM community_photos WHERE photo_id = $1', [id]);
      const r = rows[0];
      return r ? { mime: r.mime, bytes: Buffer.from(r.bytes) } : null;
    },

    async countSince(accountId, since) {
      const { rows } = await db.query('SELECT count(*)::int AS n FROM community_posts WHERE account_id = $1 AND created_at >= $2', [accountId, iso(since)]);
      return Number(rows[0]?.n ?? 0);
    },

    async reset() {
      await db.query('TRUNCATE community_photos, community_posts');
    },
  };
}
