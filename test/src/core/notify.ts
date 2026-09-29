import type { NotifyLogEntry, NotifyPrefs } from '../types';
import { NOTIFY_COOLDOWN_MS } from './constants';

/**
 * 알림 제한(비기능 알림). 동일 유형·같은 키는 30분에 1회, 유형별로 끌 수 있다.
 * 지연·빈 시간·도착(WP5)과 세션 만료(WP1)가 전부 이 두 함수만 쓴다.
 * key는 상황을 구분한다. 지연·빈 시간은 'tripId:date'(유형 단위), 도착은 'tripId:date:spotId',
 * 세션 만료는 세션 창('userId:expiresAt')이다.
 */

export function shouldNotify(log: NotifyLogEntry[], entry: NotifyLogEntry, prefs: NotifyPrefs): boolean {
  if (!prefs[entry.kind]) return false;
  return !log.some(
    (l) => l.kind === entry.kind && l.key === entry.key && entry.at - l.at < NOTIFY_COOLDOWN_MS,
  );
}

/** 알림을 기록하고 30분이 지난 항목은 정리한다. */
export function recordNotify(log: NotifyLogEntry[], entry: NotifyLogEntry, now: number): NotifyLogEntry[] {
  return [...log.filter((l) => now - l.at < NOTIFY_COOLDOWN_MS), entry];
}
