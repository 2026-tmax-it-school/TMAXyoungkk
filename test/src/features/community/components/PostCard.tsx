import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import type { CommunityPhoto, CommunityPost } from '../../../core/ports';
import { KIND_LABEL, timeAgo } from '../../../core/community';
import { Card, Chip, Col, Icon, R, Row, SP, surfaceC, Txt } from '../../../ui';

/**
 * 커뮤니티 글 카드(WP6 소유). 닉네임·시각·종류, 제목, 본문(길면 접기), 사진 격자, 내 글이면 삭제.
 * 사진은 한 장이면 가로 가득 4:3, 여러 장이면 두 칸 격자다. 사진 주소는 부르는 쪽이 만든다(photoUri).
 */

/** 본문을 접어 둘 글자 수(대략 여섯 줄) */
const FOLD_AT = 140;
const PHOTO_ROW = 2;

function PhotoGrid({ photos, uri, name }: { photos: CommunityPhoto[]; uri: (p: CommunityPhoto) => string; name: string }) {
  if (photos.length === 0) return null;
  const tile = (p: CommunityPhoto, i: number, ratio: number) => (
    <Image
      key={p.id}
      source={{ uri: uri(p) }}
      accessibilityIgnoresInvertColors
      accessibilityLabel={`${name}의 사진 ${i + 1}`}
      style={{ flex: 1, aspectRatio: ratio, borderRadius: R.photo, backgroundColor: surfaceC.off }}
    />
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

export function PostCard({
  post,
  now,
  photoUri,
  onDelete,
}: {
  post: CommunityPost;
  now: number;
  photoUri: (p: CommunityPhoto) => string;
  onDelete: (post: CommunityPost) => void;
}) {
  const [open, setOpen] = useState(false);
  const long = post.body.length > FOLD_AT;
  return (
    <Card>
      <Col gap={SP.l}>
        <Row gap={SP.m}>
          <Col grow gap={SP.xs}>
            <Txt v="nm" numberOfLines={1}>
              {post.authorNickname}
            </Txt>
            <Txt v="mtTight">{timeAgo(post.createdAt, now)}</Txt>
          </Col>
          <Chip text={KIND_LABEL[post.kind]} tone="line" icon={post.kind === 'photo' ? 'camera' : 'book'} />
        </Row>
        {post.title ? <Txt v="nmLg">{post.title}</Txt> : null}
        {post.body ? (
          <Col gap={SP.xs}>
            <Txt v="body" numberOfLines={open || !long ? undefined : 6}>
              {post.body}
            </Txt>
            {long ? (
              <Pressable accessibilityRole="button" accessibilityLabel={open ? '접기' : '더 보기'} onPress={() => setOpen(!open)} hitSlop={8}>
                <Txt v="time" c="accent">
                  {open ? '접기' : '더 보기'}
                </Txt>
              </Pressable>
            ) : null}
          </Col>
        ) : null}
        <PhotoGrid photos={post.photos} uri={photoUri} name={post.authorNickname} />
        {post.mine ? (
          <Row>
            <View style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" accessibilityLabel="내 글 삭제" onPress={() => onDelete(post)} hitSlop={8}>
              <Row gap={SP.xs}>
                <Icon name="trash" size={14} color="muted" />
                <Txt v="mtTight">삭제</Txt>
              </Row>
            </Pressable>
          </Row>
        ) : null}
      </Col>
    </Card>
  );
}
