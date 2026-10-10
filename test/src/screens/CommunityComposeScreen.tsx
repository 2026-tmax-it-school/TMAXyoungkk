import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import type { CommunityDraft, CommunityKind, CommunityPhotoInput } from '../core/ports';
import { checkDraft, diaryAsText, failText, KIND_LABEL, PHOTOS_MAX, TITLE_MAX, BODY_MAX } from '../core/community';
import { dayLabel } from '../core/util';
import type { RootScreenProps } from '../navigation/routes';
import { pickCommunityPhotos } from '../services/community/picker';
import { useCommunity } from '../store/community';
import { useSession } from '../store/session';
import { useTripDoc } from '../store/trips';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Choice, Col, Empty, Field, Foot, Header, IconBtn, Notice, R, Row, Screen, Sheet, SP, surfaceC, Txt } from '../ui';

/**
 * 29 커뮤니티 글쓰기(WP6 소유, 2026-10-10). 사진 글과 일기 글을 올린다. 글은 서버에 올라가 앱 사용자 모두가 본다.
 * - 로그인한 계정만. 게스트에는 로그인 안내를 보인다.
 * - 사진 글은 사진이 한 장 이상, 일기 글은 본문이 있어야 한다(core/community/checkDraft, 서버와 같은 규칙).
 *   사진은 네 장까지, 사진 고르기는 버튼을 누른 뒤에만 열고 한 장을 1.5MB 아래로 줄여 받는다. 위치·촬영 정보는 받지 않는다.
 * - '내 일기 불러오기': 이 여행방의 일기 한 편을 골라 본문과 제목을 채운다. tripId·date로 열면 그 날짜 일기로 처음부터 채운다.
 * - 올리기는 한 번만 보낸다(빠르게 두 번 눌러도 글이 둘이 되지 않게).
 */
