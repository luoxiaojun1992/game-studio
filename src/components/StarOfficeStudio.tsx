import React, { useEffect, useRef, useState } from 'react';

const STAR_OFFICE_UI_URL = import.meta.env.VITE_STAR_OFFICE_UI_URL || 'http://127.0.0.1:19000';
const LOAD_TIMEOUT_MS = 10000;

function isTrustedSameOriginUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin === window.location.origin) return true;
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

export default function StarOfficeStudio() {
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const allowSameOrigin = isTrustedSameOriginUrl(STAR_OFFICE_UI_URL);
  const sandboxValue = allowSameOrigin
    ? 'allow-scripts allow-same-origin allow-forms allow-popups'
    : 'allow-scripts allow-forms allow-popups';
  const isInsecureRemoteHttp = (() => {
    try {
      const parsed = new URL(STAR_OFFICE_UI_URL, window.location.origin);
      const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.hostname.endsWith('.localhost');
      return parsed.protocol === 'http:' && !isLocal;
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    setLoadFailed(false);
    setLoaded(false);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setLoadFailed(true);
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [STAR_OFFICE_UI_URL]);

  useEffect(() => {
    if (loaded && timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setLoadFailed(false);
    }
  }, [loaded]);

  return (
    <section className="space-y-3">
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-blue-300 tracking-wider uppercase">Star-Office-UI</p>
            <h3 className="text-sm md:text-base text-white font-semibold">Studio（Real Integration）</h3>
          </div>
          <a
            href={STAR_OFFICE_UI_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] md:text-xs text-blue-400 hover:text-blue-300"
          >
            打开独立页面 ↗
          </a>
        </div>
      </div>
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {isInsecureRemoteHttp && (
          <div className="px-4 py-2 text-xs text-yellow-300 bg-yellow-950/30 border-b border-yellow-900/60">
            检测到非本地 HTTP 地址，生产环境建议使用 HTTPS：{STAR_OFFICE_UI_URL}
          </div>
        )}
        {!loaded && !loadFailed && (
          <div className="absolute pointer-events-none text-xs text-gray-400 px-4 py-2">
            正在加载 Star-Office-UI...
          </div>
        )}
        {loadFailed ? (
          <div className="h-[76vh] min-h-[560px] flex items-center justify-center text-gray-300 text-sm px-6 text-center">
            Star-Office-UI 加载失败，请确认服务已启动并检查地址：{STAR_OFFICE_UI_URL}
          </div>
        ) : (
          <iframe
            title="Star-Office-UI"
            src={STAR_OFFICE_UI_URL}
            className="w-full h-[76vh] min-h-[560px] bg-black"
            referrerPolicy="no-referrer"
            sandbox={sandboxValue}
            onLoad={() => {
              setLoaded(true);
              setLoadFailed(false);
            }}
          />
        )}
      </div>
    </section>
  );
}
