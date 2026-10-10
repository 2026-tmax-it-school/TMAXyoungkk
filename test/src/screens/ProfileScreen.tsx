import { useIsFocused } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';

import { NICKNAME_MAX, PROFILE_TAGS } from '../core/constants';
import { compressedImageBytes, formatBytes, needsImageCompression, nicknameProblem } from '../core/auth';
import { tokenTail } from '../core/session';
import { kstDate } from '../core/util';
import { saveProfileFlow, signOutFlow } from '../features/account/flows';
import { isStorableImageUri, SAMPLE_PROFILE_IMAGE_BYTES } from '../features/account/profile';
import type { RootScreenProps } from '../navigation/routes';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import {
  Avatar,
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
  lineC,
  Notice,
  R,
  Row,
  Screen,
 
  Tag,
  Txt,
} from '../ui';

const PROVIDER_LABEL = { email: '이메일', kakao: '카카오', google: '구글' } as const;

interface PickedImage {
  /** 이 화면에서만 미리 보기로 쓴다. 웹 blob: 주소는 저장하지 않는다 */
  previewUri?: string;
  storableUri?: string;
  originalBytes: number;
  bytes: number;
  compressed: boolean;
}

/**
 * 17 프로필 · 성향 태그 · 게스트 승격 · 계정 탈퇴(FR-104, WP1 소유, 2차).
 * - 닉네임 중복 거부(계정 닉네임과 비교), 12자.
 * - 프로필 이미지: 5MB를 넘으면 압축 대상으로 판정하고 압축 전후 크기를 보여준다.
 *   웹은 실제 압축을 하지 않고 판정·표시만 한다(실제 압축은 네이티브 image-picker quality).
 * - 성향 태그(맛집, 자연, 액티비티, 휴식, 역사, 카페)는 profile.tags에 저장하고 추천(FR-404)이 쓴다.
 * - 게스트: 이메일 가입으로 승격(userId 유지 · 이관 범위 미결정 · 이 기기 데이터 유지). 탈퇴 메뉴는 없다.
 * - 계정: 소셜 연결, 로그아웃(여행방은 이 기기에 남는다), 계정 탈퇴(quiet + 확인 1회).
 * 로즈 채움 주 버튼은 아래 고정 '저장' 하나다(목업 .foot). 승격은 ghost로 둔다.
 * 머리 카드의 아바타와 이름은 저장된 값을 보인다. 편집 중인 값은 닉네임 입력칸에만 있다.
 */
