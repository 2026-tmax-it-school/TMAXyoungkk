import type { NotifyKind, Session, Trip } from '../../types';
import type { LocationPermission } from '../../core/ports';
import { isExpirySoon, tokenTail } from '../../core/session';
import { retentionUntil } from '../../core/tripStatus';
import { kstDate } from '../../core/util';

/**
 * 18 더보기 · 설정 문구(WP1 소유, 순수). wp1-home 테스트가 node로 부른다.
 */

export const NOTIFY_ROWS: { kind: NotifyKind; label: string; sub: string }[] = [
  { kind: 'delay', label: '뒤 일정 조정안', sub: '예정보다 15분 이상 밀리면 조정안을 보여줍니다' },
  { kind: 'arrival', label: '도착 확인', sub: '스팟 100m 안에 3분 머물면 도착으로 기록합니다' },
  { kind: 'freeTime', label: '빈 시간 추천', sub: '다음 일정까지 30분 이상 남으면 근처를 추천합니다' },
  { kind: 'sessionExpiry', label: '게스트 세션 만료 안내', sub: '만료 3일 전에 한 번 알려 드려요' },
];

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

/** 데이터 보존 안내. 여행방이 있으면 그 방의 보관 기한을 적는다. */
export function retentionText(trip: Trip | undefined): string {
  const base = '여행방·채팅·사진은 여행 종료 후 1년 동안 보관하고 그 뒤 이 기기에서 지웁니다. 위치 이력은 종료 후 90일입니다.';
  if (!trip) return base;
  return `${base} ${trip.title}: ${kstDate(retentionUntil(trip) - 1)}까지 보관.`;
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
