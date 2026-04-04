import React from 'react';
import { AgentRole, AgentStatus } from '../types';

interface Props {
  agentId: AgentRole;
  status: AgentStatus;
  size?: number;
  className?: string;
}

const AVATAR_GRID_SIZE = 12;
const MIN_PIXEL_SIZE = 2;
const BADGE_START_ROW = 1;

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: '#6B7280',
  working: '#22C55E',
  paused: '#F59E0B',
  error: '#EF4444',
};

const ROLE_COLORS: Record<AgentRole, { primary: string; accent: string }> = {
  engineer: { primary: '#2563EB', accent: '#1D4ED8' },
  architect: { primary: '#10B981', accent: '#059669' },
  game_designer: { primary: '#9333EA', accent: '#7E22CE' },
  biz_designer: { primary: '#EA580C', accent: '#C2410C' },
  ceo: { primary: '#DC2626', accent: '#B91C1C' },
};

const PIXELS = [
  '............',
  '...hhhhhh...',
  '..hheeeehh..',
  '..hhsssshh..',
  '..hhsssshh..',
  '...ssssss...',
  '...pppppp...',
  '..pppppppp..',
  '..ppaappaap.',
  '..pppppppp..',
  '...pp..pp...',
  '...pp..pp...',
];

const ROLE_BADGE: Record<AgentRole, string[]> = {
  engineer: ['..11......11', '.1111....111', '..11......11'],
  architect: ['....22......', '...2222.....', '....22......'],
  game_designer: ['...3..3.....', '..333333....', '...3..3.....'],
  biz_designer: ['....44......', '..444444....', '....44......'],
  ceo: ['....55......', '...5555.....', '....55......'],
};

export default function PixelAgentAvatar({ agentId, status, size = 32, className }: Props) {
  const colors = ROLE_COLORS[agentId];
  const pixelSize = Math.max(MIN_PIXEL_SIZE, Math.floor(size / AVATAR_GRID_SIZE));
  const badge = ROLE_BADGE[agentId];
  const matrix = [...PIXELS];
  matrix[BADGE_START_ROW] = badge[0];
  matrix[BADGE_START_ROW + 1] = badge[1];
  matrix[BADGE_START_ROW + 2] = badge[2];

  const colorByChar: Record<string, string> = {
    h: '#111827',
    e: '#F9FAFB',
    s: '#F5C9A8',
    p: colors.primary,
    a: colors.accent,
    1: '#93C5FD',
    2: '#6EE7B7',
    3: '#C4B5FD',
    4: '#FDBA74',
    5: '#FCA5A5',
  };

  const avatarSize = pixelSize * AVATAR_GRID_SIZE;

  return (
    <div className={`relative inline-flex ${className || ''}`} style={{ width: avatarSize, height: avatarSize }}>
      <svg width={avatarSize} height={avatarSize} viewBox={`0 0 ${AVATAR_GRID_SIZE} ${AVATAR_GRID_SIZE}`} style={{ imageRendering: 'pixelated' }}>
        {matrix.map((row, y) =>
          row.split('').map((char, x) => {
            if (char === '.') return null;
            return <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={colorByChar[char]} />;
          }),
        )}
      </svg>
      <span
        className={`absolute -right-1 -bottom-1 w-2.5 h-2.5 border border-gray-900 ${status === 'working' ? 'pixel-work-pulse' : ''}`}
        style={{ backgroundColor: STATUS_COLOR[status] }}
      />
    </div>
  );
}