export default function ProfileScreen({ navigation }: RootScreenProps<'Profile'>) {
  const session = useSession((s) => s.session);
  const profile = useSession((s) => s.profile);
  const deleteAccount = useSession((s) => s.deleteAccount);
  const showToast = useUi((s) => s.showToast);

  const [nickname, setNickname] = useState(profile.nickname || session?.nickname || '');
  const [tags, setTags] = useState<string[]>(profile.tags);
  const [image, setImage] = useState<PickedImage | undefined>(undefined);
  const [nickError, setNickError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const problem = nicknameProblem(nickname);
  const isAccount = session?.kind === 'account';
  const dirty =
    nickname.trim() !== profile.nickname ||
    image != null ||
    tags.length !== profile.tags.length ||
    tags.some((t) => !profile.tags.includes(t));

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
      setNotice({ title: '사진을 고르지 못했습니다', text: '사진 권한을 확인하거나 아래 예시 이미지로 시연해 주세요.' });
    }
  };

  const save = async () => {
    if (problem) return;
    setBusy(true);
    setNickError(undefined);
    const patch = {
      nickname: nickname.trim(),
      tags,
      ...(image
        ? { imageUri: image.storableUri, imageBytes: image.bytes, imageCompressed: image.compressed }
        : {}),
    };
    const r = await saveProfileFlow(patch);
    setBusy(false);
    if (!r.ok) {
      setNickError(r.reason);
      return;
    }
    setImage(undefined);
    showToast('프로필을 저장했습니다');
  };

  const runDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    const r = await deleteAccount();
    setBusy(false);
    if (r.ok) showToast('계정을 지웠습니다. 올린 사진은 지우고 채팅·제안은 탈퇴한 멤버로 남겼습니다');
    else setNotice({ title: '탈퇴하지 못했습니다', text: r.reason });
  };

  const savedName = profile.nickname || session?.nickname || '';
  const shownBytes = image?.bytes ?? profile.imageBytes;
  const shownUri = image?.previewUri ?? profile.imageUri;

  return (
    <Screen>
      <Header
        back={navigation.canGoBack() ? navigation.goBack : undefined}
        eyebrow={session ? `${isAccount ? '계정' : '게스트'} · ${savedName}` : '프로필'}
        title="내 프로필"
      />
      <Body scroll>
        <Card>
          <Row>
            <Avatar name={savedName || '?'} index={0} />
            <Col gap={2} grow>
              <Txt v="nm">{savedName}</Txt>
              <Txt v="mt">
                {isAccount
                  ? `${session?.email ?? ''} · 로그인 유지 ${session ? kstDate(session.expiresAt) : ''}까지`
                  : `게스트 · ${session ? kstDate(session.expiresAt) : ''}까지 · 기기 토큰 ${session ? tokenTail(session) : ''}`}
              </Txt>
            </Col>
            <Chip text={isAccount ? '계정' : '게스트'} tone={isAccount ? 'ok' : 'line'} />
          </Row>
        </Card>

        <Field
          label="닉네임"
          value={nickname}
          onChangeText={(v) => {
            setNickname(v);
            setNickError(undefined);
          }}
          maxLength={NICKNAME_MAX}
          error={nickError ?? (nickname.length > 0 ? problem ?? undefined : undefined)}
        />

        <Col gap={8}>
          <Txt v="label">프로필 이미지</Txt>
          <Card variant="flat">
            <Row top>
              {shownUri ? (
                <Image
                  source={{ uri: shownUri }}
                  accessibilityLabel="프로필 이미지 미리 보기"
                  style={{ width: 56, height: 56, borderRadius: R.photo, borderWidth: 1, borderColor: lineC.line }}
                />
              ) : (
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: R.photo,
                    borderWidth: 1,
                    borderColor: lineC.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="camera" size={22} color="faint" />
                </View>
              )}
              <Col gap={4} grow>
                {image ? (
                  <Txt v="nm">
                    {image.compressed
                      ? `${formatBytes(image.originalBytes)}에서 ${formatBytes(image.bytes)}로 압축`
                      : `${formatBytes(image.bytes)} · 압축 없이 사용`}
                  </Txt>
                ) : shownBytes != null ? (
                  <Txt v="mt">{`${formatBytes(shownBytes)}${profile.imageCompressed ? ' · 압축됨' : ''}`}</Txt>
                ) : (
                  <Txt v="mt">이미지가 없습니다</Txt>
                )}
              </Col>
            </Row>
            <Row gap={9}>
              <Col grow>
                <Btn title="사진 고르기" size="sm" variant="ghost" icon="camera" onPress={() => void pick()} />
              </Col>
              <Col grow>
                <Btn
                  title={`예시 ${formatBytes(SAMPLE_PROFILE_IMAGE_BYTES)}로 시연`}
                  size="sm"
                  variant="quiet"
                  onPress={() => takeImage(SAMPLE_PROFILE_IMAGE_BYTES)}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col gap={8}>
          <Txt v="label">여행 성향</Txt>
          <Row gap={7} wrap>
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

        {notice ? <Notice tone="warn" icon="alert" title={notice.title} text={notice.text} /> : null}

        <View style={{ height: 1, backgroundColor: lineC.line, marginVertical: 4 }} />

        {isAccount ? (
          <Col gap={10}>
            <Txt v="label">계정</Txt>
            <Card>
              <Row>
                <Icon name="mail" size={18} color="muted" />
                <Txt v="nm" style={{ flex: 1 }}>
                  {session?.email ?? ''}
                </Txt>
              </Row>
              <Row gap={6} wrap>
                <ProviderChips accountEmail={session?.email} />
              </Row>
              <Row gap={9}>
                <Col grow>
                  <Btn
                    title="카카오 연결"
                    size="sm"
                    variant="quiet"
                    onPress={() => navigation.navigate('SocialConsent', { provider: 'kakao', intent: 'link' })}
                  />
                </Col>
                <Col grow>
                  <Btn
                    title="구글 연결"
                    size="sm"
                    variant="quiet"
                    onPress={() => navigation.navigate('SocialConsent', { provider: 'google', intent: 'link' })}
                  />
                </Col>
              </Row>
            </Card>
            <Btn
              title="로그아웃"
              variant="ghost"
              onPress={() => {
                signOutFlow();
                showToast('로그아웃했습니다. 같은 계정으로 다시 로그인하면 여행방을 이어 씁니다');
              }}
            />
            <Btn title="계정 탈퇴" variant="quiet" disabled={busy} onPress={() => setConfirmDelete(true)} />
          </Col>
        ) : (
          <Col gap={10}>
            <Txt v="label">게스트 승격</Txt>
            <Card variant="tinted">
              <Row top gap={8}>
                <Icon name="user" size={17} color="accentStrong" />
                <Txt v="nm" c="accentStrong" style={{ flex: 1 }}>
                  계정으로 바꾸고 여행방을 그대로 쓰기
                </Txt>
              </Row>
              <Btn title="이메일로 승격하기" size="sm" variant="ghost" onPress={() => navigation.navigate('Signup')} />
            </Card>
          </Col>
        )}
      </Body>
      <Foot>
        <Btn
          title={busy ? '저장 중' : dirty ? '저장' : '바뀐 내용 없음'}
          disabled={!dirty || problem != null || busy}
          onPress={() => void save()}
        />
      </Foot>

      <ConfirmSheet
        visible={confirmDelete}
        title="계정을 탈퇴할까요"
        text={`내가 올린 사진은 모든 여행방에서 지워지고, 채팅과 제안은 '탈퇴한 멤버'로 남습니다. 같은 이메일로 다시 가입해도 되돌아오지 않습니다.`}
        confirmLabel="탈퇴하기"
        onConfirm={() => void runDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

/** 연결된 로그인 방법. 인증 제공자에 물어 본다(세션에는 제공자 목록이 없다). */
function ProviderChips({ accountEmail }: { accountEmail?: string }) {
  const [providers, setProviders] = useState<(keyof typeof PROVIDER_LABEL)[] | undefined>(undefined);
  // 소셜 연결(26)에서 돌아오면 다시 읽는다.
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
  }, [accountEmail, focused]);
  if (!providers) return null;
  return (
    <>
      {providers.map((p) => (
        <Chip key={p} text={PROVIDER_LABEL[p]} tone="line" icon="check" />
      ))}
    </>
  );
}
