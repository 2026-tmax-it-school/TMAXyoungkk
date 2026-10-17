import { useIsFocused, usePreventRemove } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { NICKNAME_MAX, PROFILE_TAGS } from '../core/constants';
import { compressedImageBytes, formatBytes, needsImageCompression, nicknameProblem } from '../core/auth';
import { saveProfileFlow } from '../features/account/flows';
import { isStorableImageUri, SAMPLE_PROFILE_IMAGE_BYTES } from '../features/account/profile';
import { heroDetail } from '../features/account/settings';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { useNow } from '../services/clock';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Card,
  Chip,
  Col,
  ConfirmSheet,
  Field,
  Foot,
  Header,
  Icon,
  LeaveConfirmSheet,
  ListRow,
  Notice,
  NotFound,
  ProfileEditHero,
  Row,
  Screen,
  SP,
  Tag,
  TextLink,
  Txt,
} from '../ui';

type Provider = 'email' | 'kakao' | 'google';

interface PickedImage {
  /** 이 화면에서만 미리 보기로 쓴다. 웹 blob: 주소는 저장하지 않는다 */
  previewUri?: string;
  storableUri?: string;
  originalBytes: number;
  bytes: number;
  compressed: boolean;
}

/** 나가기를 막아 둔 동작(뒤로, 탭 이동). 저장하거나 버리면 그대로 다시 보낸다 */
type BlockedAction = Parameters<RootScreenProps<'Profile'>['navigation']['dispatch']>[0];

/**
 * 17 내 프로필 · 성향 태그 · 게스트 승격 · 계정 탈퇴(FR-104, WP1 소유).
 * 위에서부터
 * - 머리(ProfileEditHero): 사진(누르면 고르기), 이름, 계정 종류 칩, 한 줄(heroDetail). 사진을 고른 직후에만 압축 전후 크기를
 *   한 줄로 알린다('8.4MB에서 1.2MB로 줄여 저장해요'). 5MB를 넘으면 압축 대상이다. 웹은 판정·표시만 하고 실제 압축은
 *   네이티브 image-picker quality가 한다. 예시 사진 시연은 글자 링크로 낮춘다.
 * - 게스트면 연분홍 카드 '계정 만들기'(→ 16 회원가입, userId 유지 · 이 기기 데이터 유지).
 * - 기본 정보: 닉네임(중복 거부, 12자, Enter로 저장)과 여행 성향 태그(추천 FR-404가 쓴다).
 * - 계정이면 로그인 방법 3줄(이메일 값, 카카오·구글은 연결됨 칩 또는 '연결하기' → 26 소셜 연결).
 * - 맨 아래 '계정 관리': 계정 탈퇴(확인 1회). 로그아웃은 프로필 탭의 '계정' 구역에만 둔다.
 * 저장 Foot은 바뀐 내용이 있을 때만 보인다. 바뀐 채로 나가려 하면 usePreventRemove로 막고 LeaveConfirmSheet를 띄운다.
 * 머리의 이름은 저장된 값을 보인다. 편집 중인 값은 닉네임 입력칸에만 있다.
 */
