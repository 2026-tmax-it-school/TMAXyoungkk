/**
 * Maps JavaScript API 스크립트 주소(순수). 구글 지도 SDK 주소는 components/map 안에서만 쓴다(qa-decisions 국내 전용 규칙).
 * 키가 비면 key를 넣지 않는다(그 경우 어댑터를 고르지 않는다).
 */
export function googleScriptUrl(key: string, callback: string): string {
  const q = new URLSearchParams({ v: 'weekly', language: 'ko', region: 'KR', loading: 'async', callback });
  if (key.trim()) q.set('key', key.trim());
  return `https://maps.googleapis.com/maps/api/js?${q.toString()}`;
}
