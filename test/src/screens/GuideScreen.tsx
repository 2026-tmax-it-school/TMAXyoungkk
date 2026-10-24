import React, { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { GUIDE_SECTIONS, GUIDE_STEPS, stepCounter, stepsBySection, stepWhere, type GuideStep } from '../features/guide/steps';
import { useActiveTrip } from '../features/trip/useActiveTrip';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Col, Foot, Header, Icon, IconBtn, ListRow, ProgressBar, R, Row, Screen, Sheet, SP, surfaceC, Txt, H } from '../ui';

/**
 * 앱 둘러보기(2026-10-24). 앱의 모든 기능을 한 단계씩 소개한다(내용은 features/guide/steps, 순수).
 * - 위: 진행 막대와 'n / N'. 오른쪽 위 목록 버튼은 전체 단계를 묶음별로 보여 주고 눌러서 건너뛴다.
 * - 가운데: 지금 단계 카드(제목, 한 줄 요약, 이렇게 써요, 찾는 곳).
 * - 아래: '가 보기'(그 기능의 실제 화면으로 간다), 이전 · 다음(마지막은 '끝내기').
 * - 여행방이 있어야 열리는 단계는 여행방이 없으면 '먼저 여행방을 만들어요'로 안내하고 만들기 화면으로 보낸다.
 * - 한 번 열면 홈의 '처음이세요?' 카드는 더 안 보인다(ui.guideDismissed).
 */
export default function GuideScreen({ navigation, route }: RootScreenProps<'Guide'>) {
  const back = useBack('More');
  const { trip } = useActiveTrip();
  const showToast = useUi((s) => s.showToast);
  const setCurrentTrip = useUi((s) => s.setCurrentTrip);
  const dismiss = useUi((s) => s.dismissGuide);
  const { width } = useWindowDimensions();
  const startAt = Math.max(0, GUIDE_STEPS.findIndex((s) => s.id === route.params?.step));
  const [i, setI] = useState(startAt);
  const [list, setList] = useState(false);
  const step = GUIDE_STEPS[i];
  const last = i === GUIDE_STEPS.length - 1;

  React.useEffect(() => {
    dismiss();
  }, [dismiss]);

  const go = (s: GuideStep) => {
    if (!s.go) return;
    if (s.go.trip && !trip) {
      showToast('먼저 여행방을 만들어요. 만들면 이 기능을 열 수 있어요');
      navigation.navigate('CreateTrip');
      return;
    }
    const tripId = trip?.id ?? '';
    if (s.go.trip && trip) setCurrentTrip(trip.id);
    switch (s.go.route) {
      case 'Home':
      case 'Map':
      case 'Community':
      case 'More':
      case 'Schedule':
        return navigation.navigate('Main', { screen: s.go.route });
      case 'Candidates':
        return navigation.navigate('Main', { screen: 'Candidates' });
      case 'CreateTrip':
        return navigation.navigate('CreateTrip');
      case 'SampleTrip':
        return navigation.navigate('SampleTrip', { regionId: 'gyeongju' });
      case 'Itineraries':
        return navigation.navigate('Itineraries');
      case 'Directions':
        return navigation.navigate('Directions', trip ? { tripId } : undefined);
      case 'Members':
        return navigation.navigate('Members', { tripId });
      case 'Chat':
        return navigation.navigate('Chat', { tripId });
      case 'Recommend':
        return navigation.navigate('Recommend', { tripId });
      case 'TripSettings':
        return navigation.navigate('TripSettings', { tripId });
      case 'LiveTrip':
        return navigation.navigate('LiveTrip', { tripId });
      case 'Journal':
        return navigation.navigate('Journal', { tripId });
      case 'ShareItinerary':
        return navigation.navigate('ShareItinerary', { tripId });
      default:
        return undefined;
    }
  };

  return (
    <Screen>
      <Header
        back={back}
        eyebrow={stepCounter(i)}
        title="앱 둘러보기"
        sub={step.section}
        right={<IconBtn icon="list" label="전체 단계 목록" onPress={() => setList(true)} />}
      />
      <Body scroll>
        <ProgressBar value={(i + 1) / GUIDE_STEPS.length} />
        <Card variant="brand">
          <Row gap={SP.xl}>
            <View
              aria-hidden
              style={{ width: H.quick, height: H.quick, borderRadius: R.iconBtn, backgroundColor: surfaceC.card, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name={step.icon} size={26} color="accent" stroke={1.9} />
            </View>
            <Col grow gap={SP.xs}>
              <Txt v="ttl">{step.title}</Txt>
              <Txt v="mt" c="ink">
                {step.summary}
              </Txt>
            </Col>
          </Row>
        </Card>

        <Col gap={SP.m}>
          <Txt v="eyebrow">이렇게 써요</Txt>
          {step.how.map((line, n) => (
            <Row key={n} top gap={SP.l}>
              <View
                aria-hidden
                style={{ width: 24, height: 24, borderRadius: R.iconBtn, backgroundColor: surfaceC.ink, alignItems: 'center', justifyContent: 'center' }}
              >
                <Txt v="chip" c="onInk">
                  {String(n + 1)}
                </Txt>
              </View>
              <Col grow>
                <Txt v="body">{line}</Txt>
              </Col>
            </Row>
          ))}
        </Col>

        <Card variant="tinted">
          <Row gap={SP.l}>
            <Icon name="pin" size={18} color="muted" />
            <Col grow gap={2}>
              <Txt v="label">찾는 곳</Txt>
              <Txt v="nm">{stepWhere(step, width)}</Txt>
            </Col>
          </Row>
        </Card>
        {step.go?.trip && !trip ? <Txt v="mtTight">이 기능은 여행방이 있어야 열려요. 누르면 여행방 만들기로 가요.</Txt> : null}
      </Body>
      <Foot>
        {step.go ? <Btn title={step.go.label} variant="ghost" icon="right" onPress={() => go(step)} /> : null}
        <Row gap={SP.m}>
          <View style={{ flex: 1 }}>
            <Btn title="이전" variant="quiet" disabled={i === 0} onPress={() => setI((n) => Math.max(0, n - 1))} />
          </View>
          <View style={{ flex: 2 }}>
            <Btn title={last ? '끝내기' : '다음'} onPress={() => (last ? back() : setI((n) => n + 1))} />
          </View>
        </Row>
      </Foot>

      <Sheet visible={list} onClose={() => setList(false)} title="전체 단계" scroll>
        <Col gap={SP.xl}>
          {stepsBySection().map(({ section, steps }) => (
            <Col key={section}>
              <Txt v="eyebrow">{section}</Txt>
              {steps.map((s, k) => {
                const idx = GUIDE_STEPS.indexOf(s);
                return (
                  <ListRow
                    key={s.id}
                    first={k === 0}
                    icon={s.icon}
                    label={`${idx + 1}. ${s.title}`}
                    sub={idx === i ? '지금 보는 단계' : undefined}
                    onPress={() => {
                      setI(idx);
                      setList(false);
                    }}
                  />
                );
              })}
            </Col>
          ))}
          <Txt v="mtTight">{`${GUIDE_SECTIONS.length}묶음 · ${GUIDE_STEPS.length}단계`}</Txt>
        </Col>
      </Sheet>
    </Screen>
  );
}
