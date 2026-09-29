import { getRandomBytes } from 'expo-crypto';

import type { Hasher, IdGen, Rng } from '../core/ports';
import { sha256Hex } from '../core/sha256';
import { makeIdGen } from '../core/util';

/**
 * 보안 난수와 해시(비기능 보안). 난수는 expo-crypto getRandomBytes만 쓴다.
 * 해시는 순수 TS SHA-256이다. expo-crypto digest는 웹에서 보안 출처에서만 돼서 쓰지 않는다.
 */

export const secureRng: Rng = {
  bytes: (n: number) => getRandomBytes(n),
};

export const ids: IdGen = makeIdGen(secureRng);

export const hasher: Hasher = {
  sha256: async (text: string) => sha256Hex(text),
};
