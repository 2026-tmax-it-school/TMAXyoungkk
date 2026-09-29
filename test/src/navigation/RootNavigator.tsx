import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { DefaultTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import CandidatesScreen from '../screens/CandidatesScreen';
import ChatScreen from '../screens/ChatScreen';
import CreateTripScreen from '../screens/CreateTripScreen';
import DiaryScreen from '../screens/DiaryScreen';
import HomeScreen from '../screens/HomeScreen';
import InviteAcceptScreen from '../screens/InviteAcceptScreen';
import LegTransportScreen from '../screens/LegTransportScreen';
import LiveTripScreen from '../screens/LiveTripScreen';
import LoginScreen from '../screens/LoginScreen';
import MapScreen from '../screens/MapScreen';
import MembersScreen from '../screens/MembersScreen';
import MoreScreen from '../screens/MoreScreen';
import NavigateScreen from '../screens/NavigateScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import PhotosScreen from '../screens/PhotosScreen';
import PlanningScreen from '../screens/PlanningScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RecommendScreen from '../screens/RecommendScreen';
import RecordMapScreen from '../screens/RecordMapScreen';
import ScheduleEditScreen from '../screens/ScheduleEditScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import SignupScreen from '../screens/SignupScreen';
import SocialConsentScreen from '../screens/SocialConsentScreen';
import SpotDetailScreen from '../screens/SpotDetailScreen';
import TripSettingsScreen from '../screens/TripSettingsScreen';
import { lineC, surfaceC, TabBar, textC } from '../ui';
import { TAB_ITEMS, type MainTabParamList, type RootStackParamList, type TabRouteName } from './routes';

/**
 * 루트 스택과 하단 탭. 헤더는 화면이 ui/Header로 직접 그린다(네이티브 헤더를 쓰지 않는다).
 * 등록 규칙은 routes.ts(A8)를 따른다. 채팅과 모달·스택 화면에는 탭바가 없다.
 */

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

export const navTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: textC.accent,
    background: surfaceC.bg,
    card: surfaceC.card,
    text: textC.ink,
    border: lineC.line,
    notification: textC.accent,
  },
};

function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const active = state.routes[state.index].name as TabRouteName;
  return (
    <TabBar
      items={TAB_ITEMS}
      active={active}
      onPress={(key) => {
        if (key !== active) navigation.navigate(key);
      }}
    />
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Candidates" component={CandidatesScreen} />
      <Tabs.Screen name="Schedule" component={ScheduleScreen} />
      <Tabs.Screen name="Map" component={MapScreen} />
      <Tabs.Screen name="More" component={MoreScreen} />
    </Tabs.Navigator>
  );
}

export function RootNavigator({ hasSession }: { hasSession: boolean }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: surfaceC.bg } }}>
      {hasSession ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="CreateTrip" component={CreateTripScreen} />
          <Stack.Screen name="TripSettings" component={TripSettingsScreen} />
          <Stack.Screen name="Members" component={MembersScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="SpotDetail" component={SpotDetailScreen} />
          <Stack.Screen name="Recommend" component={RecommendScreen} />
          <Stack.Screen name="Planning" component={PlanningScreen} />
          <Stack.Screen name="ScheduleEdit" component={ScheduleEditScreen} />
          <Stack.Screen name="LegTransport" component={LegTransportScreen} />
          <Stack.Screen name="Navigate" component={NavigateScreen} />
          <Stack.Screen name="LiveTrip" component={LiveTripScreen} />
          <Stack.Screen name="Photos" component={PhotosScreen} />
          <Stack.Screen name="Diary" component={DiaryScreen} />
          <Stack.Screen name="RecordMap" component={RecordMapScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
        </>
      ) : (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      )}
      <Stack.Screen name="InviteAccept" component={InviteAcceptScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen name="SocialConsent" component={SocialConsentScreen} />
    </Stack.Navigator>
  );
}
