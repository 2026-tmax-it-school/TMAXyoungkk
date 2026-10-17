import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import type { CommunityPhoto, CommunityPost } from '../../../core/ports';
import { timeAgo } from '../../../core/community';
import { Avatar, Card, Col, Icon, R, Row, SP, surfaceC, Txt } from '../../../ui';
import { PhotoViewer } from './PhotoViewer';

/**
 * 커뮤니티 글 카드(WP6 소유). 닉네임·시각, 사진, 제목, 본문(길면 접기), 태그, 내 글이면 삭제.
 * 2026-10-11: 사진·일기 종류 칩을 없앴다(글은 한 가지). 사진이 먼저 보이게 위로 올리고, 누르면 크게 본다(PhotoViewer).
 * 태그를 누르면 그 태그로 피드를 거른다(onTagPress). 지금 거르는 태그는 진하게 보인다.
 * 사진은 한 장이면 가로 가득 4:3, 여러 장이면 두 칸 격자다. 사진 주소는 부르는 쪽이 만든다(photoUri).
 */

/** 본문을 접어 둘 글자 수(대략 여섯 줄) */
const FOLD_AT = 140;
const PHOTO_ROW = 2;

function PhotoGrid({
  photos,
  uri,
  name,
  onOpen,
}: {
  photos: CommunityPhoto[];
  uri: (p: CommunityPhoto) => string;
  name: string;
  onOpen: (i: number) => void;
}) {
  if (photos.length === 0) return null;
  const tile = (p: CommunityPhoto, i: number, ratio: number) => (
    <Pressable
      key={p.id}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${name}의 사진 ${i + 1} 크게 보기`}
      onPress={() => onOpen(i)}
      style={{ flex: 1 }}
    >
      <Image
        source={{ uri: uri(p) }}
        accessibilityIgnoresInvertColors
        style={{ width: '100%', aspectRatio: ratio, borderRadius: R.photo, backgroundColor: surfaceC.off }}
      />
    </Pressable>
  );
  if (photos.length === 1) return <View style={{ flexDirection: 'row' }}>{tile(photos[0], 0, 4 / 3)}</View>;
  const rows: CommunityPhoto[][] = [];
  for (let i = 0; i < photos.length; i += PHOTO_ROW) rows.push(photos.slice(i, i + PHOTO_ROW));
  return (
    <Col gap={SP.s}>
      {rows.map((row, r) => (
        <Row key={row[0].id} gap={SP.s}>
          {row.map((p, c) => tile(p, r * PHOTO_ROW + c, 1))}
          {row.length < PHOTO_ROW ? <View style={{ flex: 1 }} /> : null}
        </Row>
      ))}
    </Col>
  );
}

/** 글 카드의 태그 하나. 누르면 그 태그로 거른다 */
function TagLink({ tag, on, onPress }: { tag: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={on ? `#${tag} 태그로 거르는 중` : `#${tag} 태그 글만 보기`}
      onPress={onPress}
      hitSlop={6}
    >
      <Txt v={on ? 'mtSemi' : 'mtTight'} c={on ? 'accent' : 'muted'}>{`#${tag}`}</Txt>
    </Pressable>
  );
}

export function PostCard({
  post,
  now,
  photoUri,
  activeTag,
  onTagPress,
  onDelete,
}: {
  post: CommunityPost;
  now: number;
  photoUri: (p: CommunityPhoto) => string;
  /** 지금 피드를 거르는 태그(없으면 null) */
  activeTag?: string | null;
  onTagPress?: (tag: string) => void;
  onDelete: (post: CommunityPost) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const long = post.body.length > FOLD_AT;
  return (
    <Card>
      <Col gap={SP.l}>
        <Row gap={SP.m}>
          <Avatar name={post.authorNickname} index={0} />
          <Col grow gap={SP.xs}>
            <Txt v="nm" numberOfLines={1}>
              {post.authorNickname}
            </Txt>
            <Txt v="mtTight">{timeAgo(post.createdAt, now)}</Txt>
          </Col>
          {post.mine ? (
            <Pressable accessibilityRole="button" accessibilityLabel="내 글 삭제" onPress={() => onDelete(post)} hitSlop={8}>
              <Row gap={SP.xs}>
                <Icon name="trash" size={14} color="muted" />
                <Txt v="mtTight">삭제</Txt>
              </Row>
            </Pressable>
          ) : null}
        </Row>
        <PhotoGrid photos={post.photos} uri={photoUri} name={post.authorNickname} onOpen={setViewing} />
        {post.title ? <Txt v="nmLg">{post.title}</Txt> : null}
        {post.body ? (
          <Col gap={SP.xs}>
            <Txt v="body" numberOfLines={open || !long ? undefined : 6}>
              {post.body}
            </Txt>
            {long ? (
              <Pressable accessibilityRole="button" accessibilityLabel={open ? '본문 접기' : '본문 더 보기'} onPress={() => setOpen(!open)} hitSlop={8}>
                <Txt v="time" c="accent">
                  {open ? '접기' : '더 보기'}
                </Txt>
              </Pressable>
            ) : null}
          </Col>
        ) : null}
        {post.tags.length > 0 ? (
          <Row gap={SP.l} wrap>
            {post.tags.map((t) => (
              <TagLink key={t} tag={t} on={activeTag === t} onPress={() => onTagPress?.(t)} />
            ))}
          </Row>
        ) : null}
      </Col>
      {post.photos.length > 0 ? (
        <PhotoViewer
          visible={viewing != null}
          photos={post.photos}
          index={viewing ?? 0}
          name={post.authorNickname}
          uri={photoUri}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </Card>
  );
}
