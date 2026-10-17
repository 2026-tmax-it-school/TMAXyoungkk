import type { NotifyKind, NotifyPrefs, Session, Trip } from '../../types';
import type { LocationPermission } from '../../core/ports';
import { isExpirySoon, tokenTail } from '../../core/session';
import { retentionUntil } from '../../core/tripStatus';
import { kstDate } from '../../core/util';

/**
 * 18 프로필 탭 · 설정 문구(WP1 소유, 순수). wp1-home·wp1-profile-ux 테스트가 node로 부른다.
 * ListRow의 sub에는 현재 값만 짧게 적는다(설명 문장은 시트 안에).
 */

export const NOTIFY_ROWS: { kind: NotifyKind; label: string; sub: string }[] = [
  { kind: 'delay', label: '뒤 일정 조정안', sub: '15분 이상 밀릴 때' },
  { kind: 'arrival', label: '도착 확인', sub: '100m 안에 3분' },
  { kind: 'freeTime', label: '빈 시간 추천', sub: '30분 이상 빌 때' },
  { kind: 'sessionExpiry', label: '게스트 세션 만료 안내', sub: '만료 3일 전' },
];

/** 프로필 탭 '알림' 줄의 sub. 모두 켜짐, 모두 꺼짐, 아니면 'N개 켜짐' */
export function notifySummary(prefs: NotifyPrefs): string {
  const on = NOTIFY_ROWS.filter((r) => prefs[r.kind]).length;
  if (on === NOTIFY_ROWS.length) return '모두 켜짐';
  if (on === 0) return '모두 꺼짐';
  return `${NOTIFY_ROWS.length}개 중 ${on}개 켜짐`;
}

export const PERMISSION_LABEL: Record<LocationPermission, string> = {
  granted: '허용됨',
  denied: '거부됨 · 수동 진행 모드',
  undetermined: '아직 묻지 않음',
};

export interface SessionSummary {
  title: string;
  lines: string[];
  soon: boolean;
}

/** 세션 요약. 토큰은 끝 4자리만 보인다. */
export function sessionSummary(session: Session | undefined, now: number): SessionSummary {
  if (!session) return { title: '세션 없음', lines: ['닉네임으로 게스트를 시작하거나 로그인해 주세요.'], soon: false };
  const until = kstDate(session.expiresAt);
  if (session.kind === 'guest') {
    return {
      title: `게스트 · ${session.nickname}`,
      lines: [
        `${until}까지 유지 · 쓸 때마다 30일 연장`,
        `기기 토큰 ${tokenTail(session)} · 이 기기 한정, 만료되면 복구할 수 없음`,
      ],
      soon: isExpirySoon(session, now),
    };
  }
  return {
    title: `계정 · ${session.nickname}`,
    lines: [
      `${session.email ?? ''} · 로그인 ${until}까지 유지, 쓸 때마다 30일 연장`,
      `기기 토큰 ${tokenTail(session)}`,
    ],
    soon: false,
  };
}

/** 데이터 보존 안내(시트 본문). 여행방이 있으면 그 방의 보관 기한을 적는다. */
export function retentionText(trip: Trip | undefined): string {
  const base = '여행방·채팅·사진은 여행이 끝나고 1년 동안 보관하고, 그 뒤 이 기기에서 지워요. 위치 이력은 끝나고 90일 동안만 둬요.';
  if (!trip) return base;
  return `${base} ${trip.title} · ${kstDate(retentionUntil(trip) - 1)}까지 보관해요.`;
}

/** 프로필 탭 '데이터 보존' 줄의 sub(현재 값만). 여행방이 있으면 마지막 보관일 */
export function retentionShort(trip: Trip | undefined): string {
  if (!trip) return '여행 끝나고 1년 보관';
  return `${kstDate(retentionUntil(trip) - 1)}까지 보관`;
}

/**
 * 프로필 머리 한 줄의 뒷부분. 게스트는 유지 기한(곧 만료면 만료일), 계정은 이메일.
 * 내 프로필(17) 머리는 계정 종류를 칩으로 따로 보이므로 이것만 쓴다. 기기 토큰은 적지 않는다(시연 도구에서만 본다).
 */
export function heroDetail(session: Session | undefined, now: number): string {
  if (!session) return '로그인하지 않았어요';
  if (session.kind === 'guest') {
    const until = kstDate(session.expiresAt);
    return isExpirySoon(session, now) ? `${until}에 만료돼요` : `${until}까지 유지돼요`;
  }
  return session.email ?? '';
}

