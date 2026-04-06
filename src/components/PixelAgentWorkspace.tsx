import React, { useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Agent, AgentRole, AgentStatus, Handoff } from '../types';

interface Props {
  agents: Agent[];
  handoffs: Handoff[];
}

const MAX_TASK_DISPLAY_LENGTH = 20;
const PROGRESS_WIDTH_BY_STATUS: Record<AgentStatus, string> = {
  working: '66%',
  error: '25%',
  idle: '40%',
  paused: '40%',
};

const WORK_LABEL: Record<AgentStatus, string> = {
  idle: 'IDLE',
  working: 'WRITING',
  paused: 'PAUSE',
  error: 'ERROR',
};
const ROLE_LABEL = 'ROLE';
const MAX_ROLE_BADGE_LENGTH = 4;
const ROLE_COLOR: Record<AgentRole, string> = {
  engineer: '#3B82F6',
  architect: '#10B981',
  game_designer: '#A855F7',
  biz_designer: '#F97316',
  ceo: '#FACC15',
};

const ROLE_SHORT_NAME: Record<string, string> = {
  engineer: 'ENG',
  architect: 'ARCH',
  game_designer: 'GAME',
  biz_designer: 'BIZ',
  ceo: 'CEO',
};
const KNOWN_ROLE_IDS = new Set(['engineer', 'architect', 'game_designer', 'biz_designer', 'ceo']);

function getRoleBadgeFromAgentId(agentId: string): string {
  const normalizedId = agentId.toLowerCase();
  if (ROLE_SHORT_NAME[normalizedId]) return ROLE_SHORT_NAME[normalizedId];
  const compact = normalizedId.split('_').filter(Boolean).map(part => part[0]).join('');
  if (compact) return compact.slice(0, MAX_ROLE_BADGE_LENGTH).toUpperCase();
  return normalizedId.slice(0, MAX_ROLE_BADGE_LENGTH).toUpperCase();
}

function truncateTask(task: string | null | undefined, maxLength: number): string {
  if (!task) return 'WAITING';
  return `${task.slice(0, maxLength)}${task.length > maxLength ? '...' : ''}`;
}

function getRoleId(agentId: string): AgentRole {
  const normalized = agentId.toLowerCase() as AgentRole;
  if (KNOWN_ROLE_IDS.has(normalized)) {
    return normalized;
  }
  return 'engineer';
}

function getStatusColor(status: AgentStatus): string {
  if (status === 'working') return '#22C55E';
  if (status === 'error') return '#EF4444';
  if (status === 'paused') return '#F59E0B';
  return '#6B7280';
}

function SceneFloor({ lowDetail }: { lowDetail: boolean }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow={!lowDetail}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#0B1227" metalness={0.2} roughness={0.8} />
      </mesh>
      <gridHelper args={[24, 24, '#1E40AF', '#0EA5E9']} position={[0, 0.02, 0]} />
    </group>
  );
}

function SceneProps({ lowDetail }: { lowDetail: boolean }) {
  return (
    <group>
      <mesh position={[0, 2.1, -5.4]} castShadow={!lowDetail} receiveShadow={!lowDetail}>
        <boxGeometry args={[8.4, 2.2, 0.3]} />
        <meshStandardMaterial color="#0F172A" emissive="#1D4ED8" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[-6.4, 1.2, -3.2]} castShadow={!lowDetail} receiveShadow={!lowDetail}>
        <boxGeometry args={[2.1, 2.4, 1.6]} />
        <meshStandardMaterial color="#1E293B" emissive="#7C3AED" emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[6.4, 1.2, -3.2]} castShadow={!lowDetail} receiveShadow={!lowDetail}>
        <boxGeometry args={[2.1, 2.4, 1.6]} />
        <meshStandardMaterial color="#1E293B" emissive="#22C55E" emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0, 0.55, 0]} castShadow={!lowDetail} receiveShadow={!lowDetail}>
        <boxGeometry args={[10.6, 0.3, 5.4]} />
        <meshStandardMaterial color="#111827" metalness={0.45} roughness={0.42} />
      </mesh>
      <mesh position={[0, 1.45, -0.2]} castShadow={!lowDetail}>
        <boxGeometry args={[3.4, 1.4, 0.15]} />
        <meshStandardMaterial color="#082F49" emissive="#38BDF8" emissiveIntensity={0.24} />
      </mesh>
    </group>
  );
}

