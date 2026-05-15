import React, { useState, useEffect } from 'react';
import { Game } from '../types';
import { api } from '../config';
import { useI18n } from '../i18n';

interface Props {
  game: Game;
  onClose: () => void;
}

export default function GamePreview({ game, onClose }: Props) {
  const { l, isZh } = useI18n();
  const [downloading, setDownloading] = useState(false);

  const handleDownloadFile = async () => {
    if (!game.fileStorageId || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/file-storage/${game.fileStorageId}/download`);
      if (res.ok) {
        const data = await res.json() as { downloadUrl: string };
        window.open(data.downloadUrl, '_blank');
      } else {
        alert(l('获取下载链接失败', 'Failed to get download URL'));
      }
    } catch {
      alert(l('获取下载链接失败', 'Failed to get download URL'));
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadSonarReport = async () => {
    if (!game.sonarStorageId || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/file-storage/${game.sonarStorageId}/download`);
      if (res.ok) {
        const data = await res.json() as { downloadUrl: string };
        window.open(data.downloadUrl, '_blank');
      } else {
        alert(l('获取下载链接失败', 'Failed to get download URL'));
      }
    } catch {
      alert(l('获取下载链接失败', 'Failed to get download URL'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col h-full">
      <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎮</span>
          <div>
            <h2 className="font-bold text-white text-base">{game.name}</h2>
            <div className="text-xs text-gray-500">v{game.version}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {game.fileStorageId && (
            <button
              onClick={handleDownloadFile}
              disabled={downloading}
              className="text-xs bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/40 text-blue-300 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50"
            >
              {downloading ? l('下载中...', 'Downloading...') : l('📦 下载文件', '📦 Download File')}
            </button>
          )}
          {game.sonarStorageId && (
            <button
              onClick={handleDownloadSonarReport}
              disabled={downloading}
              className="text-xs bg-green-600/20 hover:bg-green-600/40 border border-green-600/40 text-green-300 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50"
            >
              {downloading ? l('下载中...', 'Downloading...') : l('📊 下载 Sonar 报告', '📊 Download Sonar Report')}
            </button>
          )}
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xl">✕</button>
        </div>
      </div>

      {/* 游戏简介 */}
      <div className="flex-1 overflow-y-auto p-5">
        {game.description ? (
          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
            {game.description}
          </div>
        ) : (
          <div className="text-center text-gray-500 text-sm py-8">
            {l('暂无游戏简介', 'No description available')}
          </div>
        )}
      </div>
    </div>
  );
}
