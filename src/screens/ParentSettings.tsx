import React from 'react';
import DashboardSettingsScreen from './DashboardSettingsScreen';

export default function ParentSettings({ navigation }: any) {
  return <DashboardSettingsScreen role="parent" navigation={navigation} />;
}