function AgentUnit({
  agent,
  index,
  total,
  lowDetail,
  shadowsEnabled,
}: {
  agent: Agent;
  index: number;
  total: number;
  lowDetail: boolean;
  shadowsEnabled: boolean;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const status = agent.state?.status || 'idle';
  const role = getRoleId(agent.id);
  const radius = total <= 3 ? 3.6 : 4.4;
  const angle = total === 1 ? Math.PI : Math.PI * (0.75 + (index / Math.max(1, total - 1)) * 0.5);
  const position = useMemo<[number, number, number]>(() => [Math.cos(angle) * radius, 0, Math.sin(angle) * radius], [angle, radius]);
  const emissive = status === 'error' ? '#DC2626' : status === 'working' ? '#22C55E' : status === 'paused' ? '#F59E0B' : '#1E293B';
  const pulse = status === 'working' ? 0.12 : status === 'error' ? 0.08 : 0.03;

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.position.y = 0.06 + Math.sin(t * (status === 'working' ? 4 : 2)) * pulse;
    groupRef.current.rotation.y = -angle + Math.sin(t * 0.8) * 0.06;
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadowsEnabled && !lowDetail}>
        <ringGeometry args={[0.42, 0.55, 24]} />
        <meshBasicMaterial color={status === 'working' ? '#22C55E' : status === 'error' ? '#EF4444' : '#38BDF8'} />
      </mesh>
      <mesh position={[0, 0.78, 0]} castShadow={shadowsEnabled && !lowDetail}>
        <boxGeometry args={[0.52, 0.72, 0.42]} />
        <meshStandardMaterial color={ROLE_COLOR[role]} emissive={emissive} emissiveIntensity={0.26} roughness={0.45} />
      </mesh>
      <mesh position={[0, 1.28, 0]} castShadow={shadowsEnabled && !lowDetail}>
        <sphereGeometry args={[0.24, lowDetail ? 8 : 16, lowDetail ? 8 : 16]} />
        <meshStandardMaterial color="#E5E7EB" roughness={0.65} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.24, 0]} castShadow={shadowsEnabled && !lowDetail}>
        <boxGeometry args={[0.22, 0.24, 0.22]} />
        <meshStandardMaterial color="#0EA5E9" emissive={emissive} emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

function StudioScene({
  agents,
  lowDetail,
  shadowsEnabled,
  controlsEnabled,
}: {
  agents: Agent[];
  lowDetail: boolean;
  shadowsEnabled: boolean;
  controlsEnabled: boolean;
}) {
  return (
    <Canvas
      className="studio3d-canvas"
      shadows={shadowsEnabled && !lowDetail}
      dpr={lowDetail ? [1, 1] : [1, 1.8]}
      camera={{ position: [0, 6.2, 9.4], fov: lowDetail ? 52 : 48 }}
    >
      <color attach="background" args={['#020617']} />
      <fog attach="fog" args={['#020617', 10, 20]} />
      <ambientLight intensity={0.6} />
      <hemisphereLight intensity={0.42} color="#93C5FD" groundColor="#020617" />
      <directionalLight
        position={[8, 10, 6]}
        intensity={1.05}
        castShadow={shadowsEnabled && !lowDetail}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[0, 3.2, -2]} color="#38BDF8" intensity={1.3} />
      <SceneFloor lowDetail={lowDetail} />
      <SceneProps lowDetail={lowDetail} />
      {agents.map((agent, index) => (
        <AgentUnit
          key={agent.id}
          agent={agent}
          index={index}
          total={Math.max(agents.length, 1)}
          lowDetail={lowDetail}
          shadowsEnabled={shadowsEnabled}
        />
      ))}
      {controlsEnabled && (
        <OrbitControls
          enablePan={false}
          enableZoom={!lowDetail}
          minDistance={6.5}
          maxDistance={13}
          maxPolarAngle={Math.PI / 2.1}
          minPolarAngle={Math.PI / 4}
          target={[0, 0.9, 0]}
        />
      )}
    </Canvas>
  );
}

