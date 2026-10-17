/**
 * 커뮤니티 PostgreSQL 저장소(WP2 소유, 2026-10-10). server/community.mjs createMemoryCommunityStore와 메서드·결과가 같다.
 * 표는 마이그레이션 005_community.sql의 community_posts·community_photos다(tags 열은 006_community_tags.sql).
 * db는 postgres-store.mjs sqlDb()로 감싼 연결이다. 글 하나와 사진은 한 트랜잭션으로 넣는다(사진만 남는 글이 생기지 않게).
 * 태그 거르기는 GIN 색인을 타도록 tags @> ARRAY[태그]로 묻는다.
 * 고치기(2026-10-17, edited_at 열은 008_community_edited.sql): 글 행과 사진(빠진 것 지우기·순서 다시 매기기·새 것 넣기)을 한 트랜잭션으로 바꾼다.
 */

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const msOf = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Date.parse(v));

const INSERT_COLS = 'post_id, account_id, user_id, author_nickname, kind, title, body, created_at, tags';
const POST_COLS = `${INSERT_COLS}, edited_at, views, likes`;

function rowToPost(r, photos) {
  return {
    id: r.post_id,
    accountId: r.account_id,
    userId: r.user_id,
    nickname: r.author_nickname,
    kind: r.kind,
    title: r.title,
    body: r.body,
    tags: Array.isArray(r.tags) ? [...r.tags] : [],
    createdAt: msOf(r.created_at),
    editedAt: r.edited_at == null ? null : Number(r.edited_at),
    views: Number(r.views ?? 0),
    likes: Number(r.likes ?? 0),
    photos,
  };
}