export default function ProfileScreen({ navigation }: RootScreenProps<'Profile'>) {
  const session = useSession((s) => s.session);
  const profile = useSession((s) => s.profile);
  const deleteAccount = useSession((s) => s.deleteAccount);
  const showToast = useUi((s) => s.showToast);
  const now = useNow();
  const back = useBack('More');

  // 저장된 닉네임. 프로필에 아직 없으면 세션 닉네임(온보딩에서 정한 이름)을 저장된 값으로 본다
  const savedName = profile.nickname || session?.nickname || '';
  const [nickname, setNickname] = useState(savedName);
  const [tags, setTags] = useState<string[]>(profile.tags);
  const [image, setImage] = useState<PickedImage | undefined>(undefined);
  const [nickError, setNickError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  // 저장했거나 버리기로 한 뒤에는 막지 않고, 막아 둔 동작을 다시 보낸다
  const [released, setReleased] = useState(false);
  // 탈퇴하면 세션이 사라져 이 화면이 내려간다. 그때는 막지 않는다
  const [deleting, setDeleting] = useState(false);
  const blocked = useRef<BlockedAction | null>(null);

  const problem = nicknameProblem(nickname);
  const isAccount = session?.kind === 'account';
  const dirty =
    nickname.trim() !== savedName ||
    image != null ||
    tags.length !== profile.tags.length ||
    tags.some((t) => !profile.tags.includes(t));

  usePreventRemove(dirty && !released && !deleting, ({ data }) => {
    blocked.current = data.action;
    setAskLeave(true);
  });

  useEffect(() => {
    if (!released) return;
    const a = blocked.current;
    blocked.current = null;
    if (a) navigation.dispatch(a);
    else setReleased(false);
  }, [released, navigation]);

  const takeImage = (originalBytes: number, uri?: string) => {
    const compressed = needsImageCompression(originalBytes);
    setImage({
      previewUri: uri,
      storableUri: uri && isStorableImageUri(uri) ? uri : undefined,
      originalBytes,
      bytes: compressedImageBytes(originalBytes),
      compressed,
    });
  };

  const pick = async () => {
    setNotice(null);
    try {
      const [p] = await getServices().photos.pick({ multiple: false });
      if (!p) return;
      takeImage(p.bytes, p.uri);
    } catch {
      setNotice({ title: '사진을 고르지 못했어요', text: '사진 권한을 확인하거나 예시 사진으로 시연해 주세요.' });
    }
  };

  const save = async (): Promise<boolean> => {
    if (problem || busy) return false;
    setBusy(true);
    setNickError(undefined);
    const patch = {
      nickname: nickname.trim(),
      tags,
      ...(image ? { imageUri: image.storableUri, imageBytes: image.bytes, imageCompressed: image.compressed } : {}),
    };
    const r = await saveProfileFlow(patch);
    setBusy(false);
    if (!r.ok) {
      setNickError(r.reason);
      return false;
    }
    setImage(undefined);
    showToast('프로필을 저장했어요');
    return true;
  };

  const runDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    setDeleting(true);
    const r = await deleteAccount();
    setBusy(false);
    if (r.ok) {
      showToast('계정을 지웠어요');
      return;
    }
    setDeleting(false);
    setNotice({ title: '탈퇴하지 못했어요', text: r.reason });
  };

  if (!session) {
    return (
      <Screen>
        <Header back={back} title="내 프로필" />
        <Body>
          <NotFound title="프로필을 볼 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  const shownUri = image?.previewUri ?? profile.imageUri;
  // 바뀐 닉네임에 문제가 있으면 저장을 끄고 이유를 칸 아래 한 줄로 보인다
  const nickReason = nickError ?? (dirty ? (problem ?? undefined) : undefined);

  return (
    <Screen keyboard>
      <Header back={back} title="내 프로필" />
      <Body scroll>
        <ProfileEditHero
          name={savedName}
          imageUri={shownUri}
          onPhotoPress={() => void pick()}
          chip={isAccount ? '계정' : '게스트'}
          sub={heroDetail(session, now) || undefined}
        />
        {image ? (
          <View accessibilityLiveRegion="polite">
            <Txt v="mt">
              {image.compressed
                ? `${formatBytes(image.originalBytes)}에서 ${formatBytes(image.bytes)}로 줄여 저장해요`
                : `${formatBytes(image.bytes)} 그대로 저장해요`}
            </Txt>
          </View>
        ) : null}
        <TextLink title="예시 사진으로 시연" onPress={() => takeImage(SAMPLE_PROFILE_IMAGE_BYTES)} />

        {notice ? <Notice tone="warn" icon="alert" title={notice.title} text={notice.text} /> : null}

        {!isAccount ? (
          <Card variant="tinted">
            <Row top gap={SP.m}>
              <Icon name="user" size={17} color="accentStrong" />
              <Col gap={SP.xs} grow>
                <Txt v="nm" c="accentStrong">
                  계정 만들기
                </Txt>
                <Txt v="mt">계정으로 바꿔도 여행방은 그대로 유지돼요.</Txt>
              </Col>
            </Row>
            <Btn title="계정 만들기" size="sm" variant="ghost" onPress={() => navigation.navigate('Signup')} />
          </Card>
        ) : null}

        <Col gap={SP.xl}>
          <Txt v="section">기본 정보</Txt>
          <Field
            label="닉네임"
            kind="nickname"
            value={nickname}
            onChangeText={(v) => {
              setNickname(v);
              setNickError(undefined);
            }}
            maxLength={NICKNAME_MAX}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (dirty) void save();
            }}
            error={nickReason}
          />
          <Col gap={SP.m}>
            <Txt v="label">여행 성향</Txt>
            <Row gap={SP.s} wrap>
              {PROFILE_TAGS.map((t) => (
                <Tag
                  key={t}
                  label={t}
                  on={tags.includes(t)}
                  onPress={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
                />
              ))}
            </Row>
          </Col>
        </Col>

        {isAccount ? (
          <Col>
            <Txt v="section" style={styles.sectionTop}>
              로그인 방법
            </Txt>
            <LoginMethods
              email={session.email}
              onLink={(provider) => navigation.navigate('SocialConsent', { provider, intent: 'link' })}
            />
          </Col>
        ) : null}

        {isAccount ? (
          <Col>
            <Txt v="section" style={styles.sectionTop}>
              계정 관리
            </Txt>
            <ListRow first icon="trash" label="계정 탈퇴" disabled={busy} onPress={() => setConfirmDelete(true)} />
          </Col>
        ) : null}
      </Body>
      {dirty ? (
        <Foot>
          <Btn title={busy ? '저장 중' : '저장'} disabled={problem != null || busy} onPress={() => void save()} />
        </Foot>
      ) : null}

      <LeaveConfirmSheet
        visible={askLeave}
        title="바뀐 내용을 저장할까요"
        saveDisabledReason={problem ?? undefined}
        onSave={() => {
          setAskLeave(false);
          void save().then((ok) => {
            if (ok) setReleased(true);
            else blocked.current = null;
          });
        }}
        onDiscard={() => {
          setAskLeave(false);
          setReleased(true);
        }}
        onCancel={() => {
          setAskLeave(false);
          blocked.current = null;
        }}
      />

      <ConfirmSheet
        visible={confirmDelete}
        title="계정을 탈퇴할까요"
        text={`내가 올린 사진은 모든 여행방에서 지워지고, 채팅과 제안은 '탈퇴한 멤버'로 남아요. 같은 이메일로 다시 가입해도 되돌아오지 않아요.`}
        confirmLabel="탈퇴하기"
        onConfirm={() => void runDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

/**
 * 로그인 방법 3줄. 이메일은 값만 보이고, 카카오·구글은 연결돼 있으면 '연결됨' 칩, 아니면 '연결하기'(→ 26 소셜 연결).
 * 연결 목록은 인증 제공자에 물어 본다(세션에는 제공자 목록이 없다). 소셜 연결에서 돌아오면 다시 읽는다.
 */
function LoginMethods({ email, onLink }: { email?: string; onLink: (p: 'kakao' | 'google') => void }) {
  const [providers, setProviders] = useState<Provider[] | undefined>(undefined);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    let alive = true;
    const s = useSession.getState().session;
    if (!s?.accountId) return;
    void getServices()
      .auth.getAccount(s.accountId)
      .then((r) => {
        if (alive && r.ok) setProviders(r.account.providers);
      });
    return () => {
      alive = false;
    };
  }, [email, focused]);
  const social = (p: 'kakao' | 'google', label: string) => {
    const linked = providers?.includes(p) ?? false;
    return linked ? (
      <ListRow icon="link" label={label} right={<Chip text="연결됨" tone="ok" />} />
    ) : (
      <ListRow icon="link" label={label} value="연결하기" onPress={() => onLink(p)} />
    );
  };
  return (
    <View>
      <ListRow first icon="mail" label="이메일" value={email ?? ''} />
      {social('kakao', '카카오')}
      {social('google', '구글')}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTop: { marginTop: SP.l },
});
