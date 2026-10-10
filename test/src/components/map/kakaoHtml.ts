import type { WireItem } from './overlayItems';
import { kakaoScriptUrl } from './kakaoScript';

/**
 * 앱 카카오 지도(WebView) 페이지와 다리(순수, WP5 소유). KakaoMapView.tsx가 이 HTML을 baseUrl https://localhost로 띄운다.
 * 카카오는 SDK 요청의 출처를 앱 키의 플랫폼 Web 도메인과 맞춰 보므로 콘솔에 https://localhost를 등록해 둔다.
 * https 출처라 SDK·타일 요청이 모두 https다(안드로이드 평문 차단, iOS ATS에 걸리지 않는다).
 *
 * 다리 모양
 * - 앱에서 페이지로: injectJavaScript로 window.__ytIn(메시지)를 부른다(bridgeScript). 지도가 뜨기 전 메시지는 쌓아 두었다가 뜬 뒤 처리한다.
 *   markers(묶음 계산용 좌표), items(그릴 핀), lines, ring(정확도 원), fit(화면 맞춤), center(내 위치로 옮기기)
 * - 페이지에서 앱으로: ReactNativeWebView.postMessage(JSON). parseKakaoOut이 모양을 확인한다.
 *   ready, view(지금 레벨과 markers의 화면 좌표), tap(핀 key), press(지도 누른 곳), moved(사용자가 움직임), fail(이유)
 * 묶음은 앱이 view의 화면 좌표로 core/map/layout.clusterMarkers를 돌려 만든다(웹 어댑터와 같은 규칙).
 */

export type LL = [number, number];

export interface KakaoPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type KakaoInMsg =
  | { t: 'markers'; coords: LL[] }
  | { t: 'items'; items: WireItem[] }
  | { t: 'lines'; lines: { coords: LL[]; color: string; dashed: boolean; weight: number }[] }
  | { t: 'ring'; ring: { at: LL; radius: number; color: string } | null }
  | { t: 'fit'; coords: LL[]; pad: KakaoPadding; maxLevel: number }
  /** 내 위치로 옮기기. level이 있으면 그 레벨까지 당기고(이미 더 가까우면 그대로) setCenter, 없으면 panTo(따라가기) */
  | { t: 'center'; at: LL; level?: number };

export type KakaoOutMsg =
  | { t: 'ready' }
  | { t: 'view'; level: number; points: (LL | null)[] }
  | { t: 'tap'; key: string }
  | { t: 'press'; lat: number; lng: number }
  | { t: 'moved' }
  | { t: 'fail'; reason: 'auth' | 'script' | 'tiles' };

export interface KakaoPageConfig {
  appKey: string;
  /** 지도 칸 바탕(타일이 오기 전) */
  bg: string;
  compact: boolean;
  center: LL;
  level: number;
  /** SDK 스크립트를 받은 뒤 이 안에 지도 코드를 못 불러오면 키·도메인 거부로 본다(스크립트 받는 시간과 앱이 뒤에 있는 동안은 세지 않는다) */
  loadTimeoutMs: number;
  /** 지도가 보이는 동안 첫 타일이 이 안에 안 오면 못 불러온 것으로 본다 */
  tileTimeoutMs: number;
  clickDelayMs: number;
}

