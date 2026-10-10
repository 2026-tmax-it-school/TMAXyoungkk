import type { LatLng } from '../../types';
import type { RouteLeg } from '../ports';
import { legShape, type MapLeg } from '../map/model';

/**
 * 시뮬레이터 구간 모양 모으기(WP5 소유, 순수). 시뮬레이터 점이 지도 선(길)을 따라가게 그날 구간마다 경로(route)를 받아
 * 지도와 같은 모양(core/map/model.legShape)을 같은 키(MapLeg.key = legGeometryKey)로 담는다. generateTrack의 legShapes 입력이다.
 * 직선(두 점)·실패한 구간은 담지 않는다(그 구간은 직선으로 간다).
 * 받는 대로 got에 채우고 done은 모두 끝나면 풀린다. 부르는 쪽(store/live)이 상한까지만 기다리고 그때까지 받은 것으로
 * 궤적을 만든 뒤, 늦게 받은 모양이 있으면 같은 입력으로 다시 만든다.
 */

export interface LegShapeGather {
  got: Record<string, LatLng[]>;
  done: Promise<void>;
}

export function gatherLegShapes(legs: MapLeg[], fetchLeg: (leg: MapLeg) => Promise<RouteLeg | null>): LegShapeGather {
  const got: Record<string, LatLng[]> = {};
  const jobs = legs.map((leg) =>
    Promise.resolve()
      .then(() => fetchLeg(leg))
      .then(
        (geo) => {
          const shape = legShape(leg, geo);
          if (shape.length > 2) got[leg.key] = shape;
        },
        () => undefined,
      ),
  );
  return { got, done: Promise.all(jobs).then(() => undefined) };
}

/** 받은 모양 가운데 known에 없는 키 */
export function newShapeKeys(got: Record<string, LatLng[]>, known: Record<string, LatLng[]>): string[] {
  return Object.keys(got).filter((k) => !(k in known));
}
