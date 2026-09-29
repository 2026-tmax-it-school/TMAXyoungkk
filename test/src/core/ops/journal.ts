import type { DiaryBlock, DiaryEntry, Op, Trip } from '../../types';
import { mergeRegenerated } from '../journal/diary';
import { isForbiddenUri } from '../journal/photo';
import { lww } from './lww';

/**
 * journal/* 리듀서(WP6 소유). 전 멤버가 쓴다. 종료 잠금 예외다(LOCK_EXEMPT): 여행이 끝나도 사진 추가와 일기 편집이 된다.
 * - photoAdded: blob:·data: uri 거부, 본인 사진만, 같은 id는 한 번
 * - photoRemoved: 사진을 지우고 일기 블록 photoIds에서도 뺀다(계정 탈퇴 때 WP1이 보낸다). 올린 본인만(나간 뒤·탈퇴 포함).
 *   남의 사진 삭제 권한(방장 등)은 명세 미결정(탈퇴 멤버 사진 정책)이라 두지 않는다.
 *   사진이 빠진 문단의 자동 문장(고친 적 없음)은 사진 수가 틀려지므로 비운다. 사진도 도착 기록도 없어진 문단은 뺀다.
 * - visit: 같은 id는 visit.at이 늦은 쪽. 본인 방문 기록만
 * - diaryGenerated: generatedAt 나중 저장 우선(FR-703, FR-503과 같은 정책). 늦게 동기화된 오래된 재생성은 버린다.
 *   다시 만들어도 사용자가 고친 문장은 남는다
 * - diaryEdited: 블록 문장 필드 LWW(op.at, FR-503과 같은 정책). 문장이 모두 비면 status 'empty'
 * - diaryShared: 공유 시각
 */

const DIARY_TEXT_MAX = 1000;

function actorOf(doc: Trip, op: Op) {
  return doc.members.find((m) => m.id === op.actorId);
}

export function reduce(doc: Trip, op: Op): Trip {
  switch (op.type) {
    case 'journal/photoAdded': {
      if (doc.photos.some((p) => p.id === op.photo.id)) return doc;
      return { ...doc, photos: [...doc.photos, op.photo] };
    }
    case 'journal/photoRemoved': {
      if (!doc.photos.some((p) => p.id === op.photoId)) return doc;
      const diaries: Record<string, DiaryEntry> = {};
      for (const [date, e] of Object.entries(doc.diaries)) {
        if (!e.blocks.some((b) => b.photoIds.includes(op.photoId))) {
          diaries[date] = e;
          continue;
        }
        const blocks: DiaryBlock[] = [];
        for (const b of e.blocks) {
          if (!b.photoIds.includes(op.photoId)) {
            blocks.push(b);
            continue;
          }
          const photoIds = b.photoIds.filter((id) => id !== op.photoId);
          const edited = b.editedAt != null;
          const visited = !!b.spotId && doc.visits.some((v) => v.date === date && v.spotId === b.spotId && v.status === 'arrived');
          if (photoIds.length === 0 && !visited && !edited) continue;
          blocks.push(edited ? { ...b, photoIds } : { ...b, photoIds, text: '' });
        }
        diaries[date] = { ...e, blocks };
      }
      return { ...doc, photos: doc.photos.filter((p) => p.id !== op.photoId), diaries };
    }
    case 'journal/visit': {
      const i = doc.visits.findIndex((v) => v.id === op.visit.id);
      if (i < 0) return { ...doc, visits: [...doc.visits, op.visit] };
      if (!lww(doc.visits[i].at, op.visit.at)) return doc;
      const visits = [...doc.visits];
      visits[i] = op.visit;
      return { ...doc, visits };
    }
    case 'journal/diaryGenerated': {
      const date = op.entry.date;
      const prev = doc.diaries[date];
      if (prev && !lww(prev.generatedAt, op.entry.generatedAt)) return doc;
      return { ...doc, diaries: { ...doc.diaries, [date]: mergeRegenerated(doc.diaries[date], op.entry) } };
    }
    case 'journal/diaryEdited': {
      const e = doc.diaries[op.date];
      if (!e) return doc;
      const i = e.blocks.findIndex((b) => b.id === op.blockId);
      if (i < 0 || !lww(e.blocks[i].editedAt, op.at)) return doc;
      const blocks = [...e.blocks];
      blocks[i] = { ...blocks[i], text: op.text, editedAt: op.at, editedBy: op.actorId };
      const status = blocks.some((b) => b.text.trim().length > 0) ? 'auto' : 'empty';
      return { ...doc, diaries: { ...doc.diaries, [op.date]: { ...e, blocks, status } } };
    }
    case 'journal/diaryShared': {
      const e = doc.diaries[op.date];
      if (!e) return doc;
      return { ...doc, diaries: { ...doc.diaries, [op.date]: { ...e, sharedAt: op.at } } };
    }
    default:
      return doc;
  }
}

export function validate(doc: Trip, op: Op): string | null {
  const actor = actorOf(doc, op);
  if (!actor) return '이 여행방의 멤버가 아닙니다';
  const active = actor.leftAt == null;
  switch (op.type) {
    case 'journal/photoAdded': {
      if (!active) return '나간 멤버는 사진을 올릴 수 없습니다';
      if (op.photo.memberId !== actor.id) return '본인 사진만 올릴 수 있습니다';
      if (isForbiddenUri(op.photo.uri)) return '브라우저 임시 주소(blob:·data:)는 저장하지 않습니다';
      if (doc.photos.some((p) => p.id === op.photo.id)) return '이미 올린 사진입니다';
      return null;
    }
    case 'journal/photoRemoved': {
      const p = doc.photos.find((x) => x.id === op.photoId);
      if (!p) return '사진을 찾을 수 없습니다';
      // 올린 사람은 나간 뒤(계정 탈퇴 포함)에도 자기 사진을 지울 수 있다. 남의 사진은 정책 미결정이라 막는다.
      if (p.memberId !== actor.id) return '올린 사람만 사진을 지울 수 있습니다';
      return null;
    }
    case 'journal/visit': {
      if (op.visit.memberId !== actor.id) return '본인 방문 기록만 남길 수 있습니다';
      if (!doc.spots.some((s) => s.id === op.visit.spotId)) return '스팟을 찾을 수 없습니다';
      return null;
    }
    case 'journal/diaryGenerated': {
      if (!active) return '나간 멤버는 일기를 만들 수 없습니다';
      const d = op.entry.date;
      if (d < doc.startDate || d > doc.endDate) return '여행 기간 밖 날짜입니다';
      return null;
    }
    case 'journal/diaryEdited': {
      if (!active) return '나간 멤버는 일기를 고칠 수 없습니다';
      const e = doc.diaries[op.date];
      if (!e || !e.blocks.some((b) => b.id === op.blockId)) return '일기 문단을 찾을 수 없습니다';
      if (op.text.length > DIARY_TEXT_MAX) return `문장은 ${DIARY_TEXT_MAX}자까지 쓸 수 있습니다`;
      return null;
    }
    case 'journal/diaryShared': {
      if (!doc.diaries[op.date]) return '아직 일기가 없습니다';
      return null;
    }
    default:
      return null;
  }
}
