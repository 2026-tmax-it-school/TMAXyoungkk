import type { BgRecordBlock } from '../../core/live/background';

/**
 * 19 백그라운드 동선 기록 줄 문구(WP5 소유). 화면과 테스트가 같이 본다.
 * 켤 수 없는 이유는 그대로 알린다. 웹·Expo Go는 개발 빌드가 필요하다고 안내한다.
 * 옵션 값만 보고 '기록한다'고 말하지 않는다. 진행 중이면 실제로 도는지(active), 시작 전이면 고른 날짜가 오늘인지 본다.
 */

export const BG_RECORD_LABEL = '백그라운드 동선 기록';

export const BG_BLOCK_TEXT: Record<BgRecordBlock | 'denied' | 'servicesOff', string> = {
  web: '웹에서는 앱이 화면 밖에 있을 때 위치를 받을 수 없어 켤 수 없습니다. 개발 빌드 앱에서 켤 수 있습니다.',
  expoGo: 'Expo Go에서는 백그라운드 위치를 쓸 수 없어 켤 수 없습니다. 개발 빌드에서 켤 수 있습니다.',
  notInBuild: '이 빌드에는 백그라운드 위치 설정이 없어 켤 수 없습니다. 개발 빌드를 다시 만든 뒤 켤 수 있습니다.',
  denied: '위치를 항상 허용해야 켤 수 있습니다. 설정에서 위치 권한을 바꾼 뒤 다시 켜 주세요.',
  servicesOff: '기기 위치가 꺼져 있어 켤 수 없습니다. 기기 설정에서 위치를 켠 뒤 다시 켜 주세요.',
};

/** 켰지만 안드로이드 알림 권한이 없어 '동선 기록 중' 알림이 알림창에 보이지 않을 때(토스트). 기록은 된다 */
export const BG_NOTICE_HIDDEN_TEXT =
  '알림을 허용하지 않아 동선 기록 중 알림은 알림창에 보이지 않습니다. 기록은 켜졌고, 여행 진행을 끝내거나 끄면 멈춥니다.';

/**
 * 줄 아래 설명. 켤 수 없으면 이유, 돌고 있으면 지금 하는 일, 켜져 있지만 이번 진행에서 돌지 않으면 그 이유,
 * 꺼져 있으면 켜면 생기는 일.
 */
export function bgRecordSub(o: {
  on: boolean;
  /** 지금 백그라운드 받기가 도는지 */
  active: boolean;
  block: BgRecordBlock | undefined;
  /** 여행 진행 중인지 */
  running: boolean;
  /** 진행 날짜(시작 전이면 고른 날짜)가 오늘인지 */
  today: boolean;
}): string {
  if (o.block) return BG_BLOCK_TEXT[o.block];
  if (o.on && o.active) return '앱이 화면 밖에 있어도 동선과 도착을 남기는 중입니다. 여행 진행을 끝내거나 끄면 멈춥니다.';
  if (o.on && !o.today) {
    return o.running
      ? '켜져 있지만 오늘 날짜가 아니라 이번 진행에서는 쓰지 않습니다. 앱을 켜 둔 동안만 기록합니다.'
      : '켜져 있지만 오늘 날짜를 기기 위치로 진행할 때만 화면 밖 동선을 남깁니다.';
  }
  if (o.on && o.running) return '켜져 있지만 지금은 화면 밖 동선을 남기지 않습니다. 앱을 켜 둔 동안만 기록합니다.';
  if (o.on) return '오늘 날짜를 기기 위치로 진행하면 앱이 화면 밖에 있어도 동선을 남깁니다. 여행 진행을 끝내거나 끄면 멈춥니다.';
  return '켜면 앱이 화면 밖에 있어도 동선과 도착을 남깁니다. 위치를 항상 허용해야 합니다. 동선은 이 기기에만 남고, 스팟 도착은 여행방 방문 기록에 남습니다.';
}
