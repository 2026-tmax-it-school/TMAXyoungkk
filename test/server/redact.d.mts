/**
 * redact.mjs의 타입 선언(WP2 소유).
 */

export const DELETED_MEMBER_NAME: string;
export const NICKNAME_MAX: number;
export const NICKNAME_OP_TYPES: string[];
export const REDACT_TRIGGER_TYPES: string[];

/** 본인이 보낸 탈퇴 op면 그 멤버 id, 아니면 null */
export function anonymizedMember(op: unknown): string | null;
/** 그 멤버들의 닉네임을 가린 op. 바뀐 것이 없으면 null */
export function maskNicknames<T>(op: T, memberIds: ReadonlySet<string>): T | null;
/** 사진 주소·위치를 뺀 photoAdded. 바뀐 것이 없으면 null */
export function maskPhoto<T>(op: T): T | null;
/** 로그(seq 순)를 가린다. index → 가린 op(바뀐 op만) */
export function redactLog<T>(ops: readonly T[]): Map<number, T>;
