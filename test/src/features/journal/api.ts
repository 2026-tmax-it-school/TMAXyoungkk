import { useSyncExternalStore } from 'react';

import type { DiaryEntry, Photo } from '../../types';
import type { PhotoProvider, PickedPhoto } from '../../core/ports';
import { composeDiary, diaryShareText } from '../../core/journal/diary';
import { buildPhoto } from '../../core/journal/photo';
import { appClock } from '../../services/clock';
import { getServices } from '../../services/registry';
import { shareText, type ShareOutcome } from '../../services/share';
import { PhotoPermissionDenied } from '../../services/photos/device';
import { createSimPhotoProvider } from '../../services/photos/sim';
import { useLive } from '../../store/live';
import { myMemberId, useTrips, type DispatchResult } from '../../store/trips';

/**
 * 기록 API(WP6 소유). 19 시뮬레이터 사진 이벤트와 20·21·22 화면이 쓴다.
 * 판정은 core/journal(순수)이 하고, 여기서는 스토어·서비스와 잇기만 한다.
 *
 * 웹 기기 사진은 uri가 blob:이라 문서에 넣지 않는다. 이 모듈의 메모리 맵에만 두고(sessionOnly),
 * 새로고침하거나 다른 기기에서 보면 '이 세션에서만 보임' 타일이 된다.
 */

/* ---------- 이 세션에서만 보이는 사진 ---------- */

const sessionUris = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version += 1;
  for (const l of listeners) l();
}

export function sessionPhotoUri(photoId: string): string | undefined {
  return sessionUris.get(photoId);
}

/**
 * 문서에 없는 사진의 세션 원본을 메모리에서 지운다. 계정 탈퇴나 다른 기기의 photoRemoved로 사진이 빠져도
 * data:·blob: 원본이 이 세션 메모리에 남지 않게 한다. 20·21 화면이 사진 목록이 바뀔 때 부른다.
 */
export function pruneSessionPhotos(photoIds: Iterable<string>): void {
  const keep = new Set(photoIds);
  let changed = false;
  for (const id of [...sessionUris.keys()]) {
    if (keep.has(id)) continue;
    sessionUris.delete(id);
    changed = true;
  }
  if (changed) bump();
}

/** 이 세션 사진 원본을 모두 지운다. 로그아웃·계정 탈퇴(signOutFlow)와 시연 리셋이 부른다. */
export function clearSessionPhotos(): void {
  if (sessionUris.size === 0) return;
  sessionUris.clear();
  bump();
}

/** 세션 사진 맵이 바뀌면 다시 그린다. */
export function useSessionPhotosVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => version,
    () => version,
  );
}

/* ---------- 사진 ---------- */

/**
 * 고른 사진을 여행방에 올린다(journal/photoAdded). 올라간 사진만 돌려준다.
 * fallbackDate: EXIF 없이 여행 기간 밖에서 올릴 때 넣을 날짜(20에서 고른 날짜 탭)
 */
export async function importPhotos(tripId: string, picked: PickedPhoto[], fallbackDate?: string): Promise<Photo[]> {
  const out: Photo[] = [];
  const { ids } = getServices();
  let changed = false;
  for (const p of picked) {
    const s = useTrips.getState();
    const trip = s.docs[tripId];
    if (!trip) break;
    const memberId = myMemberId(trip);
    if (!memberId) break;
    const { photo, sessionUri } = buildPhoto(p, {
      id: ids.next('ph'),
      memberId,
      now: appClock().now(),
      trip,
      plan: s.plans[tripId],
      fallbackDate,
    });
    const r = s.dispatch(tripId, { type: 'journal/photoAdded', photo });
    if (!r.ok) continue;
    if (sessionUri) {
      sessionUris.set(photo.id, sessionUri);
      changed = true;
    }
    out.push(photo);
  }
  if (changed) bump();
  return out;
}

/** 시드를 여행방 id에서 뽑는다(같은 방이면 같은 모의 사진 열). */
function seedOf(tripId: string): number {
  let h = 2166136261;
  for (let i = 0; i < tripId.length; i += 1) h = Math.imul(h ^ tripId.charCodeAt(i), 16777619);
  return h >>> 0;
}