/** 스크립트 안에 넣는 JSON. '<'와 줄 구분 문자를 이스케이프해 </script>나 옛 엔진의 문자열 끊김이 생기지 않게 한다 */
export function safeJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const ATTR: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;' };
export function escAttr(s: string): string {
  return s.replace(/[&"<>']/g, (ch) => ATTR[ch]);
}

/** 카카오 콘솔 플랫폼 Web 도메인에 등록하는 앱 WebView 출처 */
export const KAKAO_WEBVIEW_BASE_URL = 'https://localhost';
/** WebView가 띄워도 되는 문서 출처(originWhitelist). 그 밖의 주소는 kakaoNavAction이 막거나 바깥 브라우저로 돌린다 */
export const KAKAO_WEBVIEW_ORIGINS = ['https://localhost*', 'about:*'];

/** 우리 다리 페이지 자체(처음 문서)인지. 안드로이드는 about:blank, iOS는 baseUrl을 문서 주소로 알린다 */
export function isKakaoBridgeUrl(url: string | undefined): boolean {
  if (!url) return true;
  return url === 'about:blank' || url === KAKAO_WEBVIEW_BASE_URL || url.startsWith(`${KAKAO_WEBVIEW_BASE_URL}/`) || url.startsWith('data:');
}

/**
 * WebView 이동 요청을 어떻게 할지(순수). 처음 문서와 하위 프레임·리소스는 그대로 둔다(allow).
 * 그 밖의 맨 위 문서 이동(카카오 로고·저작권 링크 등)은 지도 칸을 바꾸지 않고 바깥 브라우저로 연다(open, http·https만). 나머지 주소는 막는다(block).
 */
export function kakaoNavAction(url: string, isTopFrame = true): 'allow' | 'open' | 'block' {
  if (isKakaoBridgeUrl(url)) return 'allow';
  if (!isTopFrame) return 'allow';
  return /^https?:\/\//i.test(url) ? 'open' : 'block';
}

/** 앱에서 페이지로 메시지 하나를 부르는 스크립트. 끝의 true는 injectJavaScript 관례다 */
export function bridgeScript(msg: KakaoInMsg): string {
  return `window.__ytIn&&window.__ytIn(${safeJson(msg)});true;`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isLL = (v: unknown): v is LL => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

/** 페이지에서 앱으로 메시지를 읽는다. 모양이 틀리면 undefined(다른 페이지·스크립트가 보낸 것은 버린다) */
export function parseKakaoOut(data: string): KakaoOutMsg | undefined {
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case 'ready':
    case 'moved':
      return { t: m.t };
    case 'view':
      if (!isNum(m.level) || !Array.isArray(m.points)) return undefined;
      return { t: 'view', level: m.level, points: m.points.map((p) => (isLL(p) ? p : null)) };
    case 'tap':
      return typeof m.key === 'string' ? { t: 'tap', key: m.key } : undefined;
    case 'press':
      return isNum(m.lat) && isNum(m.lng) ? { t: 'press', lat: m.lat, lng: m.lng } : undefined;
    case 'fail':
      return m.reason === 'auth' || m.reason === 'script' || m.reason === 'tiles' ? { t: 'fail', reason: m.reason } : undefined;
    default:
      return undefined;
  }
}

/**
 * 페이지 스크립트. ES5 문법으로 둔다(오래된 안드로이드 WebView). 핀은 CustomOverlay에 DOM 노드로 얹고 key로 붙잡아 다시 쓴다.
 * 손짓: 미리보기(compact)는 움직이지 않는다. 그 밖은 한 손가락 끌기와 두 손가락 확대다.
 * 사용자가 움직였는지는 손짓(끌기 시작, 두 손가락, 더블탭)으로만 판단한다. 코드가 맞출 때의 배율 변화와 섞이지 않게 한다.
 */
const PAGE_SCRIPT = `
(function(){
var C=window.__ytConfig,RN=window.ReactNativeWebView,map=null,queue=[],ov={},lines=[],ring=null,marks=[],failed=false;
function out(m){if(RN)RN.postMessage(JSON.stringify(m));}
function fail(r){if(failed)return;failed=true;out({t:'fail',reason:r});}
var loadTimer=null;
function armLoad(){loadTimer=setTimeout(function(){if(document.visibilityState==='hidden'){armLoad();return;}fail('auth');},C.loadTimeoutMs);}
window.__ytScriptError=function(){clearTimeout(loadTimer);fail('script');};
window.__ytScriptLoaded=function(){
  if(!window.kakao||!kakao.maps||!kakao.maps.load){fail('script');return;}
  armLoad();
  kakao.maps.load(function(){clearTimeout(loadTimer);if(!failed)init();});
};
function ll(c){return new kakao.maps.LatLng(c[0],c[1]);}
function view(){
  if(!map)return;
  var pj=map.getProjection();
  out({t:'view',level:map.getLevel(),points:marks.map(function(c){var p=pj.containerPointFromCoords(ll(c));return p?[p.x,p.y]:null;})});
}
function setItems(items){
  var seen={};
  items.forEach(function(it){
    seen[it.key]=1;
    var o=ov[it.key];
    if(o&&o.sig!==it.sig){o.ov.setMap(null);delete ov[it.key];o=null;}
    if(o){o.ov.setPosition(ll(it.at));return;}
    var el=document.createElement('div');
    el.innerHTML=it.html;el.style.width=it.size+'px';el.style.height=it.size+'px';
    if(it.press){
      el.setAttribute('role','button');el.setAttribute('aria-label',it.name||'');el.tabIndex=0;
      el.addEventListener('click',function(e){e.stopPropagation();out({t:'tap',key:it.key});});
    }else{
      el.style.pointerEvents='none';
      if(it.name){el.setAttribute('role','img');el.setAttribute('aria-label',it.name);}else{el.setAttribute('aria-hidden','true');}
    }
    var c=new kakao.maps.CustomOverlay({position:ll(it.at),content:el,xAnchor:0.5,yAnchor:0.5,zIndex:it.z,clickable:!!it.press});
    c.setMap(map);
    ov[it.key]={ov:c,sig:it.sig};
  });
  for(var k in ov){if(!seen[k]){ov[k].ov.setMap(null);delete ov[k];}}
}
function setLines(ls){
  lines.forEach(function(l){l.setMap(null);});
  lines=ls.map(function(l){return new kakao.maps.Polyline({map:map,path:l.coords.map(ll),strokeWeight:l.weight,strokeColor:l.color,strokeOpacity:1,strokeStyle:l.dashed?'shortdash':'solid'});});
}
function setRing(r){
  if(!r){if(ring)ring.setMap(null);ring=null;return;}
  if(!ring)ring=new kakao.maps.Circle({map:map,center:ll(r.at),radius:r.radius,strokeWeight:0,strokeOpacity:0,fillColor:r.color,fillOpacity:0.14});
  else{ring.setPosition(ll(r.at));ring.setRadius(r.radius);}
}
function fit(m){
  map.relayout();
  var cs=m.coords;
  if(cs.length===0){map.setCenter(ll(C.center));map.setLevel(C.level);}
  else if(cs.length===1){map.setCenter(ll(cs[0]));map.setLevel(m.maxLevel);}
  else{
    var b=new kakao.maps.LatLngBounds();
    cs.forEach(function(c){b.extend(ll(c));});
    map.setBounds(b,m.pad.top,m.pad.right,m.pad.bottom,m.pad.left);
    if(map.getLevel()<m.maxLevel)map.setLevel(m.maxLevel);
  }
  view();
}
function center(m){
  map.relayout();
  if(m.level){if(map.getLevel()>m.level)map.setLevel(m.level);map.setCenter(ll(m.at));}
  else if(map.panTo)map.panTo(ll(m.at));
  else map.setCenter(ll(m.at));
  view();
}
function handle(m){
  if(m.t==='markers'){marks=m.coords;view();}
  else if(m.t==='items')setItems(m.items);
  else if(m.t==='lines')setLines(m.lines);
  else if(m.t==='ring')setRing(m.ring);
  else if(m.t==='fit')fit(m);
  else if(m.t==='center')center(m);
}
window.__ytIn=function(m){if(failed)return;if(!map){queue.push(m);return;}handle(m);};
function init(){
  var el=document.getElementById('map');
  map=new kakao.maps.Map(el,{center:ll(C.center),level:C.level,draggable:!C.compact,scrollwheel:false,disableDoubleClickZoom:C.compact,keyboardShortcuts:false});
  if(C.compact)map.setZoomable(false);
  var tiles=false,waited=0;
  kakao.maps.event.addListener(map,'tilesloaded',function(){tiles=true;});
  var tick=setInterval(function(){
    if(tiles||failed){clearInterval(tick);return;}
    if(document.visibilityState==='visible'&&el.offsetWidth>0&&el.offsetHeight>0)waited+=500;
    if(waited>=C.tileTimeoutMs){clearInterval(tick);fail('tiles');}
  },500);
  kakao.maps.event.addListener(map,'dragstart',function(){out({t:'moved'});});
  kakao.maps.event.addListener(map,'idle',view);
  kakao.maps.event.addListener(map,'zoom_changed',view);
  var clickTimer;
  kakao.maps.event.addListener(map,'click',function(e){
    var p=e.latLng;clearTimeout(clickTimer);
    clickTimer=setTimeout(function(){out({t:'press',lat:p.getLat(),lng:p.getLng()});},C.clickDelayMs);
  });
  kakao.maps.event.addListener(map,'dblclick',function(){clearTimeout(clickTimer);if(!C.compact)out({t:'moved'});});
  el.addEventListener('touchstart',function(e){if(!C.compact&&e.touches.length>1)out({t:'moved'});},{passive:true});
  window.addEventListener('resize',function(){map.relayout();});
  out({t:'ready'});
  var q=queue;queue=[];q.forEach(handle);
}
})();
`;

/** 앱 WebView에 띄울 페이지 전체 */
export function buildKakaoHtml(c: KakaoPageConfig): string {
  const config = {
    bg: c.bg,
    compact: c.compact,
    center: c.center,
    level: c.level,
    loadTimeoutMs: c.loadTimeoutMs,
    tileTimeoutMs: c.tileTimeoutMs,
    clickDelayMs: c.clickDelayMs,
  };
  return [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">',
    `<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:${escAttr(c.bg)};-webkit-tap-highlight-color:transparent}</style>`,
    '</head><body><div id="map"></div>',
    `<script>window.__ytConfig=${safeJson(config)};</script>`,
    `<script>${PAGE_SCRIPT}</script>`,
    `<script src="${escAttr(kakaoScriptUrl(c.appKey))}" onload="window.__ytScriptLoaded()" onerror="window.__ytScriptError()"></script>`,
    '</body></html>',
  ].join('');
}
