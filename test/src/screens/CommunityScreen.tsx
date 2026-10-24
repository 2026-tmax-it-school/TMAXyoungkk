import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import type { CommunityPost } from '../core/ports';
import { SEARCH_MAX, failText } from '../core/community';
import { useHomeBack } from '../navigation/useBack';
import { PostCard } from '../features/community/components/PostCard';
import type { TabScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { getServices } from '../services/registry';
import { useCommunity } from '../store/community';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Btn, Col, ConfirmSheet, Empty, Field, Header, IconBtn, ListRow, Notice, Row, Screen, Seg, Sheet, SP, Tag, TextLink } from '../ui';
import { useActiveTrip } from '../features/trip/useActiveTrip';
import { useItineraries } from '../store/itineraries';
import { ItineraryFeed } from './ItinerariesScreen';

/** 글자를 멈추고 이만큼 지나면 검색한다(엔터·검색 버튼은 바로) */
const SEARCH_DEBOUNCE_MS = 400;
const VIEW_CONFIG = { itemVisiblePercentThreshold: 50 };

/**
 * 28 커뮤니티(WP6 소유, 2026-10-10). 여행 사진과 이야기를 앱 사용자 모두와 나눈다. 글은 서버에 있다.
 * 2026-10-11 재배치:
 * - 사진·일기 나누기 대신 태그로 거른다. 위 태그 줄은 '전체' + 많이 쓴 태그, 글 카드의 태그를 눌러도 거른다.
 * - 목록은 FlatList. 당겨서 새로 고치고, 끝에 닿으면 이어 받는다(이어 받기 실패는 아래에 다시 시도 버튼).
 * - 글쓰기는 엄지가 닿는 오른쪽 아래 떠 있는 버튼(글이 하나도 없으면 빈 화면 가운데 '글쓰기'만 둔다). 게스트가 누르면 로그인 안내 시트를 보인다(보는 것은 로그인 없이 된다).
 * - 서버 주소가 없으면 이 기기 모의(앱을 새로 열면 사라짐)라고 안내한다. 내 글만 지울 수 있다(확인 1회).
 * - 2026-10-17: 제목·태그 검색창. 글자를 멈추고 0.4초 뒤(엔터는 바로) 서버가 제목이나 태그에 들어 있는 글만 돌려준다. 태그 줄과 같이 쓸 수 있다.
 * - 2026-10-17: 내 글은 고칠 수 있다. 카드의 '수정'이 글쓰기 화면을 고치기(editPostId)로 연다. 고친 글은 피드에서 제자리에 바뀐다.
 */
