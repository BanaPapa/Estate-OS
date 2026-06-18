// 앱 전역 설정 (테마/색상/표시) — localStorage 영속 + CSS 변수로 즉시 반영.
// "표시 설정"은 현재 매물시세 모듈 기준이며, 추후 모듈별 설정으로 확장 예정.

export type ThemeMode = 'dark' | 'light';
export type FontFamilyKey = 'pretendard' | 'system' | 'serif' | 'mono';
export type ResultDensity = 'compact' | 'comfortable';

export interface AppSettings {
  themeMode: ThemeMode;
  // 테마별로 강조색을 따로 보관 (요구사항: 각 테마별 색상 자유 설정)
  accent: Record<ThemeMode, string>; // hex
  fontFamily: FontFamilyKey;
  uiScale: number;        // 0.85 ~ 1.3 (화면 배율)
  resultDensity: ResultDensity;
}

export const ACCENT_PRESETS: { label: string; color: string }[] = [
  { label: '네온 블루', color: '#4f8dff' },
  { label: '민트', color: '#2dd4bf' },
  { label: '퍼플', color: '#8b5cf6' },
  { label: '로즈', color: '#f87fa0' },
  { label: '앰버', color: '#f5b85c' },
  { label: '그린', color: '#34d399' },
];

export const FONT_OPTIONS: { key: FontFamilyKey; label: string; stack: string }[] = [
  {
    key: 'pretendard',
    label: 'Pretendard (기본)',
    stack: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, sans-serif",
  },
  {
    key: 'system',
    label: '시스템 기본',
    stack: "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', 'Malgun Gothic', Roboto, sans-serif",
  },
  {
    key: 'serif',
    label: '명조 (Serif)',
    stack: "'Noto Serif KR', 'Nanum Myeongjo', Georgia, 'Times New Roman', serif",
  },
  {
    key: 'mono',
    label: '고정폭 (Mono)',
    stack: "'JetBrains Mono', Consolas, Monaco, 'D2Coding', monospace",
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'dark',
  accent: { dark: '#4f8dff', light: '#4f8dff' },
  fontFamily: 'pretendard',
  uiScale: 1,
  resultDensity: 'comfortable',
};

// v2: 기본 강조색을 라이트블루(#4f8dff)로 통일, 이전 저장값 자동 리셋
const STORAGE_KEY = 'app_settings_v2';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // 누락 필드는 기본값으로 보강 (스키마 진화 안전)
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      accent: { ...DEFAULT_SETTINGS.accent, ...(parsed.accent ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage 사용 불가 환경 — 무시 (메모리 상태만 유지)
  }
}

// 설정을 CSS 변수/데이터 속성으로 문서에 반영
export function applySettings(settings: AppSettings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.themeMode;
  root.dataset.density = settings.resultDensity;

  const accent = settings.accent[settings.themeMode];
  // 강조색(--blue) + 파생 dim 컬러를 덮어써 액티브/하이라이트 전반에 반영
  root.style.setProperty('--blue', accent);
  root.style.setProperty('--blue-dim', `color-mix(in srgb, ${accent} 16%, transparent)`);

  const font = FONT_OPTIONS.find((f) => f.key === settings.fontFamily) ?? FONT_OPTIONS[0];
  root.style.setProperty('--font', font.stack);
  root.style.setProperty('--ui-scale', String(settings.uiScale));
}
