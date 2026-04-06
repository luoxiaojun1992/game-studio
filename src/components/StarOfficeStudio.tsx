import React from 'react';
import { Agent, Handoff } from '../types';
import PixelAgentWorkspace from './PixelAgentWorkspace';

interface Props {
  agents: Agent[];
  handoffs: Handoff[];
}

export default function StarOfficeStudio({ agents, handoffs }: Props) {
  return (
    <section className="space-y-3">
      <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-blue-300 tracking-wider uppercase">Star-Office-UI</p>
            <h3 className="text-sm md:text-base text-white font-semibold">Studio</h3>
          </div>
          <span className="text-[10px] md:text-xs text-gray-500">
            AGENTS: {agents.length} · HANDOFFS: {handoffs.filter(h => ['pending', 'accepted', 'working'].includes(h.status)).length}
          </span>
        </div>
      </div>
      <PixelAgentWorkspace agents={agents} handoffs={handoffs} />
    </section>
  );
}
