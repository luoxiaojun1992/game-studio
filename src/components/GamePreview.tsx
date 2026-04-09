import React, { useState, useEffect } from 'react';
import { Game } from '../types';
import { api } from '../config';
import { useI18n } from '../i18n';

interface Props {
  game: Game;
  onClose: () => void;
}

const AGENT_NAMES_ZH: Record<string, string> = {
  engineer: '软件工程师',
  architect: '架构师',
  game_designer: '游戏策划',
  biz_designer: '商业策划',
  ceo: 'CEO',
};

const AGENT_NAMES_EN: Record<string, string> = {
  engineer: 'Engineer',
  architect: 'Architect',
  game_designer: 'Game Designer',
  biz_designer: 'Business Designer',
  ceo: 'CEO',
};

export default function GamePreview({ game, onClose }: Props) {
  const { l, isZh } = useI18n();
  const [fullGame, setFullGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getGame(game.id).then(data => {
      setFullGame(data.game);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [game.id]);

  const previewUrl = api.getGamePreviewUrl(game.id);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col h-full">
      {/* comment */}
      <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎮</span>
          <div>
            <h2 className="font-bold text-white text-base">{game.name}</h2>
            <div className="text-xs text-gray-500">v{game.version} · {(isZh ? AGENT_NAMES_ZH : AGENT_NAMES_EN)[game.author_agent_id] || game.author_agent_id}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/40 text-blue-300 rounded-lg px-3 py-1.5 transition-all"
          >
            {l('🔗 新窗口打开', '🔗 Open in New Window')}
          </a>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xl">✕</button>
        </div>
      </div>

      {/* comment */}
      {game.description && (
        <div className="px-5 py-2 bg-gray-800/50 border-b border-gray-800 shrink-0">
          <p className="text-sm text-gray-400">{game.description}</p>
        </div>
      )}

      {/* comment */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="text-3xl mb-2 animate-spin">⚙️</div>
              <p className="text-sm">{l('加载游戏...', 'Loading game...')}</p>
            </div>
          </div>
        ) : (
          <iframe
            src={previewUrl}
            className="w-full h-full border-0 rounded-b-xl"
            title={game.name}
            sandbox="allow-scripts allow-same-origin"
          />
        )}
      </div>

      {/* comment */}
      {fullGame?.html_content && (
        <details className="border-t border-gray-800 shrink-0">
          <summary className="px-5 py-2 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors">
            {l('查看游戏源码', 'View Game Source')}
          </summary>
          <pre className="px-5 py-3 text-xs text-gray-400 font-mono overflow-x-auto max-h-48 bg-gray-950">
            {fullGame.html_content.slice(0, 5000)}
            {fullGame.html_content.length > 5000 && l('\n\n... (代码过长，已截断)', '\n\n... (code too long, truncated)')}
          </pre>
        </details>
      )}
    </div>
  );
}
