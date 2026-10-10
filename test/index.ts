import { registerRootComponent } from 'expo';
import * as WebBrowser from 'expo-web-browser';

// 웹 구글·카카오 로그인: 제공자 창(팝업)이 우리 주소로 돌아오면 앱을 그리기 전에 결과를 원래 창으로 넘기고 창을 닫는다.
// 화면 모듈보다 먼저 불러야 첫 화면 이동(온보딩 등)이 돌아온 주소의 code를 지우기 전에 처리된다
WebBrowser.maybeCompleteAuthSession();

// 백그라운드 동선 기록 작업(expo-task-manager defineTask)은 모듈 최상위에서 앱 등록 전에 정의해야 한다.
// 앱이 백그라운드에서 다시 떠도 정의되도록 먼저 불러온다. Expo Go·웹에서는 작업 관리자를 불러오지 않는다.
import './src/services/location/background';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