export default function CommunityComposeScreen({ navigation, route }: RootScreenProps<'CommunityCompose'>) {
  const session = useSession((s) => s.session);
  const publish = useCommunity((s) => s.publish);
  const trip = useTripDoc(route.params?.tripId);
  const [kind, setKind] = useState<CommunityKind>(route.params?.date ? 'diary' : 'photo');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<CommunityPhotoInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [pickErr, setPickErr] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const sending = useRef(false);
  const prefilled = useRef(false);

  const draft: CommunityDraft = { kind, title, body, photos };
  const check = checkDraft(draft);

  const fillFromDiary = (date: string) => {
    const entry = trip?.diaries[date];
    if (!trip || !entry) return;
    setKind('diary');
    setBody(diaryAsText(entry));
    setTitle(`${trip.title} · ${dayLabel(date)}`.slice(0, TITLE_MAX));
  };

  useEffect(() => {
    if (prefilled.current || !route.params?.date) return;
    prefilled.current = true;
    fillFromDiary(route.params.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip]);

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'));

  if (session?.kind !== 'account') {
    return (
      <Screen>
        <Header back={back} title="글쓰기" />
        <Body>
          <Empty
            icon="user"
            title="로그인하면 글을 올릴 수 있어요"
            text="사진과 일기를 올리려면 계정이 필요해요"
            action={{ label: '로그인', onPress: () => navigation.navigate('Login') }}
          />
        </Body>
      </Screen>
    );
  }

  const addPhotos = async () => {
    setPickErr(undefined);
    const r = await pickCommunityPhotos(photos.length);
    if (!r.ok) {
      setPickErr(r.reason === 'denied' ? '사진 접근 권한이 없어요. 설정에서 허용해 주세요' : '사진을 불러오지 못했어요');
      return;
    }
    if (r.photos.length > 0) setPhotos([...photos, ...r.photos].slice(0, PHOTOS_MAX));
  };

  const submit = async () => {
    if (sending.current) return;
    if (!check.ok) {
      setProblem(check.problem);
      return;
    }
    sending.current = true;
    setBusy(true);
    setProblem(undefined);
    const r = await publish({ kind, title: title.trim(), body: body.trim(), photos });
    if (r.ok) {
      useUi.getState().showToast('글을 올렸어요');
      back();
      return;
    }
    sending.current = false;
    setBusy(false);
    setProblem(failText(r.code, r.detail));
  };

  const diaries = trip ? Object.values(trip.diaries).filter((d) => diaryAsText(d).length > 0).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];

  return (
    <Screen>
      <Header back={back} eyebrow="사진과 일기" title="글쓰기" />
      <Body scroll>
        <Choice<CommunityKind>
          options={[
            { key: 'photo', label: KIND_LABEL.photo, icon: 'camera' },
            { key: 'diary', label: KIND_LABEL.diary, icon: 'book' },
          ]}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setProblem(undefined);
          }}
        />
        <Field label="제목 · 선택" value={title} onChangeText={setTitle} maxLength={TITLE_MAX} placeholder="예: 불국사 새벽 산책" />
        <Field
          label={kind === 'photo' ? '사진 설명 · 선택' : '일기'}
          value={body}
          onChangeText={setBody}
          maxLength={BODY_MAX}
          multiline
          minLines={kind === 'diary' ? 8 : 4}
          placeholder={kind === 'diary' ? '오늘 여행은 어땠나요' : '사진에 대한 이야기를 적어 보세요'}
        />
        {kind === 'diary' && diaries.length > 0 ? (
          <Btn title="내 여행 일기 불러오기" icon="book" variant="quiet" size="sm" onPress={() => setImporting(true)} />
        ) : null}

        <Col gap={SP.m}>
          <Row>
            <Txt v="label" style={{ flex: 1 }}>
              {kind === 'photo' ? '사진' : '사진 · 선택'}
            </Txt>
            <Txt v="mtTight">{`${photos.length} / ${PHOTOS_MAX}`}</Txt>
          </Row>
          {photos.length > 0 ? (
            <Row gap={SP.s} wrap>
              {photos.map((p, i) => (
                <View key={`${i}-${p.data.length}`} style={{ width: 84, height: 84 }}>
                  <Image
                    source={{ uri: `data:${p.mime};base64,${p.data}` }}
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={`고른 사진 ${i + 1}`}
                    style={{ width: 84, height: 84, borderRadius: R.photo, backgroundColor: surfaceC.off }}
                  />
                  <View style={{ position: 'absolute', top: 2, right: 2 }}>
                    <IconBtn icon="x" label={`사진 ${i + 1} 빼기`} onPress={() => setPhotos(photos.filter((_, j) => j !== i))} />
                  </View>
                </View>
              ))}
            </Row>
          ) : null}
          <Btn
            title={photos.length >= PHOTOS_MAX ? '사진은 네 장까지예요' : '사진 고르기'}
            icon="camera"
            variant="quiet"
            size="sm"
            disabled={photos.length >= PHOTOS_MAX || busy}
            onPress={() => void addPhotos()}
          />
          {pickErr ? <Notice tone="warn" icon="alert" text={pickErr} /> : null}
          <Txt v="mtTight">사진은 줄여서 올리고, 위치와 촬영 정보는 함께 올리지 않아요. 올린 글은 앱 사용자 모두가 볼 수 있어요.</Txt>
        </Col>
      </Body>
      <Foot>
        {problem ? <Notice tone="warn" icon="alert" text={problem} /> : null}
        <Btn title={busy ? '올리는 중' : '올리기'} disabled={busy || !check.ok} onPress={() => void submit()} />
      </Foot>

      <Sheet visible={importing} onClose={() => setImporting(false)} title="일기 불러오기">
        <Col gap={SP.s}>
          {diaries.map((d) => (
            <Pressable
              key={d.date}
              accessibilityRole="button"
              accessibilityLabel={`${dayLabel(d.date)} 일기 불러오기`}
              onPress={() => {
                fillFromDiary(d.date);
                setImporting(false);
              }}
            >
              <Card>
                <Col gap={SP.xs}>
                  <Txt v="nm">{dayLabel(d.date)}</Txt>
                  <Txt v="mtTight" numberOfLines={2}>
                    {diaryAsText(d)}
                  </Txt>
                </Col>
              </Card>
            </Pressable>
          ))}
        </Col>
      </Sheet>
    </Screen>
  );
}
