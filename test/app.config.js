/**
 * Young Trip 앱 설정.
 *
 * 지도는 MapCanvas 한 벌이다. 구글 키가 없으면 react-native-svg 기본 지도라 지도 키가 필요 없다.
 * 구글 지도(react-native-maps)를 개발 빌드에 넣을 때만 아래 키를 읽는다. Expo Go는 키 없이 안드로이드 구글 지도가 뜬다.
 *   GOOGLE_MAPS_ANDROID_API_KEY  Maps SDK for Android 키(패키지 이름·SHA-1으로 제한). 있으면 extra.androidGoogleMaps
 *   GOOGLE_MAPS_IOS_API_KEY      Maps SDK for iOS 키(번들 ID로 제한). 있으면 iOS도 구글 지도(extra.iosGoogleMaps)
 *   웹 키(EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)는 대신 쓰지 않는다. 웹 키는 웹사이트·Maps JavaScript API로 제한하므로
 *   Maps SDK for Android·iOS가 거부한다(빈 회색 지도). 안드로이드 개발 빌드에 키가 없으면 앱은 기본 지도(SVG)를 쓴다.
 * 실제 제공자 키(EXPO_PUBLIC_KAKAO_REST_KEY 등)는 JS 쪽 src/config.ts에서만 읽는다.
 *
 * 권한 문구는 Expo SDK 57 문서의 config plugin 키를 따른다.
 *   expo-location: locationWhenInUsePermission (여행 진행 중 앱이 떠 있을 때)
 *     locationAlwaysAndWhenInUsePermission·locationAlwaysPermission (iOS '항상 허용'. 백그라운드 동선 기록을 켤 때만 묻는다)
 *     isIosBackgroundLocationEnabled (UIBackgroundModes location), isAndroidBackgroundLocationEnabled·
 *     isAndroidForegroundServiceEnabled (ACCESS_BACKGROUND_LOCATION, 포그라운드 서비스 알림).
 *     백그라운드 동선 기록은 사용자가 켜는 옵션이고 기본은 꺼짐이다. 개발 빌드에서만 켤 수 있다(Expo Go·웹은 안내만).
 *     작업(expo-task-manager defineTask)은 index.ts가 src/services/location/background.ts를 불러와 정의한다.
 *   android.permissions POST_NOTIFICATIONS: 안드로이드 13부터 포그라운드 서비스 알림('동선 기록 중')도 알림 권한이 있어야
 *     알림창에 보인다. 백그라운드 동선 기록을 켤 때만 묻는다(거부해도 기록은 되고 알림만 보이지 않는다).
 *   expo-image-picker: photosPermission (카메라·마이크는 쓰지 않아 막는다)
 */
const androidMapsKey = (process.env.GOOGLE_MAPS_ANDROID_API_KEY || '').trim();
const iosMapsKey = (process.env.GOOGLE_MAPS_IOS_API_KEY || '').trim();

/**
 * iOS '항상 허용' 권한 문구. 백그라운드 동선 기록을 켤 때만 묻는다.
 * 화면 밖 위치는 동선(이 기기에만)과 스팟 도착 확인(여행방 방문 기록, 좌표 없음)에 쓰므로 둘 다 적는다.
 * 안드로이드 '동선 기록 중' 알림 문구(src/services/location/background.ts)와 같은 내용이다.
 */
const BACKGROUND_LOCATION_TEXT =
  '백그라운드 동선 기록을 켜면 앱이 화면 밖에 있어도 여행 동선을 남기고 스팟 도착을 확인하려고 위치를 사용합니다. 동선은 이 기기에만 남고, 스팟에 도착하면 여행방 방문 기록에 남깁니다. 여행 진행을 끝내거나 기록을 끄면 멈춥니다.';

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    androidGoogleMaps: androidMapsKey.length > 0,
    iosGoogleMaps: iosMapsKey.length > 0,
  },
  name: 'Young Trip',
  slug: 'young-trip',
  scheme: 'youngtrip',
  ios: {
    ...config.ios,
    bundleIdentifier: 'app.youngtrip.proto',
  },
  android: {
    ...config.android,
    package: 'app.youngtrip.proto',
    permissions: [...new Set([...(config.android?.permissions ?? []), 'android.permission.POST_NOTIFICATIONS'])],
  },
  plugins: [
    ...(config.plugins ?? []),
    'expo-font',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          '여행 중 현재 위치를 지도에 보여주고 스팟 도착을 확인하려고 위치를 사용합니다. 앱이 떠 있을 때 씁니다.',
        locationAlwaysAndWhenInUsePermission: BACKGROUND_LOCATION_TEXT,
        locationAlwaysPermission: BACKGROUND_LOCATION_TEXT,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'react-native-maps',
      {
        ...(androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}),
        ...(iosMapsKey ? { iosGoogleMapsApiKey: iosMapsKey } : {}),
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: '여행 사진을 여행방에 올리고 일기에 넣으려고 사진 보관함을 사용합니다.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
});
