import type { Category, DiaryBlock, DiaryEntry, Member, Photo, Trip, Visit } from '../../types';
import type { DiaryWriteBlock, DiaryWriter } from '../ports';
import { dayLabel, kstDate, kstHHMM } from '../util';
import { isDateAssigned, photosOn } from './photo';

/**
 * 자동 일기(FR-702·703, WP6 소유, 순수).
 * 그날 사진·도착 기록·장소를 스팟 단위 시간순 블록으로 묶고, DiaryWriter(템플릿 기본, AI는 프록시)로 설명문을 붙인다.
 * - 사진 0장이면 도착 기록만으로 만든다.
 * - 작성기가 던지면 status 'empty'인 빈 일기(블록은 두고 문장만 비움)를 준다. 앱은 죽지 않는다.
 * - 다시 만들어도 사용자가 고친 문장(editedAt)은 남는다. 블록 id가 바뀌면 사진이 겹치는 새 블록으로 옮기고,
 *   옮길 곳이 없으면 버리지 않고 그대로 둔다.
 */

/** 스팟이 없는 사진을 한 블록으로 묶는 간격 */
const FREE_BLOCK_GAP_MS = 60 * 60 * 1000;
export const FREE_PLACE_NAME = '이동 중';
/** 여행이 끝난 뒤 촬영 정보 없이 올려 날짜만 정한 사진 묶음 */
export const DATED_PLACE_NAME = '날짜만 정한 사진';

export interface DiaryBlockDraft {
  block: DiaryBlock;
  write: DiaryWriteBlock;
}

function nicknameOf(members: Member[], id: string): string | undefined {
  return members.find((m) => m.id === id)?.nickname;
}

function uniq(xs: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const x of xs) if (x && !out.includes(x)) out.push(x);
  return out;
}

interface Group {
  key: string;
  spotId?: string;
  placeName: string;
  category?: Category;
  time: number;
  photos: Photo[];
  visits: Visit[];
}

/** 그날 일기 블록 초안. 시간순이다. 블록 id는 날짜+스팟이라 다시 만들어도 같다. */
export function diaryBlocks(trip: Trip, date: string): DiaryBlockDraft[] {
  const groups = new Map<string, Group>();
  const spotOf = (id: string) => trip.spots.find((s) => s.id === id);

  const visits = trip.visits.filter((v) => v.date === date && v.status === 'arrived');
  for (const v of visits) {
    const spot = spotOf(v.spotId);
    const t = v.arrivedAt ?? v.at;
    const g = groups.get(v.spotId);
    if (g) {
      g.visits.push(v);
      g.time = Math.min(g.time, t);
    } else {
      groups.set(v.spotId, {
        key: v.spotId,
        spotId: v.spotId,
        placeName: spot?.name ?? '방문한 곳',
        category: spot?.category,
        time: t,
        photos: [],
        visits: [v],
      });
    }
  }

  const free: Photo[] = [];
  const dated: Photo[] = [];
  for (const p of photosOn(trip, date)) {
    if (!p.spotId) {
      (isDateAssigned(p) ? dated : free).push(p);
      continue;
    }
    const spot = spotOf(p.spotId);
    const g = groups.get(p.spotId);
    if (g) {
      g.photos.push(p);
      g.time = Math.min(g.time, p.takenAt);
    } else {
      groups.set(p.spotId, {
        key: p.spotId,
        spotId: p.spotId,
        placeName: spot?.name ?? '사진 속 장소',
        category: spot?.category,
        time: p.takenAt,
        photos: [p],
        visits: [],
      });
    }
  }

  // 묶음 키는 시작 시각의 시(時)다. 사진 구성이 조금 바뀌어도 id가 그대로라 고친 문장이 남는다.
  // 다음 묶음은 앞 묶음 시작보다 1시간 넘게 뒤라 같은 시가 되지 않는다.
  let cur: Group | undefined;
  for (const p of free) {
    if (!cur || p.takenAt - cur.photos[cur.photos.length - 1].takenAt > FREE_BLOCK_GAP_MS) {
      cur = { key: `free-${kstHHMM(p.takenAt).slice(0, 2)}`, placeName: FREE_PLACE_NAME, time: p.takenAt, photos: [], visits: [] };
      groups.set(cur.key, cur);
    }
    cur.photos.push(p);
  }
  if (dated.length > 0) {
    groups.set('dated', { key: 'dated', placeName: DATED_PLACE_NAME, time: dated[0].takenAt, photos: dated, visits: [] });
  }

  return [...groups.values()]
    .sort((a, b) => a.time - b.time || (a.key < b.key ? -1 : 1))
    .map((g) => {
      const time = kstHHMM(g.time);
      const memberNames = uniq([
        ...g.visits.map((v) => nicknameOf(trip.members, v.memberId)),
        ...g.photos.map((p) => nicknameOf(trip.members, p.memberId)),
      ]);
      const block: DiaryBlock = {
        id: `${date}:${g.key}`,
        time,
        placeName: g.placeName,
        photoIds: g.photos.map((p) => p.id),
        text: '',
      };
      if (g.spotId) block.spotId = g.spotId;
      const write: DiaryWriteBlock = { time, placeName: g.placeName, photoCount: g.photos.length, memberNames };
      if (g.category) write.category = g.category;
      return { block, write };
    });
}

