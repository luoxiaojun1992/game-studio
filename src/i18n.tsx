import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type UILanguage = 'zh-CN' | 'en-US';

const LANGUAGE_STORAGE_KEY = 'game_studio_ui_language';

function detectBrowserLanguage(): UILanguage {
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : undefined;
  if (typeof browserLanguage === 'string' && browserLanguage.toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

interface I18nContextValue {
  language: UILanguage;
  locale: string;
  isZh: boolean;
  setLanguage: (language: UILanguage) => void;
  l: (zh: string, en: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<UILanguage>(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as UILanguage | null;
      if (saved === 'zh-CN' || saved === 'en-US') return saved;
    } catch {}
    return detectBrowserLanguage();
  });

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {}
    document.documentElement.lang = language.startsWith('zh') ? 'zh' : 'en';
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const isZh = language === 'zh-CN';
    return {
      language,
      locale: language,
      isZh,
      setLanguage: setLanguageState,
      l: (zh: string, en: string) => (isZh ? zh : en),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
