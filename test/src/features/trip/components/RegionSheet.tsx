import React from 'react';
import { ScrollView } from 'react-native';

import { REGIONS } from '../../../data/regions';
import { SP, Sheet } from '../../../ui';
import { PickRow } from './PickerBox';

/** 지역 선택(FR-201). 국내 목록(data/regions)에서만 고른다. 해외는 로드맵이라 없다. */
export function RegionSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value?: string;
  onClose: () => void;
  onPick: (regionId: string) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="지역 고르기">
      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: SP.m }}>
        {REGIONS.map((r) => (
          <PickRow
            key={r.id}
            icon="pin"
            title={r.name}
            sub={r.label}
            on={r.id === value}
            onPress={() => {
              onPick(r.id);
              onClose();
            }}
          />
        ))}
      </ScrollView>
    </Sheet>
  );
}
