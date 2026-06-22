import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zh from './locales/zh';
import en from './locales/en';

export const SUPPORTED_LANGS = ['zh', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    fallbackLng: 'zh',
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    nonExplicitSupportedLngs: true, // en-US → en
    interpolation: { escapeValue: false },
    detection: {
      // 优先读用户在应用内的显式选择，其次浏览器语言
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'wb_lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