const simProviders = new Map<string, PhotoProvider>();

/** 20 화면 '모의 사진'과 시연용. 시계는 앱 시계(시뮬레이터 가상 시각), 위치는 여행 진행의 마지막 위치 */
export function simPhotosFor(tripId: string): PhotoProvider {
  let p = simProviders.get(tripId);
  if (!p) {
    p = createSimPhotoProvider({
      clock: { now: () => appClock().now() },
      getPosition: () => useLive.getState().last?.coord,
      seed: seedOf(tripId),
    });
    simProviders.set(tripId, p);
  }
  return p;
}

export type PickResult =
  | { ok: true; photos: Photo[]; picked: number }
  | { ok: false; reason: 'permission' | 'failed'; message: string };

/** 사진 고르기 → 올리기. source 'device'는 등록된 사진 제공자(시뮬레이터가 덮으면 sim) */
export async function pickAndImport(tripId: string, source: 'device' | 'sim', fallbackDate?: string): Promise<PickResult> {
  const provider = source === 'sim' ? simPhotosFor(tripId) : getServices().photos;
  let picked: PickedPhoto[];
  try {
    picked = await provider.pick({ multiple: true });
  } catch (e) {
    return e instanceof PhotoPermissionDenied
      ? { ok: false, reason: 'permission', message: '사진 접근 권한이 없습니다. 설정에서 허용하면 올릴 수 있습니다' }
      : { ok: false, reason: 'failed', message: '사진을 불러오지 못했습니다. 다시 시도해 주세요' };
  }
  const photos = await importPhotos(tripId, picked, fallbackDate);
  return { ok: true, photos, picked: picked.length };
}

export function removePhoto(tripId: string, photoId: string): DispatchResult {
  const r = useTrips.getState().dispatch(tripId, { type: 'journal/photoRemoved', photoId });
  if (r.ok && sessionUris.delete(photoId)) bump();
  return r;
}

/* ---------- 일기 ---------- */

export type GenerateResult = { ok: true; entry: DiaryEntry } | { ok: false; entry: DiaryEntry; reason: string };

/**
 * 그날 일기를 만든다(journal/diaryGenerated). 작성기가 실패하면 빈 일기(status 'empty').
 * 저장이 거부되면(나간 멤버 등) ok false와 이유를 돌려주고 화면이 안내한다.
 */
export async function generateDiary(tripId: string, date: string, opts?: { quiet?: boolean }): Promise<GenerateResult> {
  const now = appClock().now();
  const trip = useTrips.getState().docs[tripId];
  if (!trip) return { ok: false, entry: { date, status: 'empty', blocks: [], generatedAt: now }, reason: '여행방을 찾을 수 없습니다' };
  const entry = await composeDiary(trip, date, getServices().diary, now);
  const r = useTrips.getState().dispatch(tripId, { type: 'journal/diaryGenerated', entry }, { quiet: opts?.quiet });
  if (!r.ok) return { ok: false, entry, reason: r.reason };
  return { ok: true, entry: useTrips.getState().docs[tripId]?.diaries[date] ?? entry };
}

export function editDiaryBlock(tripId: string, date: string, blockId: string, text: string): DispatchResult {
  return useTrips.getState().dispatch(tripId, { type: 'journal/diaryEdited', date, blockId, text });
}

/**
 * 공유 시트, 안 되면 클립보드 복사. 공유나 복사가 된 때만 journal/diaryShared.
 * 사용자가 시트를 닫으면(iOS dismissedAction, 웹 AbortError) services/share가 'dismissed'를 돌려주고 기록하지 않는다.
 */
export async function shareDiary(tripId: string, date: string): Promise<ShareOutcome | 'none'> {
  const trip = useTrips.getState().docs[tripId];
  const entry = trip?.diaries[date];
  if (!trip || !entry) return 'none';
  const outcome = await shareText({ title: `${trip.title} 일기`, text: diaryShareText(trip, entry) });
  if (outcome === 'shared' || outcome === 'copied') useTrips.getState().dispatch(tripId, { type: 'journal/diaryShared', date });
  return outcome;
}
