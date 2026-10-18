import React from 'react';

import type { LatLng } from '../../../types';
import { MapCanvas } from '../../../components/map/MapCanvas';
import { decodeRegionId, regionById } from '../../../data/regions';
import { useTripDoc } from '../../../store/trips';
import { useUi } from '../../../store/ui';
import { AlertDialog } from '../../../ui';
import { useLocationConsent } from '../locationConsent';

/**
 * 위치 사용 동의 대화상자(WP5 소유, 2026-10-17 사용자 요청: 휴대폰 시스템 알림처럼 위치를 쓸 건지 묻는 화면).
 * 앱 루트(App.tsx)에 하나만 둔다. 위치를 처음 쓰려 할 때 services/location/consent가 띄운다.
 * 지도 미리보기는 지금 여행방 지역(없으면 서울)이다. 아직 위치를 모르므로 내 위치 점은 그리지 않는다.
 * 허용하면 그다음에 기기(OS·브라우저)가 권한을 한 번 더 물을 수 있다.
 */

const APP_NAME = 'Young Trip';
const SEOUL: LatLng = { latitude: 37.5512, longitude: 126.9882 };
const PREVIEW_H = 150;

export function LocationConsentDialog() {
  const open = useLocationConsent((s) => s.open);
  const answer = useLocationConsent((s) => s.answer);
  const tripId = useUi((s) => s.currentTripId);
  const trip = useTripDoc(tripId);
  if (!open) return null;
  const region = trip ? (regionById(trip.region) ?? decodeRegionId(trip.region)) : undefined;
  const center = region?.center ?? SEOUL;
  return (
    <AlertDialog
      visible={open}
      title={`'${APP_NAME}'이(가) 사용자의 위치를 사용하도록 허용할까요?`}
      text="지도에 내 위치를 보이고 여행 중 도착을 기록해요. 위치는 기기 안에서만 써요"
      actions={[
        { label: '한 번 허용', onPress: () => answer('once') },
        { label: '앱을 사용하는 동안 허용', onPress: () => answer('whileUsing') },
        { label: '허용 안 함', onPress: () => answer('deny') },
      ]}
      onRequestClose={() => answer('deny')}
    >
      <MapCanvas compact height={PREVIEW_H} markers={[]} polylines={[]} fitTo={[center]} />
    </AlertDialog>
  );
}