export default function CommunityScreen({ navigation, route }: TabScreenProps<'Community'>) {
  const [tab, setTab] = useState<'posts' | 'plans'>(route.params?.tab === 'plans' ? 'plans' : 'posts');
  // '여행 일정' 빈 목록(검색어 없음): 가운데 빈 화면 버튼과 떠 있는 버튼이 겹치지 않게 한다
  const plansEmpty = useItineraries((s) => s.status === 'ready' && s.items.length === 0 && !s.query);
  // 홈에서 '여행 일정'으로 다시 열었을 때도 맞춘다
  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab, route.params]);
  const { posts, next, tag, query, status, loadingMore, error, moreError, setTag, setQuery, refresh, more, remove, like, view } = useCommunity();
  const homeBack = useHomeBack();
  const { trips } = useActiveTrip();
  const [pickTrip, setPickTrip] = useState(false);
  const [text, setText] = useState(query);
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

  // 글자를 멈추면 검색한다. 검색어를 지우면 바로 전체로 돌아온다
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), text.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [text, setQuery]);

  // 좋아요는 로그인한 계정만. 게스트는 안내만 한다
  const onLike = async (p: CommunityPost) => {
    if (!canPost) {
      useUi.getState().showToast('로그인하면 좋아요를 누를 수 있어요', 'soft');
      return;
    }
    const r = await like(p.id);
    if (!r.ok) useUi.getState().showToast(failText(r.code, r.detail), 'warn');
  };
  // 화면에 절반 넘게 보인 글은 조회수를 한 번 올린다(글마다 이 실행에서 한 번)
  const viewable = useRef({ onViewableItemsChanged: ({ viewableItems }: { viewableItems: { item: CommunityPost }[] }) => viewableItems.forEach((v) => view(v.item.id)) });
  // 내 여행 일정을 올린다: 로그인 계정만, 여행방이 여러 개면 어느 방인지 고른다
  const shareStart = () => {
    if (!canPost) return setLoginAsk(true);
    if (trips.length === 0) {
      useUi.getState().showToast('여행방을 만들면 그 일정을 공유할 수 있어요', 'soft');
      return navigation.navigate('CreateTrip');
    }
    if (trips.length === 1) return navigation.navigate('ShareItinerary', { tripId: trips[0].id });
    setPickTrip(true);
  };
  const write = () => (canPost ? navigation.navigate('CommunityCompose') : setLoginAsk(true));

  const confirmDelete = async () => {
    const post = asking;
    setAsking(undefined);
    if (!post) return;
    const r = await remove(post.id);
    useUi.getState().showToast(r.ok ? '글을 지웠어요' : '글을 지우지 못했어요', r.ok ? 'soft' : 'warn');
  };

  const head = (
    <Col gap={SP.xl}>
      {local ? (
        <Notice icon="alert" title="이 기기에서만 보여요" text="서버 주소가 없어서 모의 커뮤니티로 돌아가요. 앱을 새로 열면 글이 사라져요." />
      ) : null}
      <Row gap={SP.s}>
        <View style={{ flex: 1 }}>
          <Field
            label="검색"
            hideLabel
            size="sm"
            value={text}
            onChangeText={(v) => setText(v.slice(0, SEARCH_MAX))}
            placeholder="제목이나 태그로 검색"
            onSubmitEditing={() => setQuery(text)}
          />
        </View>
        {text ? <IconBtn icon="x" label="검색어 지우기" onPress={() => setText('')} /> : <IconBtn icon="search" label="검색" onPress={() => setQuery(text)} />}
      </Row>
      {/* 위쪽 인기 태그 줄은 뺐다(2026-10-17). 글의 태그를 눌러 거르는 중일 때만 그 태그와 풀기를 한 줄로 보인다 */}
      {tag ? (
        <Row gap={SP.m}>
          <Tag label={`#${tag}`} on onPress={() => setTag(null)} />
          <TextLink title="전체 보기" onPress={() => setTag(null)} />
        </Row>
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

  // 글이 하나도 없으면 빈 화면 가운데 '글쓰기'가 있으므로 오른쪽 아래 떠 있는 '글쓰기'는 숨긴다(버튼이 두 개로 보이지 않게)
  const emptyWrite = status === 'ready' && posts.length === 0 && !query && !tag;
  const empty =
    status === 'ready' ? (
      query ? (
        <Empty
          icon="search"
          title={`'${query}' 검색 결과가 없어요`}
          text="제목이나 태그를 다른 말로 찾아 보세요"
          action={{ label: '검색 지우기', onPress: () => setText('') }}
        />
      ) : tag ? (
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
    </View>
  );

  return (
    <Screen>
      <Header
        back={homeBack}
        title="커뮤니티"
        right={<IconBtn icon="refresh" label="새로 고침" onPress={() => void (tab === 'plans' ? useItineraries.getState().refresh() : refresh())} />}
      />
      <View style={{ paddingHorizontal: SP.gutter, paddingBottom: SP.m }}>
        <Seg<'posts' | 'plans'>
          items={[
            { key: 'posts', label: '이야기' },
            { key: 'plans', label: '여행 일정' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {tab === 'plans' ? (
        <>
          <ItineraryFeed navigation={navigation} region={null} onShare={shareStart} />
          {/* 빈 목록은 가운데 '내 일정 공유하기' 버튼이 같은 일을 하므로 떠 있는 버튼을 숨긴다 */}
          {plansEmpty ? null : (
            <Row style={{ position: 'absolute', right: SP.gutter, bottom: SP.xxl }}>
              <Btn title="일정 공유" icon="share" size="sm" onPress={shareStart} />
            </Row>
          )}
        </>
      ) : (
      <>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            now={now}
            photoUri={photoUri}
            activeTag={tag}
            onTagPress={(t) => setTag(t)}
            onEdit={(p) => navigation.navigate('CommunityCompose', { editPostId: p.id })}
            onDelete={setAsking}
            onLike={onLike}
          />
        )}
        ListHeaderComponent={head}
        ListEmptyComponent={empty}
        ListFooterComponent={foot}
        contentContainerStyle={{ paddingHorizontal: SP.gutter, gap: SP.xl }}
        refreshControl={<RefreshControl refreshing={status === 'loading' && posts.length > 0} onRefresh={() => void refresh()} />}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => void more()}
        onEndReachedThreshold={0.5}
        viewabilityConfig={VIEW_CONFIG}
        onViewableItemsChanged={viewable.current.onViewableItemsChanged}
      />
      {emptyWrite ? null : (
        <Row style={{ position: 'absolute', right: SP.gutter, bottom: SP.xxl }}>
          <Btn title="글쓰기" icon="pen" size="sm" onPress={write} />
        </Row>
      )}
      </>
      )}
      <ConfirmSheet
        visible={loginAsk}
        title={tab === 'plans' ? '로그인하면 일정을 공유할 수 있어요' : '로그인하면 글을 올릴 수 있어요'}
        text={tab === 'plans' ? '일정은 계정 이름으로 올라가요. 일정을 보는 것은 로그인 없이 돼요.' : '글은 계정 이름으로 올라가요. 글을 보는 것은 로그인 없이 돼요.'}
        confirmLabel="로그인"
        onConfirm={() => {
          setLoginAsk(false);
          navigation.navigate('Login');
        }}
        onCancel={() => setLoginAsk(false)}
      />
      <Sheet visible={pickTrip} onClose={() => setPickTrip(false)} title="어느 여행방의 일정을 공유할까요" scroll>
        {trips.map((t, i) => (
          <ListRow
            key={t.id}
            first={i === 0}
            label={t.title}
            sub={`${t.startDate} ~ ${t.endDate}`}
            onPress={() => {
              setPickTrip(false);
              navigation.navigate('ShareItinerary', { tripId: t.id });
            }}
          />
        ))}
      </Sheet>
      <ConfirmSheet
        visible={asking != null}
        title="글을 지울까요"
        text="올린 사진과 글이 모두에게서 사라지고 되돌릴 수 없어요."
        confirmLabel="삭제"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setAsking(undefined)}
      />
    </Screen>
  );
}
