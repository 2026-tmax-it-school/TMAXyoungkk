/**
 * 서비스 진입점. 화면·스토어는 여기서 가져다 쓴다. 순수 영역(core, data)은 import하지 않는다.
 */
export {
  describeServices,
  getServices,
  overrideServices,
  resetServices,
  type ServiceStatus,
  type Services,
} from './registry';
export {
  appClock,
  isClockOverridden,
  liveClock,
  onClockChange,
  setClockOverride,
  systemClock,
  useNow,
} from './clock';
export { hasher, ids, secureRng } from './random';
export { asyncStorageKV, persistStorage, waitForHydration } from './kv';
export { copyText, shareText, type ShareOutcome } from './share';
