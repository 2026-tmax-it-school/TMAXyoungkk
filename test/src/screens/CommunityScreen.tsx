import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';

import type { CommunityPost } from '../core/ports';
import { PostCard } from '../features/community/components/PostCard';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { getServices } from '../services/registry';
import { useCommunity, type CommunityFilter } from '../store/community';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Body, Btn, Col, ConfirmSheet, Empty, Header, IconBtn, Notice, Screen, Seg, SP } from '../ui';

/**
 * 28 커뮤니티(WP6 소유, 2026-10-10). 여행에서 찍은 사진과 쓴 일기를 앱 사용자 모두와 나눈다. 글은 서버에 있다.
 * - 읽기는 누구나. 글쓰기·삭제는 로그인한 계정만이라 게스트에게는 로그인 안내를 보인다.
 * - 탭을 열 때마다 새로 받는다. 위쪽 버튼으로 다시 받을 수도 있다. 쪽은 '더 보기'로 이어 받는다.
 * - 서버 주소가 없으면 이 기기 모의(앱을 새로 열면 사라짐)라고 안내한다.
 * - 글 카드는 features/community/components/PostCard. 내 글만 지울 수 있다(확인 1회).
 */
export default function CommunityScreen({ navigation }: TabScreenProps<'Community'>) {
  const { posts, next, filter, status, loadingMore, error, setFilter, refresh, more, remove } = useCommunity();
  const session = useSession((s) => s.session);
  const now = useNow();
  const [asking, setAsking] = useState<CommunityPost | undefined>(undefined);
  const canPost = session?.kind === 'account';
  const local = getServices().community.id === 'local';
  const photoUri = getServices().community.photoUri;

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const write = () => navigation.navigate('CommunityCompose');

  const confirmDelete = async () => {
    const post = asking;
    setAsking(undefined);
    if (!post) return;
    const r = await remove(post.id);
    useUi.getState().showToast(r.ok ? '글을 지웠어요' : '글을 지우지 못했어요', r.ok ? 'soft' : 'warn');
  };

  return (
    <Screen>
      <Header
        eyebrow="사진과 일기"
        title="커뮤니티"
        right={
          <>
            <IconBtn icon="undo" label="새로 고침" onPress={() => void refresh()} />
            {canPost ? <IconBtn icon="plus" label="글쓰기" onPress={write} /> : null}
          </>
        }
      />
      <Body scroll>
        {local ? (
          <Notice icon="alert" title="이 기기에서만 보여요" text="서버 주소가 없어서 모의 커뮤니티로 돌아가요. 앱을 새로 열면 글이 사라져요." />
        ) : null}
        {!canPost ? (
          <Col gap={SP.m}>
            <Notice icon="user" title="로그인하면 글을 올릴 수 있어요" text="사진과 일기를 올리려면 계정이 필요해요. 보는 것은 로그인 없이 돼요." />
            <Btn title="로그인" size="sm" variant="quiet" onPress={() => navigation.navigate('Login')} />
          </Col>
        ) : null}
        <Seg<CommunityFilter>
          items={[
            { key: 'all', label: '전체' },
            { key: 'photo', label: '사진' },
            { key: 'diary', label: '일기' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {status === 'error' ? (
          <Col gap={SP.m}>
            <Notice tone="warn" icon="alert" title="글을 불러오지 못했어요" text={error ?? '잠시 뒤 다시 시도해 주세요'} />
            <Btn title="다시 불러오기" size="sm" variant="quiet" onPress={() => void refresh()} />
          </Col>
        ) : null}
        {status === 'loading' && posts.length === 0 ? <Notice icon="clock" text="글을 불러오는 중이에요" /> : null}
        {status === 'ready' && posts.length === 0 ? (
          <Empty
            icon="camera"
            title="아직 올라온 글이 없어요"
            text="첫 사진이나 일기를 올려 보세요"
            action={canPost ? { label: '글쓰기', onPress: write } : undefined}
          />
        ) : null}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} now={now} photoUri={photoUri} onDelete={setAsking} />
        ))}
        {next ? <Btn title={loadingMore ? '불러오는 중' : '더 보기'} variant="quiet" disabled={loadingMore} onPress={() => void more()} /> : null}
      </Body>
      <ConfirmSheet
        visible={asking != null}
        title="글을 지울까요"
        text="올린 사진과 글이 모두에게서 사라지고 되돌릴 수 없어요."
        confirmLabel="지우기"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setAsking(undefined)}
      />
    </Screen>
  );
}