/** 프로필 탭 머리 한 줄(이름 아래). '게스트 · 2026-11-17까지 유지돼요', '계정 · minji@example.com' */
export function heroLine(session: Session | undefined, now: number): string {
  if (!session) return heroDetail(session, now);
  const kind = session.kind === 'guest' ? '게스트' : '계정';
  const detail = heroDetail(session, now);
  return detail ? `${kind} · ${detail}` : kind;
}

/** 프로필 탭 '내 여행 기록' 타일 숫자. 일기는 내용이 있는 날만 센다 */
export function recordCounts(trip: Pick<Trip, 'photos' | 'diaries'>): { photos: number; diaryDays: number } {
  return {
    photos: trip.photos.length,
    diaryDays: Object.values(trip.diaries).filter((e) => e.blocks.length > 0).length,
  };
}

/**
 * 프로필 탭 '내 여행 기록' 타일 라벨. 이름과 숫자(또는 두 낱말)를 줄바꿈으로 나눠 늘 두 줄로 쓴다.
 * 360px에서 타일 안쪽 너비가 63px뿐이라 '사진 12장', '기록 지도'가 한 줄에 안 들어가고, 웹은 한글을 낱말 가운데서
 * 끊는다('기록 지/도'). 미리 나누면 어디서도 낱말이 잘리지 않고 세 칸 높이가 같다. 스크린리더는 줄바꿈을 쉼으로 읽는다.
 */
export function recordTileLabels(c: { photos: number; diaryDays: number }): { photos: string; diary: string; map: string } {
  return { photos: `사진\n${c.photos}장`, diary: `일기\n${c.diaryDays}일`, map: '기록\n지도' };
}

/** 제공자 상태 한 줄(services/registry ServiceStatus와 같은 꼴. 순수하게 두려고 필요한 칸만 받는다) */
export interface ProviderLine {
  key: string;
  mode: 'mock' | 'real';
  via?: 'server' | 'app';
  /** 경로 줄: 시간과 선을 실제 길(OSRM)에서 받는지. 없으면 mode로 판단한다 */
  road?: boolean;
  /** 장소 줄: 서버 경유인데 앱 .env의 카카오 키가 번들에 남는지 */
  appKeyInBundle?: boolean;
}

/**
 * 제공자 상태 아래 안내 한 줄. 장소(카카오)와 경로(카카오 자동차 · OpenStreetMap 실제 길)가 지금 어디서 오는지 그대로 말한다.
 * 2026-10-09: 경로가 실제 길(OSRM)인데도 '장소와 경로를 예시 데이터로'라고 하던 것과, 서버 경유인데도 '키가 앱에 들어간다'고
 * 하던 것을 고쳤다.
 */
export function providerNotice(services: readonly ProviderLine[]): string {
  const places = services.find((s) => s.key === 'places');
  const routes = services.find((s) => s.key === 'routes');
  // 서버가 카카오를 못 써 자동차가 대체로 떨어지면 경로 줄은 mock이지만, 도로 경로 서버가 켜져 있으면 시간과 선은 실제 길이다
  const roadReal = routes?.road ?? routes?.mode === 'real';
  if (places?.mode === 'real') {
    if (places.via !== 'server') return '장소와 자동차 경로를 카카오에서 받아와요. 키가 앱에 들어가니 시연에만 쓰세요.';
    return places.appKeyInBundle
      ? '장소와 자동차 경로를 서버를 거쳐 카카오에서 받아와요. 앱 .env의 카카오 키는 쓰지 않지만 앱에 들어가니 비워 두세요.'
      : '장소와 자동차 경로를 서버를 거쳐 카카오에서 받아와요. 키는 서버에만 있어요.';
  }
  if (places?.via === 'server') {
    return roadReal
      ? '서버가 카카오를 쓰지 못해 장소는 예시 데이터로 찾아요. 이동 시간과 길은 실제 길에서 받아요. 서버의 카카오 키를 확인해 주세요.'
      : '서버가 카카오를 쓰지 못해 장소와 경로를 예시 데이터로 계산해요. 서버의 카카오 키를 확인해 주세요.';
  }
  return roadReal
    ? '카카오 키가 없어서 장소는 예시 데이터로 찾아요. 이동 시간과 길은 OpenStreetMap 실제 길에서 받아요.'
    : '카카오 키가 없어서 장소와 경로를 예시 데이터로 계산해요. 키를 넣으면 카카오로 바뀌어요.';
}
