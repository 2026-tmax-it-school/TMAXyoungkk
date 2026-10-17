import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';

import type { CommunityPost } from '../core/ports';
import { PostCard } from '../features/community/components/PostCard';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { getServices } from '../services/registry';
import { useCommunity } from '../store/community';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Btn, Col, ConfirmSheet, Empty, Header, IconBtn, Notice, Row, Screen, SP, Tag, Txt } from '../ui';

/**
 * 28 커뮤니티(WP6 소유, 2026-10-10). 여행 사진과 이야기를 앱 사용자 모두와 나눈다. 글은 서버에 있다.
 * 2026-10-11 재배치:
 * - 사진·일기 나누기 대신 태그로 거른다. 위 태그 줄은 '전체' + 많이 쓴 태그, 글 카드의 태그를 눌러도 거른다.
 * - 목록은 FlatList. 당겨서 새로 고치고, 끝에 닿으면 이어 받는다(이어 받기 실패는 아래에 다시 시도 버튼).
 * - 글쓰기는 엄지가 닿는 오른쪽 아래 떠 있는 버튼. 게스트가 누르면 로그인 안내 시트를 보인다(보는 것은 로그인 없이 된다).
 * - 서버 주소가 없으면 이 기기 모의(앱을 새로 열면 사라짐)라고 안내한다. 내 글만 지울 수 있다(확인 1회).
 */
export default function CommunityScreen({ navigation }: TabScreenProps<'Community'>) {
  const { posts, next, tag, popular, status, loadingMore, error, moreError, setTag, refresh, more, remove } = useCommunity();
  const session = useSession((s) => s.session);
  const now = useNow();
  const [asking, setAsking] = useState<CommunityPost | undefined>(undefined);
  const [loginAsk, setLoginAsk] = useState(false);
  const canPost = session?.kind === 'account';
  const local = getServices().community.id === 'local';
  const photoUri = getServices().community.photoUri;

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const write = () => (canPost ? navigation.navigate('CommunityCompose') : setLoginAsk(true));

  const confirmDelete = async () => {
    const post = asking;
    setAsking(undefined);
    if (!post) return;
    const r = await remove(post.id);
    useUi.getState().showToast(r.ok ? '글을 지웠어요' : '글을 지우지 못했어요', r.ok ? 'soft' : 'warn');
  };

  // 지금 거르는 태그가 많이 쓴 태그에 없어도 줄에 보이게 앞에 둔다
  const tagBar = tag && !popular.includes(tag) ? [tag, ...popular] : popular;

  const head = (
    <Col gap={SP.xl}>
      {local ? (
        <Notice icon="alert" title="이 기기에서만 보여요" text="서버 주소가 없어서 모의 커뮤니티로 돌아가요. 앱을 새로 열면 글이 사라져요." />
      ) : null}
      {tagBar.length > 0 || tag ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.m }}>
          <Tag label="전체" on={tag == null} onPress={() => setTag(null)} />
          {tagBar.map((t) => (
            <Tag key={t} label={`#${t}`} on={tag === t} onPress={() => setTag(tag === t ? null : t)} />
          ))}
        </ScrollView>
      ) : null}
      {status === 'error' ? (
        <Col gap={SP.m}>
          <Notice tone="warn" icon="alert" title="글을 불러오지 못했어요" text={error ?? '잠시 뒤 다시 시도해 주세요'} />
          <Btn title="다시 불러오기" size="sm" variant="quiet" onPress={() => void refresh()} />
        </Col>
      ) : null}
      {status === 'loading' && posts.length === 0 ? <Notice icon="clock" text="글을 불러오는 중이에요" /> : null}
    </Col>
  );

  const empty =
    status === 'ready' ? (
      tag ? (
        <Empty icon="hash" title={`#${tag} 글이 아직 없어요`} text="다른 태그를 고르거나 전체를 보세요" action={{ label: '전체 보기', onPress: () => setTag(null) }} />
      ) : (
        <Empty icon="camera" title="아직 올라온 글이 없어요" text="여행 사진이나 이야기를 처음으로 올려 보세요" action={{ label: '글쓰기', onPress: write }} />
      )
    ) : null;

  const foot = (
    <View style={{ paddingBottom: SP.section * 2 }}>
      {loadingMore ? <Notice icon="clock" text="글을 더 불러오는 중이에요" /> : null}
      {moreError ? (
        <Col gap={SP.m}>
          <Notice tone="warn" icon="alert" text={moreError} />
          <Btn title="이어서 불러오기" size="sm" variant="quiet" onPress={() => void more()} />
        </Col>
      ) : null}
      {!next && posts.length > 0 && status === 'ready' ? (
        <Txt v="mtTight">
          글을 모두 봤어요
        </Txt>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <Header eyebrow="여행 이야기" title="커뮤니티" right={<IconBtn icon="undo" label="새로 고침" onPress={() => void refresh()} />} />
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard post={item} now={now} photoUri={photoUri} activeTag={tag} onTagPress={(t) => setTag(t)} onDelete={setAsking} />
        )}
        ListHeaderComponent={head}
        ListEmptyComponent={empty}
        ListFooterComponent={foot}
        contentContainerStyle={{ paddingHorizontal: SP.gutter, gap: SP.xl }}
        refreshControl={<RefreshControl refreshing={status === 'loading' && posts.length > 0} onRefresh={() => void refresh()} />}
        onEndReached={() => void more()}
        onEndReachedThreshold={0.5}
      />
      <Row style={{ position: 'absolute', right: SP.gutter, bottom: SP.xxl }}>
        <Btn title="글쓰기" icon="pen" size="sm" onPress={write} />
      </Row>
      <ConfirmSheet
        visible={loginAsk}
        title="로그인하면 글을 올릴 수 있어요"
        text="글은 계정 이름으로 올라가요. 글을 보는 것은 로그인 없이 돼요."
        confirmLabel="로그인"
        onConfirm={() => {
          setLoginAsk(false);
          navigation.navigate('Login');
        }}
        onCancel={() => setLoginAsk(false)}
      />
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
