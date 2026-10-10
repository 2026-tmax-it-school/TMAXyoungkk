/**
 * 구글 지도 바탕 스타일(웹 styles, 안드로이드 customMapStyle 공통).
 * 흰 바탕 앱에 맞춰 무채색으로 누른다. 가게·대중교통 아이콘은 끄고, 도로는 흰 선, 물은 옅은 청회색, 공원은 옅은 초록이다.
 * 핀과 선(잉크·청회색·초록·앰버)이 바탕보다 먼저 읽혀야 한다.
 * 글자색은 놓이는 바탕(일반 #F4F4F5, 도로 #FFFFFF, 고속도로 #E4E4E7, 공원 #E2EEE6, 물 #DCE3EA) 위에서 4.5:1 이상이다.
 * mapId를 쓰면 이 스타일이 무시된다. 그래서 웹 지도는 mapId 없이 띄운다.
 */
export interface GoogleMapStyleRule {
  featureType?: string;
  elementType?: string;
  stylers: Record<string, string | number>[];
}

export const GOOGLE_MAP_STYLE: GoogleMapStyleRule[] = [
  { elementType: 'geometry', stylers: [{ color: '#F4F4F5' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5C5C61' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F4F4F5' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#D4D4D8' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#ECECEE' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#5C5C61' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#E2EEE6' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#5C5C61' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#E4E4E7' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#D4D4D8' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#DCE3EA' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4F5A66' }] },
];
