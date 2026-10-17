import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { isSeeding, resetDemo, seedScenario, type SeedProgress } from '../demo/tools';
import type { ScenarioStage } from '../demo/scenarioSteps';
import { useHomeBack } from '../navigation/useBack';
import { signOutFlow } from '../features/account/flows';
import {
  heroLine,
  notifySummary,
  NOTIFY_ROWS,
  PERMISSION_LABEL,
  providerNotice,
  retentionShort,
  retentionText,
  sessionSummary,
} from '../features/account/settings';
import { useActiveTrip } from '../features/trip/useActiveTrip';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { describeServices } from '../services/registry';
import { useLive } from '../store/live';
import { useSession } from '../store/session';
import { useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Chip,
  Choice,
  Col,
  ConfirmSheet,
  H,
  Icon,
  IconBtn,
  ListRow,
  ProfileHero,
  ProgressBar,
  Row,
  Screen,
  Sheet,
  SP,
  Txt,
} from '../ui';

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

type OpenSheet = 'notify' | 'retention' | null;

/**
 * 18 프로필 탭 · 설정 · 시연 도구(WP1 소유). 탭 라벨은 '프로필'이다.
 * 위에서부터
 * 1. 큰 제목 '프로필'
 * 2. 프로필 머리 한 줄(ProfileHero row) → 내 프로필(17)
 * 3. '내 여행 기록' 타일은 2026-10-17에 홈 '여행일지'(일기·사진·기록 지도)로 옮겼다. 방은 useActiveTrip이 정한다. 시연 도구의 '화면 목록'은 2026-10-17에 없앴다(화면은 앱 흐름으로만 연다).
 * 4. '설정': 알림(유형별 끄기는 시트 안 스위치 4줄), 기기 위치 사용(스위치, sub는 권한 상태), 데이터 보존(안내 시트)
 * 5. '계정': 게스트는 계정 만들기와 다른 계정으로 로그인, 계정은 로그아웃(확인 1회)
 * 6. 맨 아래 접힌 '시연 도구': 시나리오 채우기, 오프라인 흉내(시연) 스위치, 시연 리셋(확인 1회), 제공자 상태.
 *    채우는 동안에는 리셋을 막는다. 다시 채우면 이전 시나리오 방은 지우고 새로 만든다.
 * 켜고 끄는 줄은 ListRow switch(줄 전체가 스위치, 접근성 이름 = 항목 이름)로 그린다.
 * 여행방 바로가기 목록은 두지 않는다(여행방 일은 홈의 선택한 여행방 구역과 일정·지도 탭 맨 위 TripBar에서 한다).
 */
