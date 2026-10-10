import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { isSeeding, resetDemo, seedScenario, type SeedProgress } from '../demo/tools';
import type { ScenarioStage } from '../demo/scenarioSteps';
import { NOTIFY_ROWS, PERMISSION_LABEL, providerNotice, retentionText, sessionSummary } from '../features/account/settings';
import { SCREEN_META, type RootStackParamList, type TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { describeServices } from '../services/registry';
import { useLive } from '../store/live';
import { useSession } from '../store/session';
import { useCurrentTrip, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Card,
  Chip,
  Choice,
  Col,
  ConfirmSheet,
  Header,
  Icon,
  lineC,
  Notice,
  ProgressBar,
  Row,
  Screen,
  ScopeBadge,
  Txt,
  type IconName,
} from '../ui';

type TripRoute =
  | 'Chat'
  | 'SpotDetail'
  | 'Recommend'
  | 'Planning'
  | 'ScheduleEdit'
  | 'LegTransport'
  | 'Navigate'
  | 'LiveTrip'
  | 'Photos'
  | 'Diary'
  | 'RecordMap'
  | 'Members'
  | 'TripSettings';

/** 여행방 진입점(목업 18). 2·3차 기능은 ScopeBadge로 표시한다. */
const TRIP_ENTRIES: { route: TripRoute; label: string; icon: IconName; scope?: '2차' | '3차' }[] = [
  { route: 'Members', label: '멤버 · 초대 링크', icon: 'users' },
  { route: 'TripSettings', label: '여행방 설정 · 날짜별 기점', icon: 'gear' },
  { route: 'LiveTrip', label: '여행 진행 · 시뮬레이터', icon: 'play', scope: '2차' },
  { route: 'Recommend', label: '여행지 추천', icon: 'search', scope: '2차' },
  { route: 'Photos', label: '사진', icon: 'camera', scope: '3차' },
  { route: 'Diary', label: '일기', icon: 'book', scope: '3차' },
  { route: 'RecordMap', label: '기록 지도', icon: 'map', scope: '3차' },
];

/** 시연 도구의 화면 목록(번호순). 위 진입점에 없는 화면까지 전부 연다. */
const ALL_TRIP_ROUTES: TripRoute[] = [
  'Chat',
  'SpotDetail',
  'Planning',
  'ScheduleEdit',
  'LegTransport',
  'Navigate',
  'Members',
  'LiveTrip',
  'Photos',
  'Diary',
  'RecordMap',
  'Recommend',
  'TripSettings',
];

/** 시나리오 채우기 단계. 한 줄 네 칸이면 글자가 줄바꿈되어 두 줄 두 칸으로 둔다 */
const SEED_ROWS: { key: ScenarioStage; label: string }[][] = [
  [
    { key: 'trip', label: '여행방만' },
    { key: 'members', label: '멤버까지' },
  ],
  [
    { key: 'chat', label: '지우 합류 전' },
    { key: 'all', label: '대화 전부' },
  ],
];

/**
 * 18 더보기 · 설정 · 시연 도구(WP1 소유).
 * - 진입점: 멤버, 여행방 설정, 여행 진행(19), 추천(23), 기록(20~22), 계정(15~17).
 * - 설정: 알림 유형별 끄기(notifyPrefs), 위치 권한 상태와 기기 위치 사용, 그룹원 위치 공유 '꺼짐 · 미결정',
 *   제공자 상태(describeServices, 카카오 키 유무와 '국내 SDK 선정 미결정'), 세션 만료와 토큰 끝 4자리,
 *   데이터 보존 안내(종료 후 1년).
 * - 시연 도구: 시연 리셋(확인 1회), 시나리오 채우기(단계 선택, 진행 표시), 네트워크 끊기 토글, 화면 목록.
 *   채우는 동안에는 리셋을 막는다. 다시 채우면 이전 시나리오 방은 지우고 새로 만든다.
 * - 켜고 끄는 줄(ToggleRow)은 줄 전체가 스위치다(접근성 이름 = 항목 이름). 켜짐은 로즈 채움이 아니라
 *   tint 칩으로 보인다. 로즈 채움은 주 버튼에만 쓴다.
 */
export default function MoreScreen({ navigation }: TabScreenProps<'More'>) {
  const trip = useCurrentTrip();
  const online = useTrips((s) => s.online);
  const setOnline = useTrips((s) => s.setOnline);
  const showToast = useUi((s) => s.showToast);
  const session = useSession((s) => s.session);
  const notifyPrefs = useSession((s) => s.notifyPrefs);
  const setNotifyPref = useSession((s) => s.setNotifyPref);
  const useDeviceLocation = useSession((s) => s.useDeviceLocation);
  const setUseDeviceLocation = useSession((s) => s.setUseDeviceLocation);
  const permission = useLive((s) => s.permission);
  const now = useNow();

  const [stage, setStage] = useState<ScenarioStage>('all');
  const [seeding, setSeeding] = useState<SeedProgress | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showScreens, setShowScreens] = useState(false);

  const summary = sessionSummary(session, now);
  const services = describeServices();

  const open = (route: TripRoute) => {
    if (!trip) return;
    const date = trip.startDate;
    const spotId = trip.spots[0]?.id;
    const params: { [K in TripRoute]: RootStackParamList[K] } = {
      Members: { tripId: trip.id },
      TripSettings: { tripId: trip.id },
      Chat: { tripId: trip.id },
      SpotDetail: { tripId: trip.id, spotId: spotId ?? '' },
      Recommend: { tripId: trip.id },
      Planning: { tripId: trip.id, date },
      ScheduleEdit: { tripId: trip.id, date },
      LegTransport: { tripId: trip.id, date, legIndex: 0 },
      Navigate: { tripId: trip.id, date, legIndex: 0 },
      LiveTrip: { tripId: trip.id },
      Photos: { tripId: trip.id },
      Diary: { tripId: trip.id },
      RecordMap: { tripId: trip.id },
    };
    (navigation.navigate as (name: TripRoute, p: RootStackParamList[TripRoute]) => void)(route, params[route]);
  };

  const seed = async () => {
    setSeeding({ done: 0, total: 1, label: '시작하는 중' });
    try {
      await seedScenario(stage, { onProgress: setSeeding });
      showToast('경주 2박 3일 시나리오 여행방을 채웠습니다');
    } catch (e) {
      showToast(`시나리오를 채우지 못했습니다: ${String(e)}`, 'warn');
    } finally {
      setSeeding(null);
    }
  };

  return (
    <Screen>
      <Header eyebrow={trip ? `지금 여행방 · ${trip.title}` : '여행방을 고르지 않음'} title="더보기" />
      <Body scroll>
        {/* 여행방 */}
        <Col gap={8}>
          <Txt v="label">여행방</Txt>
          {trip ? null : <Txt v="mt">홈에서 여행방을 고르면 아래 화면이 열립니다.</Txt>}
          <Card>
            {TRIP_ENTRIES.map((e, i) => (
              <EntryRow
                key={e.route}
                first={i === 0}
                icon={e.icon}
                label={e.label}
                scope={e.scope}
                disabled={!trip}
                onPress={() => open(e.route)}
              />
            ))}
          </Card>
        </Col>

        {/* 계정 */}
        <Col gap={8}>
          <Txt v="label">계정</Txt>
          <Card>
            <Row top>
              <Icon name="user" size={18} color="muted" />
              <Col gap={3} grow>
                <Txt v="nm">{summary.title}</Txt>
                {summary.lines.map((l) => (
                  <Txt key={l} v="mtTight">
                    {l}
                  </Txt>
                ))}
              </Col>
              {summary.soon ? <Chip text="곧 만료" tone="warn" /> : null}
            </Row>
            <EntryRow icon="user" label="프로필 · 성향 태그" scope="2차" onPress={() => navigation.navigate('Profile')} />
            {session?.kind === 'guest' ? (
              <>
                <EntryRow icon="mail" label="회원가입으로 승격" scope="2차" onPress={() => navigation.navigate('Signup')} />
                <EntryRow icon="pinlock" label="다른 계정으로 로그인" scope="2차" onPress={() => navigation.navigate('Login')} />
              </>
            ) : null}
          </Card>
        </Col>

        {/* 알림 */}
        <Col gap={8}>
          <Txt v="label">알림</Txt>
          <Card>
            {NOTIFY_ROWS.map((r, i) => (
              <ToggleRow
                key={r.kind}
                first={i === 0}
                label={r.label}
                sub={r.sub}
                scope={r.scope}
                on={notifyPrefs[r.kind]}
                onChange={(on) => setNotifyPref(r.kind, on)}
              />
            ))}
          </Card>
          <Txt v="mtTight">같은 알림은 30분에 한 번만 띄웁니다. 앱 안 알림이며 푸시는 없습니다.</Txt>
        </Col>

        {/* 위치 */}
        <Col gap={8}>
          <Txt v="label">위치</Txt>
          <Card>
            <Row>
              <Icon name="locate" size={18} color="muted" />
              <Col gap={2} grow>
                <Txt v="nm">위치 권한</Txt>
                <Txt v="mtTight">{PERMISSION_LABEL[permission]}</Txt>
              </Col>
            </Row>
            <ToggleRow
              label="기기 위치 사용"
              sub="끄면 여행 시뮬레이터나 수동 진행만 씁니다. 웹은 HTTPS에서만 위치를 받습니다."
              scope="2차"
              on={useDeviceLocation}
              onChange={setUseDeviceLocation}
            />
            <Row style={{ borderTopWidth: 1, borderTopColor: lineC.line, paddingTop: 10 }}>
              <Col gap={2} grow>
                <Txt v="nm">그룹원 위치 공유</Txt>
                <Txt v="mtTight">아직 없어요. 어디까지 공유할지 정하는 중이에요.</Txt>
              </Col>
              <Chip text="준비 중" tone="line" />
            </Row>
          </Card>
        </Col>

        {/* 제공자 상태 */}
        <Col gap={8}>
          <Txt v="label">제공자 상태</Txt>
          <Card>
            {services.map((s, i) => (
              <Row
                key={s.key}
                top
                style={i === 0 ? undefined : { borderTopWidth: 1, borderTopColor: lineC.line, paddingTop: 10 }}
              >
                <Col gap={2} grow>
                  <Txt v="nm">{s.label}</Txt>
                  {s.note ? <Txt v="mtTight">{s.note}</Txt> : null}
                </Col>
                <Chip text={s.mode === 'real' ? '실제' : '예시 데이터'} tone={s.mode === 'real' ? 'ok' : 'line'} />
              </Row>
            ))}
          </Card>
          <Notice
            icon="map"
            text={providerNotice(services)}
          />
        </Col>

        {/* 데이터 보존 */}
        <Col gap={8}>
          <Txt v="label">데이터 보존</Txt>
          <Notice icon="clock" text={retentionText(trip)} />
          <Txt v="mtTight">
            계정을 탈퇴하면 내가 올린 사진은 지우고 채팅·제안은 '탈퇴한 멤버'로 남깁니다. 프로필에서 할 수 있습니다.
          </Txt>
        </Col>

        {/* 시연 도구 */}
        <Col gap={8}>
          <Txt v="label">시연 도구</Txt>
          <Card>
            <Txt v="nm">시나리오 채우기</Txt>
            <Txt v="mtTight">
              경주 2박 3일(민지·준호·수아·지우). 실제 날짜와 상관없이 10/1 10:00 가상 시각에서 돕니다. 다시 채우면 이전
              시나리오 여행방은 지우고 새로 만듭니다.
            </Txt>
            <Col gap={8}>
              {SEED_ROWS.map((row) => (
                <Choice<ScenarioStage> key={row[0].key} options={row} value={stage} onChange={setStage} />
              ))}
            </Col>
            {seeding ? (
              <Col gap={6}>
                <ProgressBar value={seeding.total > 0 ? seeding.done / seeding.total : 0} />
                <Txt v="mtTight">{`${seeding.label} · ${seeding.done} / ${seeding.total}`}</Txt>
              </Col>
            ) : null}
            <Btn title={seeding ? '채우는 중' : '시나리오 채우기'} size="sm" disabled={seeding != null} onPress={() => void seed()} />
          </Card>
          <Card>
            <ToggleRow
              first
              label="네트워크"
              sub={online ? '연결됨. 끊으면 메시지와 편집이 전송 대기로 남고 재계산을 멈춥니다.' : '끊김. 다시 연결하면 대기 중인 것을 순서대로 보내고 다시 계산합니다.'}
              on={online}
              onLabel="연결"
              offLabel="끊김"
              onChange={setOnline}
            />
          </Card>
          <Btn
            title={seeding ? '채우는 중에는 리셋할 수 없습니다' : '시연 리셋'}
            variant="quiet"
            disabled={seeding != null}
            onPress={() => setConfirmReset(true)}
          />
          <Btn
            title={showScreens ? '화면 목록 닫기' : '화면 목록 열기'}
            variant="quiet"
            size="sm"
            onPress={() => setShowScreens((v) => !v)}
          />
          {showScreens ? (
            <Card>
              {ALL_TRIP_ROUTES.map((r, i) => (
                <EntryRow
                  key={r}
                  first={i === 0}
                  label={`${SCREEN_META[r].no} ${SCREEN_META[r].title}`}
                  disabled={!trip || (r === 'SpotDetail' && trip.spots.length === 0)}
                  onPress={() => open(r)}
                />
              ))}
              {(['Profile', 'Login', 'Signup', 'InviteAccept'] as const).map((r) => (
                <EntryRow key={r} label={`${SCREEN_META[r].no} ${SCREEN_META[r].title}`} onPress={() => navigation.navigate(r)} />
              ))}
              <EntryRow
                label={`${SCREEN_META.SocialConsent.no} ${SCREEN_META.SocialConsent.title}`}
                onPress={() => navigation.navigate('SocialConsent', { provider: 'kakao', intent: 'login' })}
              />
            </Card>
          ) : null}
        </Col>
      </Body>

      <ConfirmSheet
        visible={confirmReset}
        title="시연을 처음 상태로 되돌릴까요"
        text="이 기기의 여행방, 계정, 저장된 경로를 모두 지우고 시연 시각을 꺼요."
        confirmLabel="리셋하기"
        onConfirm={() => {
          setConfirmReset(false);
          if (isSeeding()) return;
          void resetDemo().then(() => showToast('시연을 처음 상태로 되돌렸습니다'));
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </Screen>
  );
}

function EntryRow({
  icon,
  label,
  scope,
  disabled,
  first,
  onPress,
}: {
  icon?: IconName;
  label: string;
  scope?: '2차' | '3차';
  disabled?: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={first ? { paddingVertical: 4 } : { borderTopWidth: 1, borderTopColor: lineC.line, paddingTop: 10, paddingBottom: 4 }}
    >
      <Row>
        {icon ? <Icon name={icon} size={18} color={disabled ? 'faint' : 'muted'} /> : null}
        <Txt v="nm" c={disabled ? 'muted' : 'ink'} style={{ flex: 1 }}>
          {label}
        </Txt>
        {scope ? <ScopeBadge phase={scope} /> : null}
        <Icon name="right" size={14} color="faint" />
      </Row>
    </Pressable>
  );
}

function ToggleRow({
  label,
  sub,
  scope,
  on,
  onChange,
  first,
  onLabel = '켜짐',
  offLabel = '꺼짐',
}: {
  label: string;
  sub?: string;
  scope?: '2차' | '3차';
  on: boolean;
  onChange: (on: boolean) => void;
  first?: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={sub}
      accessibilityState={{ checked: on }}
      onPress={() => onChange(!on)}
      style={first ? undefined : { borderTopWidth: 1, borderTopColor: lineC.line, paddingTop: 10 }}
    >
      <Row top>
        <Col gap={2} grow>
          <Row gap={6}>
            <Txt v="nm">{label}</Txt>
            {scope ? <ScopeBadge phase={scope} /> : null}
          </Row>
          {sub ? <Txt v="mtTight">{sub}</Txt> : null}
        </Col>
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Chip text={on ? onLabel : offLabel} tone={on ? 'soft' : 'line'} icon={on ? 'check' : undefined} />
        </View>
      </Row>
    </Pressable>
  );
}