export default function PixelAgentWorkspace({ agents, handoffs }: Props) {
  const activeHandoffs = handoffs.filter(h => ['pending', 'accepted', 'working'].includes(h.status));
  const [shadowsEnabled, setShadowsEnabled] = useState(true);
  const [controlsEnabled, setControlsEnabled] = useState(true);
  const [lowDetail, setLowDetail] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 900px)');
    const applyMode = () => {
      setLowDetail(mediaQuery.matches);
      if (mediaQuery.matches) {
        setControlsEnabled(false);
        setShadowsEnabled(false);
      }
    };
    applyMode();
    mediaQuery.addEventListener('change', applyMode);
    return () => mediaQuery.removeEventListener('change', applyMode);
  }, []);

  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs md:text-sm text-gray-300 tracking-wider">3D Studio</h3>
        <span className="text-[10px] md:text-xs text-gray-500">
          AGENTS: {agents.length} · HANDOFFS: {activeHandoffs.length}
        </span>
      </div>

      <div className="studio3d-room rounded-lg border border-gray-800/80 p-3 md:p-4">
        <div className="studio3d-toolbar">
          <button
            type="button"
            className={`studio3d-toggle ${controlsEnabled ? 'studio3d-toggle-on' : ''}`}
            onClick={() => setControlsEnabled(v => !v)}
            disabled={lowDetail}
          >
            自由视角
          </button>
          <button
            type="button"
            className={`studio3d-toggle ${shadowsEnabled ? 'studio3d-toggle-on' : ''}`}
            onClick={() => setShadowsEnabled(v => !v)}
            disabled={lowDetail}
          >
            阴影
          </button>
          <span className="studio3d-lod-tag">{lowDetail ? 'LOD: 简模' : 'LOD: 标准'}</span>
        </div>
        <div className="studio3d-scene">
          <StudioScene
            agents={agents}
            lowDetail={lowDetail}
            shadowsEnabled={shadowsEnabled}
            controlsEnabled={controlsEnabled}
          />
        </div>
        <div className="studio3d-agents-grid">
          {agents.map(agent => {
            const status = agent.state?.status || 'idle';
            const isWorking = status === 'working';
            const brief = truncateTask(agent.state?.currentTask, MAX_TASK_DISPLAY_LENGTH);
            const role = getRoleId(agent.id);
            return (
              <div
                key={agent.id}
                className={`studio3d-seat studio3d-role-${role} ${isWorking ? 'studio3d-working' : ''}`}
              >
                <div className="studio3d-seat-panel">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[10px] text-gray-200 truncate">{agent.name}</div>
                    <div className="text-[9px] text-gray-500">
                      {WORK_LABEL[agent.state?.status || 'idle']}
                    </div>
                  </div>
                  <div className="text-[9px] text-blue-200/90 uppercase tracking-wide mb-1">{ROLE_LABEL} {getRoleBadgeFromAgentId(agent.id)}</div>
                  <div className="text-[9px] text-gray-400 truncate">{brief}</div>
                  <div className="mt-2 h-1.5 bg-gray-800 border border-gray-700">
                    <div
                      className={`h-full ${isWorking ? 'pixel-progress' : ''}`}
                      style={{ width: PROGRESS_WIDTH_BY_STATUS[status], backgroundColor: getStatusColor(status) }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