export default function MoreScreen({ navigation }: TabScreenProps<'More'>) {
  const homeBack = useHomeBack();
  const { trip } = useActiveTrip();
  const online = useTrips((s) => s.online);
  const setOnline = useTrips((s) => s.setOnline);
  const showToast = useUi((s) => s.showToast);
  const session = useSession((s) => s.session);
  const profile = useSession((s) => s.profile);
  const notifyPrefs = useSession((s) => s.notifyPrefs);
  const setNotifyPref = useSession((s) => s.setNotifyPref);
  const useDeviceLocation = useSession((s) => s.useDeviceLocation);
  const setUseDeviceLocation = useSession((s) => s.setUseDeviceLocation);
  const permission = useLive((s) => s.permission);
  const now = useNow();

  const [stage, setStage] = useState<ScenarioStage>('all');
  const [seeding, setSeeding] = useState<SeedProgress | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  // 시연 도구는 처음에 접혀 있다(실제 기능과 같은 무게로 두지 않는다)
  const [demoOpen, setDemoOpen] = useState(false);

  const summary = sessionSummary(session, now);
  const isAccount = session?.kind === 'account';

  const seed = async () => {
    setSeeding({ done: 0, total: 1, label: '시작하는 중' });
    try {
      await seedScenario(stage, { onProgress: setSeeding });
      showToast('경주 2박 3일 시나리오 여행방을 채웠어요');
    } catch (e) {
      showToast(`시나리오를 채우지 못했어요: ${String(e)}`, 'warn');
    } finally {
      setSeeding(null);
    }
  };

  const soonChip = summary.soon ? <Chip text="곧 만료" tone="warn" /> : undefined;

  return (
    <Screen>
      <Body scroll>
        <View style={{ paddingTop: SP.s }}>
          <IconBtn icon="back" label="뒤로" onPress={homeBack} />
        </View>
        <View accessibilityRole="header" style={styles.hero}>
          <Txt v="hero">프로필</Txt>
        </View>

        <ProfileHero
          variant="row"
          name={profile.nickname || session?.nickname || ''}
          sub={heroLine(session, now)}
          imageUri={profile.imageUri}
          onPress={() => navigation.navigate('Profile')}
        />


        {/* 설정 */}
        <Col>
          <Txt v="section" style={styles.sectionTop}>
            설정
          </Txt>
          <ListRow first icon="bell" label="알림" sub={notifySummary(notifyPrefs)} onPress={() => setSheet('notify')} />
          <ListRow
            icon="locate"
            label="기기 위치 사용"
            sub={`위치 권한 ${PERMISSION_LABEL[permission]}`}
            switch={{ value: useDeviceLocation, onChange: setUseDeviceLocation }}
          />
          <ListRow icon="clock" label="데이터 보존" sub={retentionShort(trip)} onPress={() => setSheet('retention')} />
        </Col>

        {/* 계정 */}
        <Col>
          <Txt v="section" style={styles.sectionTop}>
            계정
          </Txt>
          {isAccount ? (
            <ListRow
              first
              icon="x"
              label="로그아웃"
              sub={summary.title}
              right={soonChip}
              onPress={() => setConfirmSignOut(true)}
            />
          ) : (
            <>
              <ListRow
                first
                icon="user"
                label="계정 만들기"
                sub="여행방은 그대로 유지돼요"
                right={soonChip}
                onPress={() => navigation.navigate('Signup')}
              />
              <ListRow icon="pinlock" label="다른 계정으로 로그인" onPress={() => navigation.navigate('Login')} />
            </>
          )}
        </Col>

        {/* 시연 도구(접힘) */}
        <Col>
          <DisclosureRow label="시연 도구" open={demoOpen} onToggle={() => setDemoOpen((v) => !v)} />
          {demoOpen ? (
            <Col gap={SP.xxl}>
              <Col gap={SP.m}>
                <Txt v="nm">시나리오 채우기</Txt>
                {SEED_ROWS.map((row) => (
                  <Choice<ScenarioStage> key={row[0].key} options={row} value={stage} onChange={setStage} />
                ))}
                {seeding ? (
                  <Col gap={SP.s}>
                    <ProgressBar value={seeding.total > 0 ? seeding.done / seeding.total : 0} />
                    <Txt v="mtTight">{`${seeding.label} · ${seeding.done} / ${seeding.total}`}</Txt>
                  </Col>
                ) : null}
                <Btn
                  title={seeding ? '채우는 중' : '시나리오 채우기'}
                  size="sm"
                  disabled={seeding != null}
                  onPress={() => void seed()}
                />
              </Col>

              <Col>
                <ListRow
                  first
                  icon="alert"
                  label="오프라인 흉내(시연)"
                  sub={online ? '연결됨' : '끊김 · 다시 끄면 대기 중인 것을 보내요'}
                  switch={{ value: !online, onChange: (off) => setOnline(!off) }}
                />
                <ListRow
                  icon="undo"
                  label={seeding ? '채우는 중에는 리셋할 수 없어요' : '시연 리셋'}
                  disabled={seeding != null}
                  onPress={() => setConfirmReset(true)}
                />
              </Col>

              <ProviderStatus />

            </Col>
          ) : null}
        </Col>
      </Body>

      <Sheet visible={sheet === 'notify'} title="알림" onClose={() => setSheet(null)}>
        <View>
          {NOTIFY_ROWS.map((r, i) => (
            <ListRow
              key={r.kind}
              first={i === 0}
              label={r.label}
              sub={r.sub}
              switch={{ value: notifyPrefs[r.kind], onChange: (on) => setNotifyPref(r.kind, on) }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet visible={sheet === 'retention'} title="데이터 보존" onClose={() => setSheet(null)}>
        <Txt v="body" c="muted">
          {retentionText(trip)}
        </Txt>
      </Sheet>

      <ConfirmSheet
        visible={confirmSignOut}
        title="로그아웃할까요"
        text="같은 계정으로 다시 로그인하면 여행방을 이어서 쓸 수 있어요."
        confirmLabel="로그아웃"
        onConfirm={() => {
          setConfirmSignOut(false);
          signOutFlow();
          showToast('로그아웃했어요');
        }}
        onCancel={() => setConfirmSignOut(false)}
      />

      <ConfirmSheet
        visible={confirmReset}
        title="시연을 처음 상태로 되돌릴까요"
        text="이 기기의 여행방, 계정, 저장된 경로를 모두 지우고 시연 시각을 꺼요."
        confirmLabel="리셋하기"
        onConfirm={() => {
          setConfirmReset(false);
          if (isSeeding()) return;
          void resetDemo().then(() => showToast('시연을 처음 상태로 되돌렸어요'));
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </Screen>
  );
}

/** 접고 펴는 구역 머리 줄. 줄 전체가 버튼이고 펼침 상태를 스크린리더에 알린다 */
function DisclosureRow({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={styles.disclosure}
    >
      <Icon name="gear" size={24} color="ink" stroke={1.5} />
      <View style={styles.grow}>
        <Txt v="body">{label}</Txt>
      </View>
      <Icon name={open ? 'up' : 'down'} size={18} color="muted" stroke={2} />
    </Pressable>
  );
}

/** 제공자 상태(카카오 키 유무, 서버 경유 여부). 시연 도구 안에서만 보인다 */
function ProviderStatus() {
  const services = describeServices();
  return (
    <Col gap={SP.s}>
      <Txt v="nm">제공자 상태</Txt>
      <View>
        {services.map((s, i) => (
          <ListRow
            key={s.key}
            first={i === 0}
            label={s.label}
            sub={s.note}
            right={<Chip text={s.mode === 'real' ? '실제' : '예시 데이터'} tone={s.mode === 'real' ? 'ok' : 'line'} />}
          />
        ))}
      </View>
      <Txt v="mtTight">{providerNotice(services)}</Txt>
    </Col>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: SP.l },
  sectionTop: { marginTop: SP.l },
  grow: { flex: 1, minWidth: 0 },
  /** 기록 타일 세 칸을 같은 높이로 */
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xxl,
    minHeight: H.btn,
    paddingVertical: SP.xxl,
    marginTop: SP.l,
  },
});