/** 일기 한 편을 만든다. 작성기가 실패하면 빈 일기(status 'empty') */
export async function composeDiary(
  trip: Trip,
  date: string,
  writer: DiaryWriter,
  now: number,
): Promise<DiaryEntry> {
  const drafts = diaryBlocks(trip, date);
  const blank = drafts.map((d) => d.block);
  if (drafts.length === 0) return { date, status: 'empty', blocks: [], generatedAt: now };
  let texts: unknown;
  try {
    texts = await writer.write({ date, blocks: drafts.map((d) => d.write) });
  } catch {
    return { date, status: 'empty', blocks: blank, generatedAt: now };
  }
  if (!Array.isArray(texts)) return { date, status: 'empty', blocks: blank, generatedAt: now };
  const list = texts as unknown[];
  const blocks = blank.map((b, i) => ({ ...b, text: typeof list[i] === 'string' ? (list[i] as string).trim() : '' }));
  const anyText = blocks.some((b) => b.text.length > 0);
  return { date, status: anyText ? 'auto' : 'empty', blocks, generatedAt: now };
}

function withEdit(b: DiaryBlock, e: DiaryBlock): DiaryBlock {
  const out: DiaryBlock = { ...b, text: e.text, editedAt: e.editedAt };
  if (e.editedBy) out.editedBy = e.editedBy;
  return out;
}

/**
 * 다시 만든 일기에 사용자가 고친 문장과 공유 시각을 옮긴다.
 * 1. 같은 id 블록으로 옮긴다.
 * 2. id가 없어졌으면(스팟 없는 묶음이 합쳐지거나 나뉨) 사진이 가장 많이 겹치는 새 블록 중 아직 고친 문장이 없는 곳으로 옮긴다.
 * 3. 그래도 없으면 고친 블록을 그대로 남긴다(사진은 새 블록에 들어간 것을 빼고). 사용자가 쓴 문장은 말없이 사라지지 않는다.
 */
export function mergeRegenerated(prev: DiaryEntry | undefined, next: DiaryEntry): DiaryEntry {
  if (!prev) return next;
  const edits = prev.blocks.filter((b) => b.editedAt != null);
  const blocks = [...next.blocks];
  const taken = new Set<number>();
  const orphans: DiaryBlock[] = [];
  for (const e of edits) {
    const i = blocks.findIndex((b) => b.id === e.id);
    if (i >= 0) {
      blocks[i] = withEdit(blocks[i], e);
      taken.add(i);
      continue;
    }
    orphans.push(e);
  }
  const rest: DiaryBlock[] = [];
  for (const e of orphans) {
    let best = -1;
    let bestOverlap = 0;
    blocks.forEach((b, i) => {
      if (taken.has(i)) return;
      const overlap = b.photoIds.filter((id) => e.photoIds.includes(id)).length;
      if (overlap > bestOverlap) {
        best = i;
        bestOverlap = overlap;
      }
    });
    if (best >= 0) {
      blocks[best] = withEdit(blocks[best], e);
      taken.add(best);
    } else {
      rest.push(e);
    }
  }
  if (rest.length > 0) {
    const used = new Set(blocks.flatMap((b) => b.photoIds));
    for (const e of rest) blocks.push({ ...e, photoIds: e.photoIds.filter((id) => !used.has(id)) });
    blocks.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  }
  const merged: DiaryEntry = { ...next, blocks };
  if (prev.sharedAt != null) merged.sharedAt = prev.sharedAt;
  if (blocks.some((b) => b.text.length > 0) && merged.status === 'empty' && next.blocks.length > 0) {
    // 작성기는 실패했어도 사용자가 쓴 문장이 있으면 빈 일기가 아니다.
    merged.status = 'auto';
  }
  return merged;
}

/** 공유용 평문 */
export function diaryShareText(trip: Pick<Trip, 'title'>, entry: DiaryEntry): string {
  const lines = [`${trip.title} · ${dayLabel(entry.date)} 일기`, ''];
  for (const b of entry.blocks) {
    lines.push(`${b.time} ${b.placeName}`);
    if (b.text) lines.push(b.text);
    if (b.photoIds.length > 0) lines.push(`사진 ${b.photoIds.length}장`);
    lines.push('');
  }
  lines.push('Young Trip 여행 기록');
  return lines.join('\n');
}

/** 일기를 만들 수 있는 날짜: 여행 기간 중 사진이나 도착 기록이 있는 날 */
export function datesWithRecords(trip: Trip): string[] {
  const set = new Set<string>();
  for (const v of trip.visits) if (v.status === 'arrived') set.add(v.date);
  for (const p of trip.photos) set.add(kstDate(p.takenAt));
  return [...set].filter((d) => d >= trip.startDate && d <= trip.endDate).sort();
}

export interface DiaryStaleness {
  /** 일기를 만든 뒤 새로 들어온 그날 사진·도착 기록 수 */
  newRecords: number;
  /** 사진이 지워져 자동 문장을 비운 문단 수(고친 문장 없음) */
  blankBlocks: number;
}

/** 만든 일기가 기록보다 뒤처졌는지. 21이 '새 기록 N건 · 다시 만들기' 안내에 쓴다. */
export function diaryStaleness(trip: Trip, entry: DiaryEntry): DiaryStaleness {
  const inEntry = new Set(entry.blocks.flatMap((b) => b.photoIds));
  const photos = photosOn(trip, entry.date).filter((p) => !inEntry.has(p.id) && p.uploadedAt > entry.generatedAt).length;
  const visits = trip.visits.filter(
    (v) => v.date === entry.date && v.status === 'arrived' && v.at > entry.generatedAt && !entry.blocks.some((b) => b.spotId === v.spotId),
  ).length;
  const blankBlocks =
    entry.status === 'auto' ? entry.blocks.filter((b) => b.editedAt == null && b.text.trim() === '').length : 0;
  return { newRecords: photos + visits, blankBlocks };
}
