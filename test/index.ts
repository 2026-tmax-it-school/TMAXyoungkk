import { registerRootComponent } from 'expo';

// 백그라운드 동선 기록 작업(expo-task-manager defineTask)은 모듈 최상위에서 앱 등록 전에 정의해야 한다.
// 앱이 백그라운드에서 다시 떠도 정의되도록 먼저 불러온다. Expo Go·웹에서는 작업 관리자를 불러오지 않는다.
import './src/services/location/background';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
