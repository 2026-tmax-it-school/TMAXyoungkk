import React, { useEffect } from 'react';

import { useUi } from '../store/ui';
import { Toast } from '../ui';

const TOAST_MS = 3200;

/** 앱 전체에 하나. useUi.showToast로 띄우고 3.2초 뒤 스스로 지운다. */
export function ToastHost() {
  const toast = useUi((s) => s.toast);
  const clearToast = useUi((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => clearToast(toast.id), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast, clearToast]);
  if (!toast) return null;
  return <Toast text={toast.text} tone={toast.tone} />;
}