export function createPgCommunityStore(db) {
  return {
    kind: 'postgres',

    async insertPost(rec) {
      await db.tx(async (q) => {
        await q.query(`INSERT INTO community_posts (${INSERT_COLS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])`, [
          rec.id,
          rec.accountId,
          rec.userId,
          rec.nickname,
          rec.kind,
          rec.title,
          rec.body,
          iso(rec.createdAt),
          rec.tags ?? [],
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

    async getPost(id) {
      const { rows } = await db.query(`SELECT ${POST_COLS} FROM community_posts WHERE post_id = $1`, [id]);
      if (rows.length === 0) return null;
      const photos = await db.query('SELECT photo_id, mime FROM community_photos WHERE post_id = $1 ORDER BY idx', [id]);
      return rowToPost(rows[0], photos.rows.map((p) => ({ id: p.photo_id, mime: p.mime })));
    },

    async updatePost(id, accountId, patch) {
      return db.tx(async (q) => {
        const { rows } = await q.query(
          `UPDATE community_posts SET kind = $3, title = $4, body = $5, tags = $6::text[], edited_at = $7
            WHERE post_id = $1 AND account_id = $2 RETURNING ${POST_COLS}`,
          [id, accountId, patch.kind, patch.title, patch.body, patch.tags, patch.editedAt],
        );
        if (rows.length === 0) return null;
        const keep = patch.photos.filter((p) => !p.bytes).map((p) => p.id);
        await q.query('DELETE FROM community_photos WHERE post_id = $1 AND NOT (photo_id = ANY($2::text[]))', [id, keep]);
        // 남긴 사진의 순서를 다시 매긴다. (post_id, idx)가 겹치지 않게 먼저 음수로 비켜 둔다
        await q.query('UPDATE community_photos SET idx = -1 - idx WHERE post_id = $1', [id]);
        let idx = 0;
        for (const p of patch.photos) {
          if (p.bytes) {
            await q.query('INSERT INTO community_photos (photo_id, post_id, idx, mime, bytes) VALUES ($1, $2, $3, $4, $5)', [p.id, id, idx, p.mime, p.bytes]);
          } else {
            await q.query('UPDATE community_photos SET idx = $3 WHERE post_id = $1 AND photo_id = $2', [id, p.id, idx]);
          }
          idx += 1;
        }
        return rowToPost(rows[0], patch.photos.map((p) => ({ id: p.id, mime: p.mime })));
      });
    },

    async list({ before, limit, kind, tag, q }) {
      const params = [];
      const where = [];
      if (kind) {
        params.push(kind);
        where.push(`kind = $${params.length}`);
      }
      if (tag) {
        params.push([tag]);
        where.push(`tags @> $${params.length}::text[]`);
      }
      if (q) {
        // 제목에 들어 있거나 태그 하나에 들어 있다. LIKE 특수 문자(% _ \)는 글자 그대로 본다
        const like = (v) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        params.push(like(q));
        const titleIdx = params.length;
        const tagPart = q.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
        let tagSql = '';
        if (tagPart) {
          params.push(like(tagPart));
          tagSql = ` OR EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE t LIKE $${params.length} ESCAPE '\\')`;
        }
        where.push(`(title ILIKE $${titleIdx} ESCAPE '\\'${tagSql})`);
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

    async likedSet(accountId, ids) {
      if (ids.length === 0) return new Set();
      const { rows } = await db.query('SELECT post_id FROM community_post_likes WHERE account_id = $1 AND post_id = ANY($2::text[])', [accountId, ids]);
      return new Set(rows.map((r) => r.post_id));
    },

    async setLike(id, accountId, on) {
      return db.tx(async (q) => {
        if ((await q.query('SELECT 1 FROM community_posts WHERE post_id = $1', [id])).rows.length === 0) return null;
        if (on) {
          const ins = await q.query('INSERT INTO community_post_likes (post_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING post_id', [id, accountId]);
          if (ins.rows.length > 0) await q.query('UPDATE community_posts SET likes = likes + 1 WHERE post_id = $1', [id]);
        } else {
          const del = await q.query('DELETE FROM community_post_likes WHERE post_id = $1 AND account_id = $2 RETURNING post_id', [id, accountId]);
          if (del.rows.length > 0) await q.query('UPDATE community_posts SET likes = likes - 1 WHERE post_id = $1', [id]);
        }
        const { rows } = await q.query(`SELECT ${POST_COLS} FROM community_posts WHERE post_id = $1`, [id]);
        const photos = await q.query('SELECT photo_id, mime FROM community_photos WHERE post_id = $1 ORDER BY idx', [id]);
        return rowToPost(rows[0], photos.rows.map((p) => ({ id: p.photo_id, mime: p.mime })));
      });
    },

    async countView(id, viewerKey, day) {
      return db.tx(async (q) => {
        if ((await q.query('SELECT 1 FROM community_posts WHERE post_id = $1', [id])).rows.length === 0) return null;
        const ins = await q.query('INSERT INTO community_post_views (post_id, viewer_key, day) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING post_id', [id, viewerKey, day]);
        if (ins.rows.length > 0) await q.query('UPDATE community_posts SET views = views + 1 WHERE post_id = $1', [id]);
        return Number((await q.query('SELECT views FROM community_posts WHERE post_id = $1', [id])).rows[0].views);
      });
    },

    async removePost(id, accountId) {
      const { rows } = await db.query('DELETE FROM community_posts WHERE post_id = $1 AND account_id = $2 RETURNING post_id', [id, accountId]);
      return rows.length > 0;
    },

    async removeByAccount(accountId) {
      return db.tx(async (q) => {
        // 이 계정이 남의 글에 누른 좋아요를 돌려놓는다
        await q.query('UPDATE community_posts p SET likes = likes - 1 FROM community_post_likes l WHERE l.post_id = p.post_id AND l.account_id = $1', [accountId]);
        await q.query('DELETE FROM community_post_likes WHERE account_id = $1', [accountId]);
        const { rows } = await q.query('DELETE FROM community_posts WHERE account_id = $1 RETURNING post_id', [accountId]);
        return rows.length;
      });
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
      await db.query('TRUNCATE community_post_views, community_post_likes, community_photos, community_posts');
    },
  };
}
