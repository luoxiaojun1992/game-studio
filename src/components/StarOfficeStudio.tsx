import React from 'react';

const STAR_OFFICE_UI_URL = import.meta.env.VITE_STAR_OFFICE_UI_URL || 'http://127.0.0.1:19000';

export default function StarOfficeStudio() {
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
        <iframe
          title="Star-Office-UI"
          src={STAR_OFFICE_UI_URL}
          className="w-full h-[76vh] min-h-[560px] bg-black"
          referrerPolicy="no-referrer"
        />
      </div>
    </section>
  );
}
