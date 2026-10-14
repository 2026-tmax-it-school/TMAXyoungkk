import type { KeyboardTypeOptions, TextInputProps } from 'react-native';

/**
 * 입력 칸 종류별 키보드·자동완성 값(순수 표). ui/Field의 kind가 쓴다.
 * 비밀번호 관리자와 키보드가 칸을 알아보게 하고, 아이디·이메일·코드가 첫 글자 대문자나 자동 고침으로 바뀌지 않게 한다.
 * returnKeyType은 기본값이다. 화면이 returnKeyType을 주면 그것이 이긴다.
 */
export type FieldKind = 'email' | 'username' | 'password' | 'newPassword' | 'nickname' | 'code';

export interface FieldKindProps {
  autoCapitalize: NonNullable<TextInputProps['autoCapitalize']>;
  autoCorrect: boolean;
  autoComplete: NonNullable<TextInputProps['autoComplete']>;
  textContentType: NonNullable<TextInputProps['textContentType']>;
  keyboardType?: KeyboardTypeOptions;
  returnKeyType: 'done' | 'next' | 'go';
}

const TABLE: Record<FieldKind, FieldKindProps> = {
  email: {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'email',
    textContentType: 'emailAddress',
    keyboardType: 'email-address',
    returnKeyType: 'next',
  },
  username: {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'username',
    textContentType: 'username',
    returnKeyType: 'next',
  },
  password: {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'current-password',
    textContentType: 'password',
    returnKeyType: 'done',
  },
  newPassword: {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'new-password',
    textContentType: 'newPassword',
    returnKeyType: 'next',
  },
  nickname: {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'nickname',
    textContentType: 'nickname',
    returnKeyType: 'done',
  },
  // 초대 코드: 대문자로 받는다. 문자 인증 코드가 아니라 자동완성은 끈다.
  code: {
    autoCapitalize: 'characters',
    autoCorrect: false,
    autoComplete: 'off',
    textContentType: 'none',
    returnKeyType: 'done',
  },
};

export function fieldKindProps(kind: FieldKind): FieldKindProps {
  return TABLE[kind];
}
