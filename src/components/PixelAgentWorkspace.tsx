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

function createCanvasTexture(
  painter: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat: [number, number] = [1, 1]
) {
  if (typeof document === 'undefined') return undefined;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  painter(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function SceneFloor({ lowDetail }: { lowDetail: boolean }) {
  const floorTexture = useMemo(
    () =>
      createCanvasTexture((ctx, size) => {
        ctx.fillStyle = '#0A1022';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i <= size; i += 16) {
          ctx.strokeStyle = i % 64 === 0 ? 'rgba(56,189,248,0.28)' : 'rgba(56,189,248,0.12)';
          ctx.lineWidth = i % 64 === 0 ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, size);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(size, i);
          ctx.stroke();
        }
      }, [8, 8]),
    []
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow={!lowDetail}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#0B1227" metalness={0.22} roughness={0.78} map={floorTexture} />
      </mesh>
      <gridHelper args={[24, 24, '#1E40AF', '#0EA5E9']} position={[0, 0.03, 0]} />
    </group>
  );
}

function SceneProps({ lowDetail }: { lowDetail: boolean }) {
  const wallTexture = useMemo(
    () =>
      createCanvasTexture((ctx, size) => {
        ctx.fillStyle = '#101b33';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 20; i++) {
          const x = ((i * 37) % 21) / 20 * size;
          const y = ((i * 19 + 7) % 21) / 20 * size;
          const w = 30 + ((i * 13) % 9) * 10;
          const h = 6 + ((i * 7) % 5) * 4;
          const alpha = 0.05 + (((i * 11) % 9) / 8) * 0.15;
          ctx.fillStyle = `rgba(56,189,248,${alpha.toFixed(3)})`;
          ctx.fillRect(x, y, w, h);
        }
      }, [2, 1]),
    []
  );
  const deskTexture = useMemo(
    () =>
      createCanvasTexture((ctx, size) => {
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i <= size; i += 8) {
          ctx.strokeStyle = 'rgba(148,163,184,0.08)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(size, i);
          ctx.stroke();
        }
      }, [3, 2]),
    []
  );
  return (
    <group>
      <mesh position={[0, 2.1, -5.4]} castShadow={!lowDetail} receiveShadow={!lowDetail}>
        <boxGeometry args={[8.4, 2.2, 0.3]} />
        <meshStandardMaterial color="#0F172A" emissive="#1D4ED8" emissiveIntensity={0.24} map={wallTexture} />
      </mesh>
      <mesh position={[-6.4, 1.2, -3.2]} castShadow={!lowDetail} receiveShadow={!lowDetail}>
        <boxGeometry args={[2.1, 2.4, 1.6]} />
        <meshStandardMaterial color="#1E293B" emissive="#7C3AED" emissiveIntensity={0.16} map={wallTexture} />
      </mesh>
      <mesh position={[6.4, 1.2, -3.2]} castShadow={!lowDetail} receiveShadow={!lowDetail}>
        <boxGeometry args={[2.1, 2.4, 1.6]} />
        <meshStandardMaterial color="#1E293B" emissive="#22C55E" emissiveIntensity={0.16} map={wallTexture} />
      </mesh>
      <mesh position={[0, 0.55, 0]} castShadow={!lowDetail} receiveShadow={!lowDetail}>
        <boxGeometry args={[10.6, 0.3, 5.4]} />
        <meshStandardMaterial color="#111827" metalness={0.45} roughness={0.42} map={deskTexture} />
      </mesh>
      <mesh position={[0, 1.45, -0.2]} castShadow={!lowDetail}>
        <boxGeometry args={[3.4, 1.4, 0.15]} />
        <meshStandardMaterial color="#082F49" emissive="#38BDF8" emissiveIntensity={0.24} map={wallTexture} />
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
  const statusColor = getStatusColor(status);
  const radius = total <= 3 ? 3.6 : 4.4;
  const angle = total === 1 ? Math.PI : Math.PI * (0.75 + (index / Math.max(1, total - 1)) * 0.5);
  const position = useMemo<[number, number, number]>(() => [Math.cos(angle) * radius, 0, Math.sin(angle) * radius], [angle, radius]);
  const emissive = status === 'error' ? '#DC2626' : status === 'working' ? '#22C55E' : status === 'paused' ? '#F59E0B' : '#1E293B';
  const pulse = status === 'working' ? 0.12 : status === 'error' ? 0.08 : 0.03;
  const bodyTexture = useMemo(
    () =>
      createCanvasTexture((ctx, size) => {
        ctx.fillStyle = ROLE_COLOR[role];
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        for (let i = -size; i < size * 2; i += 24) {
          ctx.fillRect(i, 0, 10, size);
        }
      }, [2, 2]),
    [role]
  );
  const headTexture = useMemo(
    () =>
      createCanvasTexture((ctx, size) => {
        ctx.fillStyle = '#E5E7EB';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#111827';
        ctx.beginPath();
        ctx.arc(size * 0.35, size * 0.42, size * 0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(size * 0.65, size * 0.42, size * 0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#1F2937';
        ctx.beginPath();
        ctx.arc(size * 0.5, size * 0.58, size * 0.12, 0.2, Math.PI - 0.2);
        ctx.stroke();
      }, [1, 1]),
    []
  );

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.position.y = 0.06 + Math.sin(t * (status === 'working' ? 4 : 2)) * pulse;
    groupRef.current.rotation.y = -angle + Math.sin(t * 0.8) * 0.06;
    if (status === 'working') {
      groupRef.current.rotation.x = Math.sin(t * 3.2) * 0.02;
    } else {
      groupRef.current.rotation.x = 0;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadowsEnabled && !lowDetail}>
        <ringGeometry args={[0.42, 0.55, 24]} />
        <meshBasicMaterial color={statusColor} />
      </mesh>
      <group position={[0, 0.12, 0.16]}>
        <mesh position={[0, 0.26, -0.22]} castShadow={shadowsEnabled && !lowDetail} receiveShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.42, 0.5, 0.38]} />
          <meshStandardMaterial color="#1F2937" metalness={0.15} roughness={0.65} />
        </mesh>
        <mesh position={[0, 0.53, -0.34]} castShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.46, 0.2, 0.1]} />
          <meshStandardMaterial color="#334155" metalness={0.2} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.08, -0.22]} castShadow={shadowsEnabled && !lowDetail}>
          <cylinderGeometry args={[0.04, 0.05, 0.28, lowDetail ? 6 : 10]} />
          <meshStandardMaterial color="#64748B" metalness={0.5} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.08, -0.22]} rotation={[0, 0, 0]} receiveShadow={shadowsEnabled && !lowDetail}>
          <cylinderGeometry args={[0.22, 0.26, 0.06, lowDetail ? 8 : 14]} />
          <meshStandardMaterial color="#0F172A" metalness={0.35} roughness={0.5} />
        </mesh>
      </group>
      <group position={[0, 0.16, 0]}>
        <mesh position={[0, 0.85, 0.05]} castShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.42, 0.56, 0.24]} />
          <meshStandardMaterial color={ROLE_COLOR[role]} emissive={emissive} emissiveIntensity={0.26} roughness={0.45} map={bodyTexture} />
        </mesh>
        <mesh position={[0, 1.25, 0.08]} castShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.34, 0.3, 0.28]} />
          <meshStandardMaterial color={ROLE_COLOR[role]} emissive={emissive} emissiveIntensity={0.18} roughness={0.48} map={bodyTexture} />
        </mesh>
        <mesh position={[0, 1.52, 0.1]} castShadow={shadowsEnabled && !lowDetail}>
          <sphereGeometry args={[0.2, lowDetail ? 8 : 14, lowDetail ? 8 : 14]} />
          <meshStandardMaterial color="#E5E7EB" roughness={0.65} metalness={0.08} map={headTexture} />
        </mesh>
        <mesh position={[-0.3, 1.18, 0.04]} rotation={[0, 0, Math.PI / 8]} castShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.12, 0.38, 0.12]} />
          <meshStandardMaterial color={ROLE_COLOR[role]} emissive={emissive} emissiveIntensity={0.18} roughness={0.5} />
        </mesh>
        <mesh position={[0.3, 1.13, 0.08]} rotation={[0, 0, -Math.PI / 4.8]} castShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.12, 0.42, 0.12]} />
          <meshStandardMaterial color={ROLE_COLOR[role]} emissive={emissive} emissiveIntensity={0.22} roughness={0.5} />
        </mesh>
        <mesh position={[0.36, 0.95, 0.15]} rotation={[-Math.PI / 2.5, 0, 0]} castShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.2, 0.02, 0.14]} />
          <meshStandardMaterial color="#0EA5E9" emissive="#38BDF8" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[-0.12, 0.5, 0.06]} castShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.13, 0.42, 0.13]} />
          <meshStandardMaterial color="#0F172A" roughness={0.65} />
        </mesh>
        <mesh position={[0.12, 0.5, 0.06]} castShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.13, 0.42, 0.13]} />
          <meshStandardMaterial color="#0F172A" roughness={0.65} />
        </mesh>
        <mesh position={[-0.12, 0.25, 0.13]} castShadow={shadowsEnabled && !lowDetail} receiveShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.16, 0.08, 0.28]} />
          <meshStandardMaterial color="#1E293B" roughness={0.7} />
        </mesh>
        <mesh position={[0.12, 0.25, 0.13]} castShadow={shadowsEnabled && !lowDetail} receiveShadow={shadowsEnabled && !lowDetail}>
          <boxGeometry args={[0.16, 0.08, 0.28]} />
          <meshStandardMaterial color="#1E293B" roughness={0.7} />
        </mesh>
      </group>
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
      style={{ width: '100%', height: '100%' }}
      shadows={shadowsEnabled && !lowDetail}
      dpr={lowDetail ? [1, 1] : [1, 1.8]}
      camera={{ position: [0, 4.8, 8], fov: lowDetail ? 54 : 46 }}
    >
      <color attach="background" args={['#020617']} />
      <fog attach="fog" args={['#020617', 8, 18]} />
      <ambientLight intensity={0.6} />
      <hemisphereLight intensity={0.42} color="#93C5FD" groundColor="#020617" />
      <directionalLight
        position={[7, 9, 5]}
        intensity={1.12}
        castShadow={shadowsEnabled && !lowDetail}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[0, 3.2, -2]} color="#38BDF8" intensity={1.45} />
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
          minDistance={5.8}
          maxDistance={11.8}
          maxPolarAngle={Math.PI / 2.1}
          minPolarAngle={Math.PI / 4}
          target={[0, 1.05, 0]}
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
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
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
