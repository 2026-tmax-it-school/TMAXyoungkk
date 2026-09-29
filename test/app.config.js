/**
 * Young Trip 앱 설정.
 *
 * 지도는 MapCanvas 한 벌이다. 구글 키가 없으면 react-native-svg 기본 지도라 지도 키가 필요 없다.
 * 구글 지도(react-native-maps)를 개발 빌드에 넣을 때만 아래 키를 읽는다. Expo Go는 키 없이 안드로이드 구글 지도가 뜬다.
 *   GOOGLE_MAPS_ANDROID_API_KEY  Maps SDK for Android 키(패키지 이름·SHA-1으로 제한)
 *   GOOGLE_MAPS_IOS_API_KEY      Maps SDK for iOS 키(번들 ID로 제한). 있으면 iOS도 구글 지도(extra.iosGoogleMaps)
 *   둘 다 없으면 EXPO_PUBLIC_GOOGLE_MAPS_API_KEY를 대신 쓴다(시연 한정. 실서비스는 플랫폼마다 키를 나눈다).
 * 실제 제공자 키(EXPO_PUBLIC_KAKAO_REST_KEY 등)는 JS 쪽 src/config.ts에서만 읽는다.
 *
 * 권한 문구는 Expo SDK 57 문서의 config plugin 키를 따른다.
 *   expo-location: locationWhenInUsePermission (앱이 떠 있을 때만 쓴다. 백그라운드 추적은 범위 밖)
 *   expo-image-picker: photosPermission (카메라·마이크는 쓰지 않아 막는다)
 */
const sharedMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || sharedMapsKey;
const iosMapsKey = process.env.GOOGLE_MAPS_IOS_API_KEY || sharedMapsKey;

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
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
  },
  plugins: [
    ...(config.plugins ?? []),
    'expo-font',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          '여행 중 현재 위치를 지도에 보여주고 스팟 도착을 확인하려고 위치를 사용합니다. 앱이 떠 있을 때만 씁니다.',
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
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
