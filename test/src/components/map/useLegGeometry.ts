import { useEffect, useState } from 'react';

import type { RouteLeg } from '../../core/ports';
import type { MapLeg } from '../../core/map/model';
import { getServices } from '../../services/registry';

/**
 * 지도 선 모양(WP5 소유). 구간마다 routes.route()를 불러 polyline을 얻는다(03 회의 C9).
 * 경로 제공자가 24시간 캐시를 거치고, 여기서는 화면 사이를 오갈 때 깜빡이지 않게 메모리에 한 번 더 둔다.
 * 이 호출은 buildPlan의 routeCalls(08 수치)에 넣지 않는다. 실패하거나 경로가 없으면 null이고 선은 직선이 된다.
 * 실패(null)는 메모에 두지 않는다. 일시 장애 한 번으로 세션 내내 직선이 되지 않게, 다음 화면 진입 때 다시 부른다.
 */

const memo = new Map<string, RouteLeg | null>();
const inflight = new Map<string, Promise<RouteLeg | null>>();

function fetchLeg(leg: MapLeg): Promise<RouteLeg | null> {
  const hit = inflight.get(leg.key);
  if (hit) return hit;
  const p = getServices()
    .routes.route(leg.from, leg.to, leg.transport)
    .catch(() => null)
    .then((r) => {
      if (r) memo.set(leg.key, r);
      inflight.delete(leg.key);
      return r;
    });
  inflight.set(leg.key, p);
  return p;
}

/** 시연 리셋 때 지도 선 모양 메모를 비운다(경로 캐시는 resetServices가 비운다). */
export function clearLegGeometry(): void {
  memo.clear();
}

export function useLegGeometry(legs: MapLeg[]): Record<string, RouteLeg | null | undefined> {
  const keys = legs.map((l) => l.key).join('|');
  const [geo, setGeo] = useState<Record<string, RouteLeg | null | undefined>>(() => {
    const out: Record<string, RouteLeg | null | undefined> = {};
    for (const l of legs) if (memo.has(l.key)) out[l.key] = memo.get(l.key);
    return out;
  });
  useEffect(() => {
    let alive = true;
    const missing = legs.filter((l) => !memo.has(l.key));
    const known: Record<string, RouteLeg | null | undefined> = {};
    for (const l of legs) if (memo.has(l.key)) known[l.key] = memo.get(l.key);
    setGeo(known);
    for (const l of missing) {
      void fetchLeg(l).then((r) => {
        if (alive) setGeo((g) => ({ ...g, [l.key]: r }));
      });
    }
    return () => {
      alive = false;
    };
    // legs는 keys가 같으면 같은 구간이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return geo;
}
