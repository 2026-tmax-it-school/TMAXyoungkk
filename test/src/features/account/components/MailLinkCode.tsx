import React, { useState } from 'react';

import { Btn, Col, Field } from '../../../ui';

/**
 * 소셜 로그인 연결 확인 코드 입력(WP1, 2026-10-24). 같은 이메일 계정이 있으면 서버가 연결 확인 코드를 그 이메일로만 보낸다.
 * 메일에서 코드를 복사해 이 칸에 붙여 넣고 누르면 구글·카카오 로그인이 그 계정에 연결된다.
 */
export function MailLinkCode({ busy, onSubmit }: { busy: boolean; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  const ready = code.trim().length > 0 && !busy;
  return (
    <Col gap={8}>
      <Field
        label="메일로 받은 연결 코드"
        kind="code"
        value={code}
        onChangeText={setCode}
        placeholder="메일의 코드를 붙여 넣기"
        help="30분 안에 써 주세요. 메일이 안 보이면 스팸함을 확인해 주세요"
        onSubmitEditing={() => {
          if (ready) onSubmit(code);
        }}
      />
      <Btn title={busy ? '연결하는 중' : '코드로 연결하기'} disabled={!ready} onPress={() => onSubmit(code)} />
    </Col>
  );
}
