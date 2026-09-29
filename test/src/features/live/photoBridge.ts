import { importPhotos } from '../journal/api';
import { registerPhotoImporter } from '../../store/live';

/**
 * 시뮬레이터 사진 이벤트 → WP6 importPhotos(WP5 소유).
 * features/journal/api가 store/live를 import하므로 스토어가 직접 import하면 순환이 된다.
 * 이 모듈을 불러오는 순간(19·11 화면 import, 앱 시작 때) 등록된다.
 */
registerPhotoImporter(importPhotos);

export const PHOTO_BRIDGE_READY = true;
