/**
 * 공유한 여행 일정 PostgreSQL 저장소(WP2 소유, 2026-10-17). server/itineraries.mjs createMemoryItineraryStore와 메서드·결과가 같다.
 * 표는 마이그레이션 009_shared_itineraries.sql의 shared_itineraries·shared_itinerary_likes·shared_itinerary_views다.
 */

const iso = (ms) => new Date(ms).toISOString();
const msOf = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const COLS =
  'share_id, account_id, user_id, author_nickname, title, region_id, region_label, note, tags, day_count, place_count, plan, views, likes, imports, created_at';

function row(r) {
  return {
    id: r.share_id,
    accountId: r.account_id,
    userId: r.user_id,
    nickname: r.author_nickname,
    title: r.title,
    regionId: r.region_id,
    regionLabel: r.region_label,
    note: r.note,
    tags: r.tags ?? [],
    dayCount: Number(r.day_count),
    placeCount: Number(r.place_count),
    plan: json(r.plan),
    views: Number(r.views),
    likes: Number(r.likes),
    imports: Number(r.imports),
    createdAt: msOf(r.created_at),
  };
}

const ORDER = {
  popular: '(imports * 5 + likes * 3 + views) DESC, created_at DESC, share_id DESC',
  new: 'created_at DESC, share_id DESC',
  views: 'views DESC, created_at DESC, share_id DESC',
};

export function createPgItineraryStore(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  const like = (v) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return {
    kind: 'postgres',

    async insert(rec) {
      await db.query(`INSERT INTO shared_itineraries (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12::jsonb,0,0,0,$13)`, [
        rec.id,
        rec.accountId,
        rec.userId,
        rec.nickname,
        rec.title,
        rec.regionId,
        rec.regionLabel,
        rec.note,
        rec.tags,
        rec.dayCount,
        rec.placeCount,
        JSON.stringify(rec.plan),
        iso(rec.createdAt),
      ]);
    },

    async get(id) {
      const r = await one(`SELECT ${COLS} FROM shared_itineraries WHERE share_id = $1`, [id]);
      return r ? row(r) : null;
    },

    async list({ sort, q, region, tag, offset, limit }) {
      const params = [];
      const where = [];
      if (region) {
        params.push(region);
        where.push(`region_id = $${params.length}`);
      }
      if (tag) {
        params.push([tag]);
        where.push(`tags @> $${params.length}::text[]`);
      }
      if (q) {
        params.push(like(q));
        const a = params.length;
        const tagPart = q.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
        let tagSql = '';
        if (tagPart) {
          params.push(like(tagPart));
          tagSql = ` OR EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE t LIKE $${params.length} ESCAPE '\\')`;
        }
        where.push(`(title ILIKE $${a} ESCAPE '\\' OR region_label ILIKE $${a} ESCAPE '\\'${tagSql})`);
      }
      params.push(limit, offset);
      const { rows } = await db.query(
        `SELECT ${COLS} FROM shared_itineraries ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${ORDER[sort] ?? ORDER.popular} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return rows.map(row);
    },

    async likedSet(accountId, ids) {
      if (ids.length === 0) return new Set();
      const { rows } = await db.query('SELECT share_id FROM shared_itinerary_likes WHERE account_id = $1 AND share_id = ANY($2::text[])', [accountId, ids]);
      return new Set(rows.map((r) => r.share_id));
    },

    async setLike(id, accountId, on) {
      return db.tx(async (q) => {
        const exists = (await q.query('SELECT 1 FROM shared_itineraries WHERE share_id = $1', [id])).rows.length > 0;
        if (!exists) return null;
        if (on) {
          const ins = await q.query('INSERT INTO shared_itinerary_likes (share_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING share_id', [id, accountId]);
          if (ins.rows.length > 0) await q.query('UPDATE shared_itineraries SET likes = likes + 1 WHERE share_id = $1', [id]);
        } else {
          const del = await q.query('DELETE FROM shared_itinerary_likes WHERE share_id = $1 AND account_id = $2 RETURNING share_id', [id, accountId]);
          if (del.rows.length > 0) await q.query('UPDATE shared_itineraries SET likes = likes - 1 WHERE share_id = $1', [id]);
        }
        return row((await q.query(`SELECT ${COLS} FROM shared_itineraries WHERE share_id = $1`, [id])).rows[0]);
      });
    },

    async countView(id, viewerKey, day) {
      return db.tx(async (q) => {
        const exists = (await q.query('SELECT 1 FROM shared_itineraries WHERE share_id = $1', [id])).rows.length > 0;
        if (!exists) return null;
        const ins = await q.query('INSERT INTO shared_itinerary_views (share_id, viewer_key, day) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING share_id', [id, viewerKey, day]);
        if (ins.rows.length > 0) await q.query('UPDATE shared_itineraries SET views = views + 1 WHERE share_id = $1', [id]);
        return row((await q.query(`SELECT ${COLS} FROM shared_itineraries WHERE share_id = $1`, [id])).rows[0]);
      });
    },

    async countImport(id) {
      const r = await one(`UPDATE shared_itineraries SET imports = imports + 1 WHERE share_id = $1 RETURNING ${COLS}`, [id]);
      return r ? row(r) : null;
    },

    async remove(id, accountId) {
      const { rows } = await db.query('DELETE FROM shared_itineraries WHERE share_id = $1 AND account_id = $2 RETURNING share_id', [id, accountId]);
      return rows.length > 0;
    },

    async removeByAccount(accountId) {
      return db.tx(async (q) => {
        // 이 계정이 누른 좋아요를 돌려놓고(다른 사람 일정의 숫자), 올린 일정을 지운다
        await q.query(
          'UPDATE shared_itineraries s SET likes = likes - 1 FROM shared_itinerary_likes l WHERE l.share_id = s.share_id AND l.account_id = $1',
          [accountId],
        );
        await q.query('DELETE FROM shared_itinerary_likes WHERE account_id = $1', [accountId]);
        const del = await q.query('DELETE FROM shared_itineraries WHERE account_id = $1 RETURNING share_id', [accountId]);
        return del.rows.length;
      });
    },

    async countSince(accountId, since) {
      const r = await one('SELECT count(*)::int AS n FROM shared_itineraries WHERE account_id = $1 AND created_at >= $2', [accountId, iso(since)]);
      return Number(r?.n ?? 0);
    },

    async reset() {
      await db.query('TRUNCATE shared_itinerary_views, shared_itinerary_likes, shared_itineraries');
    },
  };
}
