import React from 'react';
import { Game } from '../types';

interface Props {
  games: Game[];
  selectedId?: string;
  onSelect: (game: Game) => void;
}

export default function GameList({ games, selectedId, onSelect }: Props) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="font-semibold text-gray-200 text-sm">游戏成品</h3>
        <span className="text-xs text-gray-500">{games.length} 个</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {games.map(game => (
          <div
            key={game.id}
            onClick={() => onSelect(game)}
            className={`rounded-lg p-3 cursor-pointer transition-all border ${
              game.id === selectedId
                ? 'bg-purple-900/30 border-purple-600/50'
                : 'bg-gray-800/50 border-transparent hover:bg-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">v{game.version}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded border ${
                game.status === 'published'
                  ? 'bg-green-500/20 text-green-300 border-green-600/40'
                  : 'bg-gray-600/20 text-gray-400 border-gray-600/40'
              }`}>
                {game.status === 'published' ? '已发布' : '草稿'}
              </span>
            </div>
            <p className="text-sm text-gray-200 font-medium">{game.name}</p>
            <p className="text-[11px] text-gray-500 mt-1">项目：{game.project_id}</p>
            {game.description && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{game.description}</p>
            )}
            <p className="text-xs text-gray-600 mt-1.5">
              {new Date(game.created_at).toLocaleDateString('zh-CN')}
            </p>
          </div>
        ))}

        {games.length === 0 && (
          <div className="text-center text-gray-600 text-sm py-8">
            <div className="text-3xl mb-2">🎮</div>
            暂无游戏成品
          </div>
        )}
      </div>
    </div>
  );
}
