import React, { useEffect } from 'react';
import StudioPage from './pages/StudioPage';
import { useI18n } from './i18n';
import './index.css';

export default function App() {
  const { l } = useI18n();

  useEffect(() => {
    document.title = l('🎮 Game Dev Studio - Agent 团队观测中心', '🎮 Game Dev Studio - Agent Team Console');
  }, [l]);

  return <StudioPage />;
}
