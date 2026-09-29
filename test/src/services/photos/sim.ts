import type { LatLng } from '../../types';
import type { Clock, PhotoProvider, PickedPhoto } from '../../core/ports';

/**
 * 모의 사진(WP6 소유, 순수). 번들 이미지 없이 sim 메타(label, tone)로 SVG 타일을 그린다.
 * 시드가 같으면 같은 사진 열이 나온다. 3장 중 1장(3·6·9번째…)은 EXIF가 없어 추정 경로를 탄다.
 * 4번째마다 10MB를 넘는 사진을 섞어 압축 표시를 시연한다. store를 import하지 않는다(위치는 getPosition으로 받는다).
 */

const LABELS = ['풍경', '골목', '음식', '함께', '하늘', '기념', '돌담', '야경'];
const BIG_BYTES = 12_800_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSimPhotoProvider(opts: {
  clock: Clock;
  getPosition: () => LatLng | undefined;
  seed: number;
}): PhotoProvider {
  const rand = mulberry32(opts.seed);
  let n = 0;
  return {
    id: 'sim',
    async pick({ multiple }): Promise<PickedPhoto[]> {
      const count = multiple ? 3 : 1;
      const out: PickedPhoto[] = [];
      const now = opts.clock.now();
      const pos = opts.getPosition();
      for (let i = 0; i < count; i += 1) {
        n += 1;
        const r1 = rand();
        const r2 = rand();
        const r3 = rand();
        const r4 = rand();
        const withExif = n % 3 !== 0;
        const bytes = n % 4 === 0 ? BIG_BYTES : 1_600_000 + Math.floor(r1 * 4_000_000);
        const label = LABELS[Math.floor(r2 * LABELS.length)];
        const photo: PickedPhoto = {
          uri: `sim://photo/${opts.seed}/${n}`,
          bytes,
          width: 1600,
          height: 1200,
          sim: { label: `${label} ${n}`, tone: Math.floor(r3 * 4) },
        };
        if (withExif) {
          // 촬영은 고르기 직전 0~4분 사이, 위치는 현재 위치 주변 20m 안
          const takenAt = now - Math.floor(r4 * 5) * 60_000 - (count - i) * 1000;
          const exif: PickedPhoto['exif'] = { takenAt };
          if (pos) {
            exif.coord = {
              latitude: pos.latitude + (r1 - 0.5) * 0.0003,
              longitude: pos.longitude + (r2 - 0.5) * 0.0003,
            };
          }
          photo.exif = exif;
        }
        out.push(photo);
      }
      return out;
    },
  };
}
