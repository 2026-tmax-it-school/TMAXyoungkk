import React, { useState } from 'react';

import { AuthBtn, Col, Field, Txt } from '../../ui';

/**
 * 메일로 받은 코드 입력(WP1 소유, 2026-10-17). 서버가 실제 메일을 보내면(SMTP) 인증·재설정 코드가 메일에 적혀 오고,
 * 사용자가 여기에 붙여 넣는다. 링크를 쓰지 않으므로 가짜 사이트로 코드가 새는 길이 없다. 개발용 메일함이 열려 있으면
 * 화면은 그 메일함 버튼도 같이 보인다(이 칸은 늘 있다). 앞뒤 공백과 줄바꿈은 떼고 보낸다.
 */
export function CodeEntry({
  label,
  button,
  busy,
  onSubmit,
}: {
  label: string;
  button: string;
  busy: boolean;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const clean = code.replace(/\s+/g, '');
  return (
    <Col gap={8}>
      <Txt v="label">{label}</Txt>
      <Field
        look="auth"
        label={label}
        hideLabel
        value={code}
        onChangeText={setCode}
        placeholder="메일의 코드를 붙여 넣기"
        returnKeyType="go"
        onSubmitEditing={() => clean && !busy && onSubmit(clean)}
      />
      <AuthBtn title={busy ? '확인 중' : button} variant="outline" disabled={busy || clean.length < 8} onPress={() => onSubmit(clean)} />
    </Col>
  );
}
