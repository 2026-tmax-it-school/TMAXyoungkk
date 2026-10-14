import React, { useEffect } from 'react';

import { useUi } from '../store/ui';
import { Toast } from '../ui';
import { toastDuration } from './toastTime';

/** 앱 전체에 하나. useUi.showToast로 띄우고 글 길이에 맞춘 시간(toastDuration, 2.5~6초) 뒤 스스로 지운다. */
export function ToastHost() {
  const toast = useUi((s) => s.toast);
  const clearToast = useUi((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => clearToast(toast.id), toastDuration(toast.text));
    return () => clearTimeout(id);
  }, [toast, clearToast]);
  if (!toast) return null;
  return <Toast text={toast.text} tone={toast.tone} />;
}
