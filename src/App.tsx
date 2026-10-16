import React, { useState, useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import {
  Thermometer,
  Fan,
  Bell,
  DoorOpen,
  DoorClosed,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  RotateCcw,
  Play,
  Pause,
  Code,
  Settings,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Activity,
  Eye,
  Sliders,
  Terminal,
  Copy,
  Check,
  Zap,
  Snowflake,
  Maximize2,
  Camera,
  Send,
  Radio,
  Layers
} from 'lucide-react';

// ============================================================================
// 1. TYPES & IOT CONTROL LOGIC
// ============================================================================

export interface TelemetryPoint {
  time: string;
  temperature: number;
  humidity: number;
  coolingNum: number;
  buzzerNum: number;
  zone: 'FREEZE_STOP' | 'OPTIMAL_COOL' | 'HIGH_TEMP_ALARM';
}

export interface MqttLogMessage {
  id: string;
  time: string;
  dir: 'RX' | 'TX' | 'SYS';
  topic: string;
  payload: string;
}

export type CameraPreset = 'overview' | 'display' | 'interior' | 'angled';

/**
 * CORE IoT CONTROL LOGIC (Strictly follows project specification):
 * - T <= 0°C       -> Cooling: OFF | Buzzer: OFF
 * - 0°C < T <= 7°C -> Cooling: ON  | Buzzer: OFF
 * - T > 7°C        -> Cooling: ON  | Buzzer: ON  (HIGH TEMPERATURE – COOLING INEFFECTIVE)
 */
export function computeIoTState(temp: number): {
  cooling: boolean;
  buzzer: boolean;
  zone: 'FREEZE_STOP' | 'OPTIMAL_COOL' | 'HIGH_TEMP_ALARM';
  statusLabel: string;
} {
  const t = Number(temp.toFixed(2));
  if (t <= 0) {
    return {
      cooling: false,
      buzzer: false,
      zone: 'FREEZE_STOP',
      statusLabel: 'TARGET REACHED (T ≤ 0°C) – COOLING STANDBY'
    };
  } else if (t <= 7) {
    return {
      cooling: true,
      buzzer: false,
      zone: 'OPTIMAL_COOL',
      statusLabel: 'NORMAL COOLING ACTIVE (0°C < T ≤ 7°C)'
    };
  } else {
    // T > 7°C: Cooling MUST remain ON while Buzzer turns ON
    return {
      cooling: true,
      buzzer: true,
      zone: 'HIGH_TEMP_ALARM',
      statusLabel: 'HIGH TEMPERATURE – COOLING INEFFECTIVE'
    };
  }
}

// ============================================================================
// 2. ZUSTAND STATE STORE
// ============================================================================

interface SmartFridgeStore {
  temperature: number;
  humidity: number;
  ambientTemp: number;
  doorLeftOpen: boolean;
  doorRightOpen: boolean;
  doorOpenSeconds: number;
  doorTimeoutAlarm: boolean;
  cooling: boolean;
  buzzer: boolean;
  zone: 'FREEZE_STOP' | 'OPTIMAL_COOL' | 'HIGH_TEMP_ALARM';
  statusLabel: string;
  audioAllowed: boolean;
  autoPhysics: boolean;
  faultSimulation: boolean;
  cameraPreset: CameraPreset;
  focusTrigger: number;
  mqttStatus: 'SIMULATED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  mqttBrokerUrl: string;
  mqttTopicSub: string;
  mqttTopicPub: string;
  mqttClientId: string;
  history: TelemetryPoint[];
  mqttLogs: MqttLogMessage[];
  setTemperature: (temp: number) => void;
  setHumidity: (hum: number) => void;
  toggleLeftDoor: () => void;
  toggleRightDoor: () => void;
  setDoors: (left: boolean, right: boolean) => void;
  tickDoorTimer: () => void;
  triggerDoorTimeoutTest: () => void;
  setAudioAllowed: (allowed: boolean) => void;
  setAutoPhysics: (enabled: boolean) => void;
  setFaultSimulation: (enabled: boolean) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  triggerFocus: () => void;
  setMqttConfig: (brokerUrl: string, topicSub: string, topicPub: string) => void;
  setMqttStatus: (status: 'SIMULATED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR') => void;
  appendHistorySample: (temp?: number, hum?: number) => void;
  addMqttLog: (dir: 'RX' | 'TX' | 'SYS', topic: string, payload: string) => void;
  clearMqttLogs: () => void;
}

const initialTemp = 4.2;
const initialEval = computeIoTState(initialTemp);

const generateInitialHistory = (): TelemetryPoint[] => {
  const now = Date.now();
  const samples: TelemetryPoint[] = [];
  const baseTemps = [3.6, 3.8, 4.0, 4.1, 4.3, 4.5, 4.4, 4.2, 4.0, 3.9, 4.1, 4.2, 4.3, 4.1, 4.2];
  for (let i = 0; i < baseTemps.length; i++) {
    const t = baseTemps[i];
    const st = computeIoTState(t);
    const ts = new Date(now - (baseTemps.length - 1 - i) * 2000);
    samples.push({
      time: ts.toLocaleTimeString('vi-VN', { hour12: false }),
      temperature: t,
      humidity: 62 + (i % 3),
      coolingNum: st.cooling ? 1 : 0,
      buzzerNum: st.buzzer ? 1 : 0,
      zone: st.zone
    });
  }
  return samples;
};

export const useFridgeStore = create<SmartFridgeStore>((set, get) => ({
  temperature: initialTemp,
  humidity: 63,
  ambientTemp: 26.5,
  doorLeftOpen: false,
  doorRightOpen: false,
  doorOpenSeconds: 0,
  doorTimeoutAlarm: false,
  cooling: initialEval.cooling,
  buzzer: initialEval.buzzer,
  zone: initialEval.zone,
  statusLabel: initialEval.statusLabel,
  audioAllowed: false,
  autoPhysics: false,
  faultSimulation: false,
  cameraPreset: 'overview',
  focusTrigger: 0,
  mqttStatus: 'SIMULATED',
  mqttBrokerUrl: 'wss://broker.emqx.io:8084/mqtt',
  mqttTopicSub: 'iot/smartfridge/esp32/telemetry',
  mqttTopicPub: 'iot/smartfridge/esp32/control',
  mqttClientId: `web_sim_${Math.random().toString(16).slice(2, 8)}`,
  history: generateInitialHistory(),
  mqttLogs: [
    {
      id: 'init-1',
      time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      dir: 'SYS',
      topic: 'system/init',
      payload: 'Khởi tạo hệ thống mô phỏng Tủ lạnh Thông minh IoT (Chế độ: ESP32 Simulator Loopback)'
    }
  ],

  setTemperature: (temp: number) => {
    const clamped = Math.max(-8, Math.min(18, Number(temp.toFixed(1))));
    const st = computeIoTState(clamped);
    set((s) => ({
      temperature: clamped,
      cooling: st.cooling,
      buzzer: st.buzzer || s.doorTimeoutAlarm,
      zone: st.zone,
      statusLabel: st.statusLabel
    }));
  },

  setHumidity: (hum: number) => {
    const clamped = Math.max(25, Math.min(95, Math.round(hum)));
    set({ humidity: clamped });
  },

  toggleLeftDoor: () =>
    set((s) => {
      const nextLeft = !s.doorLeftOpen;
      const anyOpen = nextLeft || s.doorRightOpen;
      const tempEval = computeIoTState(s.temperature);
      return {
        doorLeftOpen: nextLeft,
        doorOpenSeconds: anyOpen ? s.doorOpenSeconds : 0,
        doorTimeoutAlarm: anyOpen ? s.doorTimeoutAlarm : false,
        buzzer: tempEval.buzzer || (anyOpen ? s.doorTimeoutAlarm : false)
      };
    }),

  toggleRightDoor: () =>
    set((s) => {
      const nextRight = !s.doorRightOpen;
      const anyOpen = s.doorLeftOpen || nextRight;
      const tempEval = computeIoTState(s.temperature);
      return {
        doorRightOpen: nextRight,
        doorOpenSeconds: anyOpen ? s.doorOpenSeconds : 0,
        doorTimeoutAlarm: anyOpen ? s.doorTimeoutAlarm : false,
        buzzer: tempEval.buzzer || (anyOpen ? s.doorTimeoutAlarm : false)
      };
    }),

  setDoors: (left: boolean, right: boolean) =>
    set((s) => {
      const anyOpen = left || right;
      const tempEval = computeIoTState(s.temperature);
      return {
        doorLeftOpen: left,
        doorRightOpen: right,
        doorOpenSeconds: anyOpen ? s.doorOpenSeconds : 0,
        doorTimeoutAlarm: anyOpen ? s.doorTimeoutAlarm : false,
        buzzer: tempEval.buzzer || (anyOpen ? s.doorTimeoutAlarm : false)
      };
    }),

  tickDoorTimer: () =>
    set((s) => {
      const anyOpen = s.doorLeftOpen || s.doorRightOpen;
      const tempEval = computeIoTState(s.temperature);
      if (!anyOpen) {
        if (s.doorOpenSeconds === 0 && !s.doorTimeoutAlarm) return {};
        return {
          doorOpenSeconds: 0,
          doorTimeoutAlarm: false,
          buzzer: tempEval.buzzer
        };
      }
      const nextSec = s.doorOpenSeconds + 1;
      const isTimeout = nextSec > 15;
      return {
        doorOpenSeconds: nextSec,
        doorTimeoutAlarm: isTimeout,
        buzzer: tempEval.buzzer || isTimeout
      };
    }),

  triggerDoorTimeoutTest: () =>
    set((s) => {
      const tempEval = computeIoTState(s.temperature);
      return {
        doorLeftOpen: true,
        doorOpenSeconds: 16,
        doorTimeoutAlarm: true,
        buzzer: true,
        cooling: tempEval.cooling
      };
    }),

  setAudioAllowed: (audioAllowed: boolean) => set({ audioAllowed }),
  setAutoPhysics: (autoPhysics: boolean) => set({ autoPhysics }),
  setFaultSimulation: (faultSimulation: boolean) =>
    set((s) => ({
      faultSimulation,
      autoPhysics: faultSimulation ? true : s.autoPhysics
    })),

  setCameraPreset: (cameraPreset: CameraPreset) =>
    set((s) => ({
      cameraPreset,
      focusTrigger: s.focusTrigger + 1
    })),

  triggerFocus: () =>
    set((s) => ({
      focusTrigger: s.focusTrigger + 1
    })),

  setMqttConfig: (mqttBrokerUrl, mqttTopicSub, mqttTopicPub) =>
    set({ mqttBrokerUrl, mqttTopicSub, mqttTopicPub }),

  setMqttStatus: (mqttStatus) => set({ mqttStatus }),

  appendHistorySample: (overrideTemp?: number, overrideHum?: number) => {
    const state = get();
    const t = overrideTemp !== undefined ? overrideTemp : state.temperature;
    const h = overrideHum !== undefined ? overrideHum : state.humidity;
    const st = computeIoTState(t);
    const point: TelemetryPoint = {
      time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      temperature: Number(t.toFixed(1)),
      humidity: Math.round(h),
      coolingNum: st.cooling ? 1 : 0,
      buzzerNum: st.buzzer ? 1 : 0,
      zone: st.zone
    };
    set({
      history: [...state.history.slice(-29), point]
    });
  },

  addMqttLog: (dir, topic, payload) =>
    set((s) => ({
      mqttLogs: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
          dir,
          topic,
          payload
        },
        ...s.mqttLogs.slice(0, 34)
      ]
    })),

  clearMqttLogs: () => set({ mqttLogs: [] })
}));

// ============================================================================
// 3. THREE.JS 3D ENVIRONMENT & SMART REFRIGERATOR COMPONENT
// ============================================================================

declare global {
  interface Window {
    THREE?: any;
    mqtt?: any;
  }
}

const ThreeSmartFridgeViewport: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [threeLoaded, setThreeLoaded] = useState<boolean>(Boolean(window.THREE));
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);

  const {
    temperature,
    humidity,
    doorLeftOpen,
    doorRightOpen,
    doorOpenSeconds,
    doorTimeoutAlarm,
    cooling,
    buzzer,
    mqttStatus,
    cameraPreset,
    focusTrigger,
    toggleLeftDoor,
    toggleRightDoor,
    setCameraPreset
  } = useFridgeStore();

  // Keep latest store state in a ref so the Three.js requestAnimationFrame loop reads it without re-creating the scene
  const liveStateRef = useRef({
    temperature,
    humidity,
    doorLeftOpen,
    doorRightOpen,
    doorOpenSeconds,
    doorTimeoutAlarm,
    cooling,
    buzzer,
    mqttStatus,
    cameraPreset,
    focusTrigger
  });

  useEffect(() => {
    liveStateRef.current = {
      temperature,
      humidity,
      doorLeftOpen,
      doorRightOpen,
      doorOpenSeconds,
      doorTimeoutAlarm,
      cooling,
      buzzer,
      mqttStatus,
      cameraPreset,
      focusTrigger
    };
  }, [
    temperature,
    humidity,
    doorLeftOpen,
    doorRightOpen,
    doorOpenSeconds,
    doorTimeoutAlarm,
    cooling,
    buzzer,
    mqttStatus,
    cameraPreset,
    focusTrigger
  ]);

  // Load Three.js r128 dynamically if not already present
  useEffect(() => {
    if (window.THREE) {
      setThreeLoaded(true);
      return;
    }
    const existingScript = document.getElementById('threejs-r128-cdn') as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => setThreeLoaded(true));
      return;
    }
    const script = document.createElement('script');
    script.id = 'threejs-r128-cdn';
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.async = true;
    script.onload = () => setThreeLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Build and run Three.js scene
  useEffect(() => {
    if (!threeLoaded || !window.THREE || !containerRef.current) return;

    const THREE = window.THREE;
    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d13);
    scene.fog = new THREE.FogExp2(0x0b0d13, 0.085);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Industrial Minimalism Kitchen Lighting
    const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.42);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xe2e8f0, 0x1e293b, 0.45);
    hemiLight.position.set(0, 4, 0);
    scene.add(hemiLight);

    const mainSpot = new THREE.SpotLight(0xfffbeb, 1.35);
    mainSpot.position.set(2.2, 3.8, 3.2);
    mainSpot.angle = Math.PI / 3;
    mainSpot.penumbra = 0.65;
    mainSpot.castShadow = true;
    mainSpot.shadow.mapSize.width = 1024;
    mainSpot.shadow.mapSize.height = 1024;
    mainSpot.shadow.bias = -0.0005;
    scene.add(mainSpot);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
    rimLight.position.set(-2.8, 2.4, -1.5);
    scene.add(rimLight);

    // Warm industrial pendant lights on left & right
    const pendantLightLeft = new THREE.PointLight(0xfbbf24, 0.55, 3.5);
    pendantLightLeft.position.set(-1.35, 2.15, 0.4);
    scene.add(pendantLightLeft);

    const pendantLightRight = new THREE.PointLight(0xfbbf24, 0.55, 3.5);
    pendantLightRight.position.set(1.35, 2.15, 0.4);
    scene.add(pendantLightRight);

    // 3. Industrial Minimalism Kitchen Environment
    const envGroup = new THREE.Group();
    scene.add(envGroup);

    // Dark Slate Floor
    const floorGeo = new THREE.PlaneGeometry(14, 14);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x12151e,
      roughness: 0.42,
      metalness: 0.15
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    envGroup.add(floorMesh);

    // Subtle Architectural Grid on Floor
    const gridHelper = new THREE.GridHelper(10, 20, 0x1e293b, 0x161e2e);
    gridHelper.position.y = 0.002;
    envGroup.add(gridHelper);

    // Industrial Concrete Back Wall
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x161922,
      roughness: 0.78,
      metalness: 0.08
    });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(8.5, 3.6, 0.15), wallMat);
    backWall.position.set(0, 1.8, -0.52);
    backWall.receiveShadow = true;
    envGroup.add(backWall);

    // Architectural Vertical Concrete Seam Panels on Back Wall
    const panelSeamMat = new THREE.MeshStandardMaterial({
      color: 0x0f1117,
      roughness: 0.9,
      metalness: 0.1
    });
    [-2.4, -1.2, 0, 1.2, 2.4].forEach((xPos) => {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.015, 3.6, 0.16), panelSeamMat);
      seam.position.set(xPos, 1.8, -0.52);
      envGroup.add(seam);
    });

    // Industrial Minimalist Side Counters (Left & Right of the Fridge)
    const cabinetMat = new THREE.MeshStandardMaterial({
      color: 0x1e222d,
      roughness: 0.5,
      metalness: 0.35
    });
    const countertopMat = new THREE.MeshStandardMaterial({
      color: 0x2d3340,
      roughness: 0.3,
      metalness: 0.25
    });
    const blackSteelMat = new THREE.MeshStandardMaterial({
      color: 0x0f131a,
      roughness: 0.35,
      metalness: 0.8
    });

    // Left Counter Unit
    const leftCabinet = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.88, 0.68), cabinetMat);
    leftCabinet.position.set(-1.28, 0.44, -0.04);
    leftCabinet.castShadow = true;
    leftCabinet.receiveShadow = true;
    envGroup.add(leftCabinet);

    const leftTop = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.045, 0.72), countertopMat);
    leftTop.position.set(-1.28, 0.902, -0.04);
    leftTop.castShadow = true;
    leftTop.receiveShadow = true;
    envGroup.add(leftTop);

    // Right Counter Unit
    const rightCabinet = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.88, 0.68), cabinetMat);
    rightCabinet.position.set(1.28, 0.44, -0.04);
    rightCabinet.castShadow = true;
    rightCabinet.receiveShadow = true;
    envGroup.add(rightCabinet);

    const rightTop = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.045, 0.72), countertopMat);
    rightTop.position.set(1.28, 0.902, -0.04);
    rightTop.castShadow = true;
    rightTop.receiveShadow = true;
    envGroup.add(rightTop);

    // Open Industrial Wall Shelves + Pendant Lamps
    [-1.28, 1.28].forEach((sideX) => {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.28), countertopMat);
      shelf.position.set(sideX, 1.55, -0.3);
      shelf.castShadow = true;
      envGroup.add(shelf);

      // Pendant cord & shade
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 8), blackSteelMat);
      cord.position.set(sideX, 2.65, 0.2);
      envGroup.add(cord);

      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 24, 1, true), blackSteelMat);
      shade.position.set(sideX, 2.18, 0.2);
      envGroup.add(shade);

      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xfef08a })
      );
      bulb.position.set(sideX, 2.12, 0.2);
      envGroup.add(bulb);
    });

    // Minimalist Kitchen Props on Counters (Espresso/Coffee canister set & wooden cutting board)
    const canisterMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.25 });
    [-1.45, -1.25, -1.08].forEach((cx, i) => {
      const h = 0.14 - i * 0.02;
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h, 20), canisterMat);
      can.position.set(cx, 0.925 + h / 2, -0.1);
      can.castShadow = true;
      envGroup.add(can);
    });

    // 4. SMART REFRIGERATOR 2-DOOR 3D MODEL (Centerpiece)
    const fridgeGroup = new THREE.Group();
    scene.add(fridgeGroup);

    // Materials for the Smart Refrigerator
    const brushedSilverMat = new THREE.MeshStandardMaterial({
      color: 0xa3acb8,
      metalness: 0.78,
      roughness: 0.26
    });
    const darkChassisMat = new THREE.MeshStandardMaterial({
      color: 0x262b36,
      metalness: 0.6,
      roughness: 0.4
    });
    const interiorLinerMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.22,
      metalness: 0.05
    });
    const gasketMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.85,
      metalness: 0.05
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.14
    });
    const glassShelfMat = new THREE.MeshPhysicalMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.42,
      roughness: 0.08,
      metalness: 0.05,
      reflectivity: 0.9
    });

    // Fridge Dimensions: Width = 1.04m, Height = 1.88m, Depth = 0.72m
    // Outer Cabinet Walls (Left, Right, Top, Bottom, Back) so the interior is hollow and visible when doors open!
    const wallThickness = 0.055;
    const fWidth = 1.04;
    const fHeight = 1.88;
    const fDepth = 0.72;

    // Base feet / plinth
    const basePlinth = new THREE.Mesh(new THREE.BoxGeometry(fWidth - 0.04, 0.05, fDepth - 0.04), darkChassisMat);
    basePlinth.position.set(0, 0.025, 0);
    basePlinth.castShadow = true;
    fridgeGroup.add(basePlinth);

    // Bottom insulated slab
    const bottomSlab = new THREE.Mesh(
      new THREE.BoxGeometry(fWidth, wallThickness, fDepth),
      brushedSilverMat
    );
    bottomSlab.position.set(0, 0.05 + wallThickness / 2, 0);
    bottomSlab.castShadow = true;
    bottomSlab.receiveShadow = true;
    fridgeGroup.add(bottomSlab);

    // Top insulated slab
    const topSlab = new THREE.Mesh(
      new THREE.BoxGeometry(fWidth, wallThickness + 0.02, fDepth),
      brushedSilverMat
    );
    topSlab.position.set(0, fHeight - (wallThickness + 0.02) / 2, 0);
    topSlab.castShadow = true;
    topSlab.receiveShadow = true;
    fridgeGroup.add(topSlab);

    // Left outer wall
    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, fHeight - 0.05, fDepth),
      brushedSilverMat
    );
    leftWall.position.set(-fWidth / 2 + wallThickness / 2, 0.05 + (fHeight - 0.05) / 2, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    fridgeGroup.add(leftWall);

    // Right outer wall
    const rightWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, fHeight - 0.05, fDepth),
      brushedSilverMat
    );
    rightWall.position.set(fWidth / 2 - wallThickness / 2, 0.05 + (fHeight - 0.05) / 2, 0);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    fridgeGroup.add(rightWall);

    // Back insulated wall
    const rearWall = new THREE.Mesh(
      new THREE.BoxGeometry(fWidth - wallThickness * 2, fHeight - 0.05, wallThickness),
      brushedSilverMat
    );
    rearWall.position.set(0, 0.05 + (fHeight - 0.05) / 2, -fDepth / 2 + wallThickness / 2);
    rearWall.castShadow = true;
    rearWall.receiveShadow = true;
    fridgeGroup.add(rearWall);

    // White Interior Liner Planes
    const innerBack = new THREE.Mesh(
      new THREE.BoxGeometry(fWidth - wallThickness * 2, fHeight - 0.16, 0.015),
      interiorLinerMat
    );
    innerBack.position.set(0, 0.96, -fDepth / 2 + wallThickness + 0.01);
    fridgeGroup.add(innerBack);

    const innerLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, fHeight - 0.16, fDepth - wallThickness * 1.4),
      interiorLinerMat
    );
    innerLeft.position.set(-fWidth / 2 + wallThickness + 0.008, 0.96, 0.01);
    fridgeGroup.add(innerLeft);

    const innerRight = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, fHeight - 0.16, fDepth - wallThickness * 1.4),
      interiorLinerMat
    );
    innerRight.position.set(fWidth / 2 - wallThickness - 0.008, 0.96, 0.01);
    fridgeGroup.add(innerRight);

    const innerBottom = new THREE.Mesh(
      new THREE.BoxGeometry(fWidth - wallThickness * 2, 0.015, fDepth - wallThickness * 1.4),
      interiorLinerMat
    );
    innerBottom.position.set(0, 0.11, 0.01);
    fridgeGroup.add(innerBottom);

    // 5. INTERNAL LED LIGHTING (Turns ON automatically when either door is open)
    const interiorPointLight = new THREE.PointLight(0xe0f2fe, 0, 2.4);
    interiorPointLight.position.set(0, 1.66, 0.1);
    fridgeGroup.add(interiorPointLight);

    const interiorSubLight = new THREE.PointLight(0xf0f9ff, 0, 1.8);
    interiorSubLight.position.set(0, 0.78, 0.12);
    fridgeGroup.add(interiorSubLight);

    const ledStripMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xbae6fd,
      emissiveIntensity: 0
    });
    const topLedStrip = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.014, 0.06), ledStripMat);
    topLedStrip.position.set(0, 1.78, 0.1);
    fridgeGroup.add(topLedStrip);

    // 6. 3D EVAPORATOR COOLING FAN SYSTEM (Upper Rear Wall inside Fridge)
    const fanGroup = new THREE.Group();
    fanGroup.position.set(0, 1.48, -fDepth / 2 + wallThickness + 0.035);
    fridgeGroup.add(fanGroup);

    // Evaporator housing panel
    const shroudMat = new THREE.MeshStandardMaterial({
      color: 0xdbe2ea,
      metalness: 0.35,
      roughness: 0.3
    });
    const fanShroud = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.03), shroudMat);
    fanGroup.add(fanShroud);

    // Circular vent recess
    const ventRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.125, 0.012, 16, 32),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.25 })
    );
    ventRing.position.z = 0.018;
    fanGroup.add(ventRing);

    const ventBack = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 24),
      new THREE.MeshBasicMaterial({ color: 0x0f172a })
    );
    ventBack.position.z = 0.016;
    fanGroup.add(ventBack);

    // Rotating Fan Blades Group
    const fanBladesGroup = new THREE.Group();
    fanBladesGroup.position.z = 0.022;
    fanGroup.add(fanBladesGroup);

    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.5,
      roughness: 0.2,
      emissive: 0x0284c7,
      emissiveIntensity: 0.35
    });

    for (let i = 0; i < 6; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.034, 0.008), bladeMat);
      blade.rotation.z = (i * Math.PI) / 3;
      blade.rotation.x = 0.25;
      fanBladesGroup.add(blade);
    }

    const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.016, 16), chromeMat);
    fanHub.rotation.x = Math.PI / 2;
    fanBladesGroup.add(fanHub);

    // Fan status LED ring on shroud
    const fanLedMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.8
    });
    const fanStatusDot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), fanLedMat);
    fanStatusDot.position.set(0.18, 0.12, 0.02);
    fanGroup.add(fanStatusDot);

    // 7. COLD AIRFLOW PARTICLES INSIDE FRIDGE (Active when Cooling is ON)
    const particleCount = 110;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.78;
      positions[i * 3 + 1] = 0.22 + Math.random() * 1.45;
      positions[i * 3 + 2] = -0.22 + Math.random() * 0.45;
      speeds[i] = 0.35 + Math.random() * 0.45;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.024,
      transparent: true,
      opacity: 0.75
    });
    const coldAirParticles = new THREE.Points(particleGeo, particleMat);
    fridgeGroup.add(coldAirParticles);

    // 8. INTERIOR GLASS SHELVES, CRISPER DRAWERS & 3D FOOD ITEMS
    const shelfHeights = [0.46, 0.78, 1.08, 1.34];
    shelfHeights.forEach((sy) => {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.89, 0.014, 0.54), glassShelfMat);
      shelf.position.set(0, sy, -0.01);
      fridgeGroup.add(shelf);

      // Front white trim on glass shelf
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(0.89, 0.018, 0.018),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3 })
      );
      trim.position.set(0, sy, 0.26);
      fridgeGroup.add(trim);
    });

    // Lower Crisper Drawers (Left & Right vegetable bins)
    [-0.22, 0.22].forEach((dx) => {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.28, 0.48), glassShelfMat);
      drawer.position.set(dx, 0.27, -0.02);
      fridgeGroup.add(drawer);

      const drawerHandle = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.03, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.4, roughness: 0.3 })
      );
      drawerHandle.position.set(dx, 0.38, 0.225);
      fridgeGroup.add(drawerHandle);
    });

    // 3D Food Items on Shelves
    const foodGroup = new THREE.Group();
    fridgeGroup.add(foodGroup);

    // Shelf 3 (y = 1.08): Milk cartons, orange juice bottle, yogurt cups
    const milkMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.35 });
    const milkCarton1 = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.21, 0.095), milkMat);
    milkCarton1.position.set(-0.28, 1.08 + 0.11, 0.04);
    foodGroup.add(milkCarton1);

    const milkTop1 = new THREE.Mesh(
      new THREE.ConeGeometry(0.068, 0.05, 4),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
    );
    milkTop1.rotation.y = Math.PI / 4;
    milkTop1.position.set(-0.28, 1.08 + 0.24, 0.04);
    foodGroup.add(milkTop1);

    // Orange juice bottle
    const juiceMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.25 });
    const juiceBottle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.048, 0.2, 20), juiceMat);
    juiceBottle.position.set(-0.12, 1.08 + 0.105, 0.06);
    foodGroup.add(juiceBottle);

    // Soda cans (Red & Cyan) on Shelf 3
    const redCanMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.65, roughness: 0.25 });
    const cyanCanMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, metalness: 0.65, roughness: 0.25 });
    [0.06, 0.16, 0.26].forEach((cx, idx) => {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(0.034, 0.034, 0.115, 20),
        idx % 2 === 0 ? redCanMat : cyanCanMat
      );
      can.position.set(cx, 1.08 + 0.065, 0.08);
      foodGroup.add(can);
    });

    // Shelf 2 (y = 0.78): Meal prep containers & cheese / fruit bowl
    const containerMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.3 });
    const glassBoxMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.75,
      roughness: 0.15
    });
    const prepBox1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.16), glassBoxMat);
    prepBox1.position.set(-0.22, 0.78 + 0.048, 0.04);
    foodGroup.add(prepBox1);

    const prepLid1 = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.015, 0.165), containerMat);
    prepLid1.position.set(-0.22, 0.78 + 0.092, 0.04);
    foodGroup.add(prepLid1);

    // Cheese wheel / butter block
    const cheeseMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 });
    const cheeseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 20), cheeseMat);
    cheeseMesh.position.set(0.18, 0.78 + 0.038, 0.05);
    foodGroup.add(cheeseMesh);

    // Shelf 1 (y = 0.46): Water pitcher, apples & green produce
    const appleMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3 });
    [-0.25, -0.17, -0.21].forEach((ax, i) => {
      const apple = new THREE.Mesh(new THREE.SphereGeometry(0.038, 16, 16), appleMat);
      apple.position.set(ax, 0.46 + 0.045, 0.04 + (i % 2) * 0.06);
      foodGroup.add(apple);
    });

    const waterBottleMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.7,
      roughness: 0.1
    });
    [0.12, 0.24].forEach((wx) => {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.22, 20), waterBottleMat);
      bottle.position.set(wx, 0.46 + 0.115, 0.04);
      foodGroup.add(bottle);
    });

    // Green vegetables inside crisper drawers
    const veggieMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.5 });
    [-0.26, -0.18, 0.18, 0.26].forEach((vx, idx) => {
      const veg = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 14), veggieMat);
      veg.scale.set(1.2, 0.85, 1.0);
      veg.position.set(vx, 0.22, -0.02 + (idx % 2) * 0.06);
      foodGroup.add(veg);
    });

    // Top shelf (y = 1.34): ESP32 Sensor Node Box inside Fridge!
    const espPcbMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.4, roughness: 0.3 });
    const espNode = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.04, 0.08), espPcbMat);
    espNode.position.set(-0.3, 1.34 + 0.028, 0.08);
    foodGroup.add(espNode);

    // 9. STATUS & ALARM LED BEACON ON TOP FRONT BEZEL
    const statusLedBezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.032, 0.025),
      darkChassisMat
    );
    statusLedBezel.position.set(0, fHeight - 0.032, fDepth / 2 + 0.005);
    fridgeGroup.add(statusLedBezel);

    const statusLedMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.5
    });
    const statusLedBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.016, 0.028),
      statusLedMat
    );
    statusLedBar.position.set(0, fHeight - 0.032, fDepth / 2 + 0.008);
    fridgeGroup.add(statusLedBar);

    const alarmBeaconLight = new THREE.PointLight(0xef4444, 0, 2.2);
    alarmBeaconLight.position.set(0, fHeight - 0.02, fDepth / 2 + 0.12);
    fridgeGroup.add(alarmBeaconLight);

    // 10. LEFT & RIGHT HINGED DOORS WITH HANDLES, HINGES, GASKETS & DIGITAL DISPLAY
    const doorWidth = 0.508;
    const doorHeight = 1.75;
    const doorDepth = 0.048;

    // --- LEFT DOOR PIVOT (Hinged at Left Outer Edge: x = -0.51, z = 0.36) ---
    const leftDoorPivot = new THREE.Group();
    leftDoorPivot.position.set(-fWidth / 2 + 0.006, 0.945, fDepth / 2);
    fridgeGroup.add(leftDoorPivot);

    // Top & Bottom Left Hinges
    [-0.885, 0.885].forEach((hy) => {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 16), chromeMat);
      hinge.position.set(0.01, hy, 0.01);
      leftDoorPivot.add(hinge);
    });

    const leftDoorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth, doorHeight, doorDepth),
      brushedSilverMat
    );
    leftDoorMesh.position.set(doorWidth / 2, 0, doorDepth / 2);
    leftDoorMesh.castShadow = true;
    leftDoorMesh.receiveShadow = true;
    leftDoorMesh.userData = { interactable: 'leftDoor' };
    leftDoorPivot.add(leftDoorMesh);

    // Left Door Magnetic Rubber Gasket (Gioăng cửa)
    const leftGasket = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth - 0.025, doorHeight - 0.03, 0.016),
      gasketMat
    );
    leftGasket.position.set(doorWidth / 2, 0, -0.004);
    leftGasket.userData = { interactable: 'leftDoor' };
    leftDoorPivot.add(leftGasket);

    // Left Door Interior Bins
    [-0.42, 0.05, 0.48].forEach((by) => {
      const bin = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.11), glassShelfMat);
      bin.position.set(doorWidth / 2, by, -0.055);
      bin.userData = { interactable: 'leftDoor' };
      leftDoorPivot.add(bin);
    });

    // Left Door Vertical Brushed Steel Handle
    const leftHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.68, 20),
      chromeMat
    );
    leftHandle.position.set(doorWidth - 0.055, 0.04, doorDepth + 0.032);
    leftHandle.userData = { interactable: 'leftDoor' };
    leftDoorPivot.add(leftHandle);

    [-0.28, 0.36].forEach((mountY) => {
      const standOff = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.035, 12), chromeMat);
      standOff.rotation.x = Math.PI / 2;
      standOff.position.set(doorWidth - 0.055, mountY, doorDepth + 0.016);
      leftDoorPivot.add(standOff);
    });

    // --- RIGHT DOOR PIVOT (Hinged at Right Outer Edge: x = +0.51, z = 0.36) ---
    const rightDoorPivot = new THREE.Group();
    rightDoorPivot.position.set(fWidth / 2 - 0.006, 0.945, fDepth / 2);
    fridgeGroup.add(rightDoorPivot);

    // Top & Bottom Right Hinges
    [-0.885, 0.885].forEach((hy) => {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 16), chromeMat);
      hinge.position.set(-0.01, hy, 0.01);
      rightDoorPivot.add(hinge);
    });

    const rightDoorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth, doorHeight, doorDepth),
      brushedSilverMat
    );
    rightDoorMesh.position.set(-doorWidth / 2, 0, doorDepth / 2);
    rightDoorMesh.castShadow = true;
    rightDoorMesh.receiveShadow = true;
    rightDoorMesh.userData = { interactable: 'rightDoor' };
    rightDoorPivot.add(rightDoorMesh);

    // Right Door Magnetic Rubber Gasket (Gioăng cửa)
    const rightGasket = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth - 0.025, doorHeight - 0.03, 0.016),
      gasketMat
    );
    rightGasket.position.set(-doorWidth / 2, 0, -0.004);
    rightGasket.userData = { interactable: 'rightDoor' };
    rightDoorPivot.add(rightGasket);

    // Right Door Interior Bins
    [-0.42, 0.05, 0.48].forEach((by) => {
      const bin = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.11), glassShelfMat);
      bin.position.set(-doorWidth / 2, by, -0.055);
      bin.userData = { interactable: 'rightDoor' };
      rightDoorPivot.add(bin);
    });

    // Right Door Vertical Brushed Steel Handle
    const rightHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.68, 20),
      chromeMat
    );
    rightHandle.position.set(-doorWidth + 0.055, 0.04, doorDepth + 0.032);
    rightHandle.userData = { interactable: 'rightDoor' };
    rightDoorPivot.add(rightHandle);

    [-0.28, 0.36].forEach((mountY) => {
      const standOff = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.035, 12), chromeMat);
      standOff.rotation.x = Math.PI / 2;
      standOff.position.set(-doorWidth + 0.055, mountY, doorDepth + 0.016);
      rightDoorPivot.add(standOff);
    });

    // 11. DIGITAL TEMPERATURE DISPLAY ON DOOR (Dynamic CanvasTexture on Right Door)
    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = 320;
    displayCanvas.height = 480;
    const displayCtx = displayCanvas.getContext('2d')!;
    const displayTexture = new THREE.CanvasTexture(displayCanvas);
    displayTexture.anisotropy = 4;

    const drawDigitalDisplay = (
      tempVal: number,
      humVal: number,
      isCooling: boolean,
      isBuzzer: boolean,
      isDoorOpen: boolean,
      doorSec: number,
      isDoorTimeout: boolean,
      mqttStat: string
    ) => {
      const ctx = displayCtx;
      ctx.clearRect(0, 0, 320, 480);

      // Sleek OLED Black Glass Background
      const grad = ctx.createLinearGradient(0, 0, 0, 480);
      grad.addColorStop(0, '#070b14');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 320, 480);

      // Outer border glow
      ctx.strokeStyle = isBuzzer ? '#ef4444' : isCooling ? '#0ea5e9' : '#10b981';
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, 304, 464);

      // Top Header
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 16px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SMART FRIDGE IoT', 160, 40);

      // WiFi / MQTT pill
      ctx.fillStyle = mqttStat === 'CONNECTED' || mqttStat === 'SIMULATED' ? '#064e3b' : '#3f3f46';
      ctx.fillRect(70, 54, 180, 24);
      ctx.fillStyle = mqttStat === 'CONNECTED' || mqttStat === 'SIMULATED' ? '#34d399' : '#a1a1aa';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`MQTT: ${mqttStat}`, 160, 70);

      // Digital Temperature Readout
      ctx.fillStyle = isBuzzer ? '#f87171' : isCooling ? '#38bdf8' : '#34d399';
      ctx.font = 'bold 72px monospace';
      const tempText = `${tempVal > 0 ? '+' : ''}${tempVal.toFixed(1)}°C`;
      ctx.fillText(tempText, 160, 165);

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 14px Inter, sans-serif';
      ctx.fillText(`HUMIDITY: ${humVal}% RH`, 160, 198);

      // Divider
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(28, 220);
      ctx.lineTo(292, 220);
      ctx.stroke();

      // Status Pills: COOLING, BUZZER, DOOR
      const drawRow = (y: number, label: string, val: string, activeColor: string, isActive: boolean) => {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(28, y, 264, 52);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, 44, y + 32);

        ctx.fillStyle = isActive ? activeColor : '#475569';
        ctx.fillRect(190, y + 10, 88, 32);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(val, 234, y + 31);
      };

      drawRow(240, 'COOLING', isCooling ? 'ON' : 'OFF', '#0284c7', isCooling);
      drawRow(306, 'BUZZER', isBuzzer ? 'ALARM' : 'OFF', '#dc2626', isBuzzer);
      drawRow(
        372,
        'DOOR',
        isDoorOpen ? `OPEN ${doorSec}s` : 'CLOSED',
        isDoorTimeout ? '#dc2626' : '#d97706',
        isDoorOpen
      );

      // Footer warning if Buzzer ON (High Temp or Door Open > 15s)
      ctx.textAlign = 'center';
      if (isDoorTimeout && tempVal > 7) {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('! HIGH TEMP & DOOR > 15s ALARM !', 160, 452);
      } else if (isDoorTimeout) {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 13px monospace';
        ctx.fillText('! DOOR OPEN > 15s - CLOSE DOOR !', 160, 452);
      } else if (isBuzzer) {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 13px monospace';
        ctx.fillText('! HIGH TEMP - COOLING INEFFECTIVE !', 160, 452);
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.font = '12px monospace';
        ctx.fillText('ESP32 TELEMETRY ACTIVE', 160, 452);
      }

      displayTexture.needsUpdate = true;
    };

    // Mount Digital Display Frame + Screen onto Right Door Front
    const displayBezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.34, 0.012),
      darkChassisMat
    );
    displayBezel.position.set(-doorWidth / 2 + 0.03, 0.28, doorDepth + 0.005);
    displayBezel.userData = { interactable: 'rightDoor' };
    rightDoorPivot.add(displayBezel);

    const displayScreenMat = new THREE.MeshBasicMaterial({ map: displayTexture });
    const displayScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.31), displayScreenMat);
    displayScreen.position.set(-doorWidth / 2 + 0.03, 0.28, doorDepth + 0.012);
    displayScreen.userData = { interactable: 'rightDoor' };
    rightDoorPivot.add(displayScreen);

    // Initial draw
    drawDigitalDisplay(
      liveStateRef.current.temperature,
      liveStateRef.current.humidity,
      liveStateRef.current.cooling,
      liveStateRef.current.buzzer,
      liveStateRef.current.doorLeftOpen || liveStateRef.current.doorRightOpen,
      liveStateRef.current.doorOpenSeconds,
      liveStateRef.current.doorTimeoutAlarm,
      liveStateRef.current.mqttStatus
    );

    // 12. CAMERA CONTROLS (Smooth Damped Orbit, Angle Limits, Zoom, Double-Click Focus)
    const camState = {
      currentTheta: 0.32,
      currentPhi: 1.24,
      currentRadius: 2.85,
      targetTheta: 0.32,
      targetPhi: 1.24,
      targetRadius: 2.85,
      currentLookAt: new THREE.Vector3(0, 0.98, 0),
      targetLookAt: new THREE.Vector3(0, 0.98, 0),
      isDragging: false,
      dragMoved: false,
      prevX: 0,
      prevY: 0,
      lastPresetTrigger: -1
    };

    const applyCameraPreset = (preset: CameraPreset) => {
      if (preset === 'overview') {
        camState.targetTheta = 0.28;
        camState.targetPhi = 1.24;
        camState.targetRadius = 2.85;
        camState.targetLookAt.set(0, 0.96, 0);
      } else if (preset === 'display') {
        camState.targetTheta = 0.12;
        camState.targetPhi = 1.32;
        camState.targetRadius = 1.42;
        camState.targetLookAt.set(0.22, 1.22, 0.35);
      } else if (preset === 'interior') {
        camState.targetTheta = 0.0;
        camState.targetPhi = 1.28;
        camState.targetRadius = 1.72;
        camState.targetLookAt.set(0, 1.15, 0.05);
      } else if (preset === 'angled') {
        camState.targetTheta = -0.62;
        camState.targetPhi = 1.18;
        camState.targetRadius = 2.65;
        camState.targetLookAt.set(0, 0.96, 0);
      }
    };

    // Raycaster for Door Click & Hover + Double-Click Focus
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const interactableMeshes = [
      leftDoorMesh,
      leftGasket,
      leftHandle,
      rightDoorMesh,
      rightGasket,
      rightHandle,
      displayBezel,
      displayScreen
    ];

    const getIntersects = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      return raycaster.intersectObjects(interactableMeshes, false);
    };

    const onPointerDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      camState.isDragging = true;
      camState.dragMoved = false;
      camState.prevX = e.clientX;
      camState.prevY = e.clientY;
    };

    const onPointerMove = (e: MouseEvent) => {
      if (camState.isDragging) {
        const dx = e.clientX - camState.prevX;
        const dy = e.clientY - camState.prevY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          camState.dragMoved = true;
        }
        camState.prevX = e.clientX;
        camState.prevY = e.clientY;

        // Clamp Azimuth & Polar Angles to prevent clipping through walls or floor
        camState.targetTheta = Math.max(
          -Math.PI * 0.44,
          Math.min(Math.PI * 0.44, camState.targetTheta - dx * 0.0065)
        );
        camState.targetPhi = Math.max(
          0.32,
          Math.min(Math.PI / 2 - 0.05, camState.targetPhi - dy * 0.0055)
        );
      } else {
        const hits = getIntersects(e.clientX, e.clientY);
        if (hits.length > 0) {
          const kind = hits[0].object.userData?.interactable;
          renderer.domElement.style.cursor = 'pointer';
          setHoveredPart(kind === 'leftDoor' ? 'Cửa Trái (Click để Đóng/Mở)' : 'Cửa Phải & Màn hình LED (Click để Đóng/Mở)');
        } else {
          renderer.domElement.style.cursor = 'grab';
          setHoveredPart(null);
        }
      }
    };

    const onPointerUp = (e: MouseEvent) => {
      if (!camState.isDragging) return;
      const wasDragged = camState.dragMoved;
      camState.isDragging = false;

      if (!wasDragged) {
        const hits = getIntersects(e.clientX, e.clientY);
        if (hits.length > 0) {
          const kind = hits[0].object.userData?.interactable;
          if (kind === 'leftDoor') {
            useFridgeStore.getState().toggleLeftDoor();
          } else if (kind === 'rightDoor') {
            useFridgeStore.getState().toggleRightDoor();
          }
        }
      }
    };

    const onDoubleClick = (e: MouseEvent) => {
      e.preventDefault();
      // Smoothly focus camera onto the refrigerator on double-click
      const hits = getIntersects(e.clientX, e.clientY);
      if (hits.length > 0 && hits[0].object === displayScreen) {
        setCameraPreset('display');
      } else if (liveStateRef.current.doorLeftOpen || liveStateRef.current.doorRightOpen) {
        setCameraPreset('interior');
      } else {
        setCameraPreset('overview');
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camState.targetRadius = Math.max(
        1.35,
        Math.min(4.5, camState.targetRadius + e.deltaY * 0.0018)
      );
    };

    const domElem = renderer.domElement;
    domElem.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    domElem.addEventListener('dblclick', onDoubleClick);
    domElem.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth || 800;
      const h = containerRef.current.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // 13. ANIMATION LOOP
    let animFrameId = 0;
    let lastTime = performance.now();
    let lastDisplaySignature = '';

    const animate = (now: number) => {
      animFrameId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const st = liveStateRef.current;

      // Check if preset button triggered
      if (st.focusTrigger !== camState.lastPresetTrigger) {
        camState.lastPresetTrigger = st.focusTrigger;
        applyCameraPreset(st.cameraPreset);
      }

      // Smooth Camera Orbit Interpolation
      const damp = 1 - Math.exp(-8 * dt);
      camState.currentTheta += (camState.targetTheta - camState.currentTheta) * damp;
      camState.currentPhi += (camState.targetPhi - camState.currentPhi) * damp;
      camState.currentRadius += (camState.targetRadius - camState.currentRadius) * damp;
      camState.currentLookAt.lerp(camState.targetLookAt, damp);

      camera.position.x =
        camState.currentLookAt.x +
        camState.currentRadius * Math.sin(camState.currentPhi) * Math.sin(camState.currentTheta);
      camera.position.y =
        camState.currentLookAt.y +
        camState.currentRadius * Math.cos(camState.currentPhi);
      camera.position.z =
        camState.currentLookAt.z +
        camState.currentRadius * Math.sin(camState.currentPhi) * Math.cos(camState.currentTheta);
      camera.lookAt(camState.currentLookAt);

      // Smooth Door Hinge Rotation Animation
      const targetLeftRot = st.doorLeftOpen ? -Math.PI * 0.64 : 0;
      const targetRightRot = st.doorRightOpen ? Math.PI * 0.64 : 0;
      const doorDamp = 1 - Math.exp(-7.5 * dt);
      leftDoorPivot.rotation.y += (targetLeftRot - leftDoorPivot.rotation.y) * doorDamp;
      rightDoorPivot.rotation.y += (targetRightRot - rightDoorPivot.rotation.y) * doorDamp;

      // Internal LED Lighting when either door is open
      const anyOpen =
        st.doorLeftOpen ||
        st.doorRightOpen ||
        Math.abs(leftDoorPivot.rotation.y) > 0.08 ||
        Math.abs(rightDoorPivot.rotation.y) > 0.08;
      const targetLightIntensity = anyOpen ? 1.85 : 0.0;
      interiorPointLight.intensity += (targetLightIntensity - interiorPointLight.intensity) * doorDamp;
      interiorSubLight.intensity += (targetLightIntensity * 0.65 - interiorSubLight.intensity) * doorDamp;
      ledStripMat.emissiveIntensity = anyOpen ? 1.6 : 0.0;

      // Cooling Fan Rotation & Cold Airflow Particles
      if (st.cooling) {
        fanBladesGroup.rotation.z -= dt * 15.0;
        bladeMat.color.setHex(0x38bdf8);
        bladeMat.emissive.setHex(0x0284c7);
        bladeMat.emissiveIntensity = 0.55;
        fanLedMat.color.setHex(0x38bdf8);
        fanLedMat.emissive.setHex(0x0ea5e9);
        fanLedMat.emissiveIntensity = 1.5;

        coldAirParticles.visible = true;
        const posAttr = particleGeo.getAttribute('position');
        for (let i = 0; i < particleCount; i++) {
          let py = posAttr.getY(i) - speeds[i] * dt;
          let pz = posAttr.getZ(i) + Math.sin(now * 0.003 + i) * 0.002;
          if (py < 0.22) {
            py = 1.52;
            pz = -0.22 + Math.random() * 0.42;
          }
          posAttr.setY(i, py);
          posAttr.setZ(i, pz);
        }
        posAttr.needsUpdate = true;
      } else {
        bladeMat.color.setHex(0x64748b);
        bladeMat.emissiveIntensity = 0.0;
        fanLedMat.color.setHex(0x475569);
        fanLedMat.emissiveIntensity = 0.0;
        coldAirParticles.visible = false;
      }

      // Top Status & Buzzer Alarm LED Bar
      if (st.buzzer) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.016);
        statusLedMat.color.setHex(0xef4444);
        statusLedMat.emissive.setHex(0xef4444);
        statusLedMat.emissiveIntensity = 1.2 + pulse * 2.4;
        alarmBeaconLight.intensity = pulse * 1.8;
      } else if (st.cooling) {
        statusLedMat.color.setHex(0x38bdf8);
        statusLedMat.emissive.setHex(0x0ea5e9);
        statusLedMat.emissiveIntensity = 1.4;
        alarmBeaconLight.intensity = 0;
      } else {
        statusLedMat.color.setHex(0x10b981);
        statusLedMat.emissive.setHex(0x059669);
        statusLedMat.emissiveIntensity = 0.45;
        alarmBeaconLight.intensity = 0;
      }

      // Re-draw Digital Display Texture when state changes
      const sig = `${st.temperature.toFixed(1)}|${st.humidity}|${st.cooling}|${st.buzzer}|${st.doorLeftOpen || st.doorRightOpen}|${st.doorOpenSeconds}|${st.doorTimeoutAlarm}|${st.mqttStatus}`;
      if (sig !== lastDisplaySignature) {
        lastDisplaySignature = sig;
        drawDigitalDisplay(
          st.temperature,
          st.humidity,
          st.cooling,
          st.buzzer,
          st.doorLeftOpen || st.doorRightOpen,
          st.doorOpenSeconds,
          st.doorTimeoutAlarm,
          st.mqttStatus
        );
      }

      renderer.render(scene, camera);
    };

    animFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameId);
      domElem.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      domElem.removeEventListener('dblclick', onDoubleClick);
      domElem.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, [threeLoaded, setCameraPreset]);

  const anyDoorOpen = doorLeftOpen || doorRightOpen;

  return (
    <div className="relative w-full h-full min-h-[420px] bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-800/90 shadow-2xl select-none">
      {/* Three.js Canvas Mount Container */}
      <div ref={containerRef} className="w-full h-full min-h-[420px]" />

      {/* Loading Fallback if Three.js script is fetching */}
      {!threeLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 z-20 gap-3">
          <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-zinc-300 font-medium">Đang khởi tạo môi trường 3D Three.js...</p>
        </div>
      )}

      {/* Top-Left 3D Scene Telemetry Overlay Badges */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/85 backdrop-blur-md border border-zinc-700/70 text-xs font-medium text-zinc-200 shadow-lg">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                buzzer
                  ? 'bg-red-500 animate-ping'
                  : cooling
                  ? 'bg-cyan-400 animate-pulse'
                  : 'bg-emerald-400'
              }`}
            />
            <span className="font-mono font-bold text-sm text-white">
              {temperature > 0 ? `+${temperature.toFixed(1)}` : temperature.toFixed(1)}°C
            </span>
            <span className="text-zinc-400">|</span>
            <span className="text-zinc-300">
              Door Status:{' '}
              <strong
                className={
                  doorTimeoutAlarm
                    ? 'text-red-400 animate-pulse'
                    : anyDoorOpen
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }
              >
                {anyDoorOpen ? `OPEN (${doorOpenSeconds}s / 15s)` : 'CLOSED'}
              </strong>
            </span>
          </div>

          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl backdrop-blur-md border text-xs font-semibold shadow-lg ${
              cooling
                ? 'bg-cyan-950/85 border-cyan-500/50 text-cyan-300'
                : 'bg-zinc-900/85 border-zinc-700/70 text-zinc-400'
            }`}
          >
            <Fan className={`w-3.5 h-3.5 ${cooling ? 'animate-spin text-cyan-400' : 'text-zinc-500'}`} />
            <span>Cooling: {cooling ? 'ON' : 'OFF'}</span>
          </div>

          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl backdrop-blur-md border text-xs font-semibold shadow-lg ${
              buzzer
                ? 'bg-red-950/90 border-red-500 text-red-200 animate-pulse'
                : 'bg-zinc-900/85 border-zinc-700/70 text-zinc-400'
            }`}
          >
            <Bell className={`w-3.5 h-3.5 ${buzzer ? 'text-red-400 animate-bounce' : 'text-zinc-500'}`} />
            <span>Buzzer: {buzzer ? 'ON' : 'OFF'}</span>
          </div>
        </div>

        {/* Camera Preset Switcher */}
        <div className="flex items-center gap-1 bg-zinc-900/85 backdrop-blur-md border border-zinc-700/70 p-1 rounded-xl pointer-events-auto shadow-lg">
          <button
            type="button"
            onClick={() => setCameraPreset('overview')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
              cameraPreset === 'overview'
                ? 'bg-cyan-500 text-zinc-950 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
            title="Góc nhìn toàn cảnh căn bếp Industrial Minimalism"
          >
            Toàn cảnh
          </button>
          <button
            type="button"
            onClick={() => setCameraPreset('display')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
              cameraPreset === 'display'
                ? 'bg-cyan-500 text-zinc-950 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
            title="Cận cảnh màn hình nhiệt độ kỹ thuật số trên cửa tủ"
          >
            Màn hình LED
          </button>
          <button
            type="button"
            onClick={() => {
              if (!doorLeftOpen && !doorRightOpen) {
                toggleLeftDoor();
                toggleRightDoor();
              }
              setCameraPreset('interior');
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
              cameraPreset === 'interior'
                ? 'bg-cyan-500 text-zinc-950 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
            title="Xem bên trong tủ, hệ thống quạt làm lạnh và luồng khí lạnh"
          >
            Bên trong & Quạt
          </button>
          <button
            type="button"
            onClick={() => setCameraPreset('angled')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
              cameraPreset === 'angled'
                ? 'bg-cyan-500 text-zinc-950 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
            title="Góc nhìn nghiêng 3D"
          >
            Góc nghiêng
          </button>
        </div>
      </div>

      {/* Hover Tooltip for Interactive 3D Parts */}
      {hoveredPart && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-cyan-500/95 text-zinc-950 text-xs font-semibold shadow-lg pointer-events-none flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" />
          <span>{hoveredPart}</span>
        </div>
      )}

      {/* High Temperature OR Door Open > 15s Floating 3D Alert Overlay */}
      {buzzer && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 w-[92%] max-w-lg px-4 py-2.5 rounded-xl bg-red-950/95 border-2 border-red-500 text-red-100 shadow-2xl flex items-center justify-between gap-3 pointer-events-none animate-pulse">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <div className="text-xs font-bold tracking-wider uppercase text-red-300">
                {doorTimeoutAlarm && temperature > 7
                  ? 'CRITICAL IOT ALERT (T > 7°C & CỬA MỞ > 15s)'
                  : doorTimeoutAlarm
                  ? `DOOR OPEN TIMEOUT ALERT (${doorOpenSeconds}s > 15s)`
                  : 'CRITICAL IOT ALERT (T > 7°C)'}
              </div>
              <div className="text-sm font-extrabold text-white">
                {doorTimeoutAlarm && temperature <= 7
                  ? 'DOOR OPEN > 15s – PLEASE CLOSE DOOR!'
                  : 'HIGH TEMPERATURE – COOLING INEFFECTIVE'}
              </div>
            </div>
          </div>
          <span className="px-2 py-0.5 text-xs font-mono font-bold bg-red-600 text-white rounded">
            {doorTimeoutAlarm ? `DOOR: ${doorOpenSeconds}s | BUZZER: ON` : 'COOLING: ON | BUZZER: ON'}
          </span>
        </div>
      )}

      {/* Bottom 3D Interaction Bar */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900/80 backdrop-blur-md border border-zinc-800 text-[11px] text-zinc-400">
          <Camera className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>Kéo chuột: Xoay Orbit • Cuộn: Zoom • Click cửa tủ: Đóng/Mở • Double-click: Focus tủ</span>
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={toggleLeftDoor}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 ${
              doorLeftOpen
                ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                : 'bg-zinc-900/85 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {doorLeftOpen ? <DoorOpen className="w-3.5 h-3.5" /> : <DoorClosed className="w-3.5 h-3.5" />}
            <span>Cửa Trái: {doorLeftOpen ? 'OPEN' : 'CLOSED'}</span>
          </button>
          <button
            type="button"
            onClick={toggleRightDoor}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 ${
              doorRightOpen
                ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                : 'bg-zinc-900/85 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {doorRightOpen ? <DoorOpen className="w-3.5 h-3.5" /> : <DoorClosed className="w-3.5 h-3.5" />}
            <span>Cửa Phải: {doorRightOpen ? 'OPEN' : 'CLOSED'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 4. ESP32 FIRMWARE SOURCE CODE MODAL CONTENT
// ============================================================================

const ESP32_FIRMWARE_CODE = `/*
 * ĐỒ ÁN MÔN HỌC: INTERNET OF THINGS (IoT)
 * PROJECT: SMART REFRIGERATOR - ESP32 MQTT NODE
 * Hardware: ESP32 DevKit V1 + Cảm biến nhiệt độ DS18B20/DHT22 + Công tắc từ MC-38 + Quạt Relay + Buzzer
 */
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

#define PIN_DHT           4
#define DHTTYPE           DHT22
#define PIN_DOOR_LEFT     18
#define PIN_DOOR_RIGHT    19
#define PIN_COOLING_RELAY 26
#define PIN_BUZZER        27
#define PIN_LED_ALARM     25

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* MQTT_BROKER   = "broker.emqx.io";
const int   MQTT_PORT     = 1883;
const char* TOPIC_PUB     = "iot/smartfridge/esp32/telemetry";
const char* TOPIC_SUB     = "iot/smartfridge/esp32/control";

WiFiClient espClient;
PubSubClient mqtt(espClient);
DHT dht(PIN_DHT, DHTTYPE);

unsigned long doorOpenStartMs = 0;
const unsigned long DOOR_ALARM_TIMEOUT_MS = 15000; // Cảnh báo khi mở cửa quá 15 giây

// Bảng logic điều khiển chuẩn của Đồ án IoT:
// - T <= 0°C         -> Cooling: OFF | Buzzer: OFF
// - 0°C < T <= 7°C   -> Cooling: ON  | Buzzer: OFF
// - T > 7°C          -> Cooling: ON  | Buzzer: ON (Quá 7°C Cooling vẫn giữ ON)
// - Cửa mở > 15 giây -> Buzzer: ON + Đèn cảnh báo Đỏ (Door Timeout Alarm)
void evaluateIoTControl(float T, bool doorOpenTimeout, bool &coolingOut, bool &buzzerOut) {
  if (T <= 0.0f) {
    coolingOut = false;
    buzzerOut  = doorOpenTimeout;
  } else if (T <= 7.0f) {
    coolingOut = true;
    buzzerOut  = doorOpenTimeout;
  } else {
    coolingOut = true;
    buzzerOut  = true;
  }
}

void publishTelemetry(float temp, float hum, bool doorL, bool doorR, bool cooling, bool buzzer) {
  StaticJsonDocument<256> doc;
  doc["device"]      = "ESP32-SmartFridge-01";
  doc["temperature"] = serialized(String(temp, 1));
  doc["humidity"]    = round(hum);
  doc["cooling"]     = cooling ? "ON" : "OFF";
  doc["buzzer"]      = buzzer ? "ON" : "OFF";
  doc["doorStatus"]  = (doorL || doorR) ? "OPEN" : "CLOSED";
  doc["doorLeft"]    = doorL ? "OPEN" : "CLOSED";
  doc["doorRight"]   = doorR ? "OPEN" : "CLOSED";
  doc["alert"]       = buzzer ? "HIGH TEMPERATURE – COOLING INEFFECTIVE" : "NORMAL";

  char payload[256];
  serializeJson(doc, payload);
  mqtt.publish(TOPIC_PUB, payload);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_DOOR_LEFT, INPUT_PULLUP);
  pinMode(PIN_DOOR_RIGHT, INPUT_PULLUP);
  pinMode(PIN_COOLING_RELAY, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_ALARM, OUTPUT);
  dht.begin();

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); }
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
}

void loop() {
  if (!mqtt.connected()) {
    mqtt.connect("ESP32_SmartFridge_Node");
    mqtt.subscribe(TOPIC_SUB);
  }
  mqtt.loop();

  static unsigned long lastTick = 0;
  if (millis() - lastTick >= 2000) {
    lastTick = millis();
    float T = dht.readTemperature();
    float H = dht.readHumidity();
    if (isnan(T)) T = 4.2f;
    if (isnan(H)) H = 62.0f;

    bool doorL = (digitalRead(PIN_DOOR_LEFT) == HIGH);
    bool doorR = (digitalRead(PIN_DOOR_RIGHT) == HIGH);
    bool anyDoorOpen = (doorL || doorR);
    if (anyDoorOpen) {
      if (doorOpenStartMs == 0) doorOpenStartMs = millis();
    } else {
      doorOpenStartMs = 0;
    }
    bool doorTimeout = anyDoorOpen && ((millis() - doorOpenStartMs) > DOOR_ALARM_TIMEOUT_MS);
    bool cooling = false, buzzer = false;

    evaluateIoTControl(T, doorTimeout, cooling, buzzer);

    digitalWrite(PIN_COOLING_RELAY, cooling ? HIGH : LOW);
    digitalWrite(PIN_BUZZER,        buzzer  ? HIGH : LOW);
    digitalWrite(PIN_LED_ALARM,     buzzer  ? HIGH : LOW);

    publishTelemetry(T, H, doorL, doorR, cooling, buzzer);
  }
}`;

// ============================================================================
// 5. MAIN APPLICATION COMPONENT
// ============================================================================

export default function App() {
  const {
    temperature,
    humidity,
    doorLeftOpen,
    doorRightOpen,
    doorOpenSeconds,
    doorTimeoutAlarm,
    cooling,
    buzzer,
    zone,
    audioAllowed,
    autoPhysics,
    faultSimulation,
    mqttStatus,
    mqttBrokerUrl,
    mqttTopicSub,
    mqttTopicPub,
    history,
    mqttLogs,
    setTemperature,
    setHumidity,
    toggleLeftDoor,
    toggleRightDoor,
    setDoors,
    tickDoorTimer,
    triggerDoorTimeoutTest,
    setAudioAllowed,
    setAutoPhysics,
    setFaultSimulation,
    setMqttConfig,
    setMqttStatus,
    appendHistorySample,
    addMqttLog,
    clearMqttLogs
  } = useFridgeStore();

  const [activeTab, setActiveTab] = useState<'controls' | 'mqtt' | 'firmware'>('controls');
  const [brokerInput, setBrokerInput] = useState(mqttBrokerUrl);
  const [topicSubInput, setTopicSubInput] = useState(mqttTopicSub);
  const [topicPubInput, setTopicPubInput] = useState(mqttTopicPub);
  const [customJsonTemp, setCustomJsonTemp] = useState('8.4');
  const [copiedCode, setCopiedCode] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const mqttClientRef = useRef<any>(null);

  // Load MQTT.js via CDN script for real WebSocket broker connections
  useEffect(() => {
    if (window.mqtt) return;
    const existing = document.getElementById('mqttjs-cdn');
    if (existing) return;
    const script = document.createElement('script');
    script.id = 'mqttjs-cdn';
    script.src = 'https://unpkg.com/mqtt@5.3.5/dist/mqtt.min.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // Unlock & Toggle Web Audio API for Buzzer Alarm
  const handleToggleAudio = useCallback(() => {
    if (!audioAllowed) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx && !audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      // Play short confirmation beep
      if (audioCtxRef.current) {
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtxRef.current.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtxRef.current.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(audioCtxRef.current.destination);
        osc.start();
        osc.stop(audioCtxRef.current.currentTime + 0.12);
      }
      setAudioAllowed(true);
    } else {
      setAudioAllowed(false);
    }
  }, [audioAllowed, setAudioAllowed]);

  // Periodic Buzzer Alarm Sound when Buzzer === ON and Audio is Allowed
  useEffect(() => {
    if (!buzzer || !audioAllowed) return;

    const triggerAlarmBeep = () => {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(2200, now);
      osc.frequency.setValueAtTime(1650, now + 0.14);

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.29);
    };

    triggerAlarmBeep();
    const timer = setInterval(triggerAlarmBeep, 900);
    return () => clearInterval(timer);
  }, [buzzer, audioAllowed]);

  // 1-Second Door Open Counter (Triggers audio & red light alarm when door is open > 15s)
  useEffect(() => {
    const doorTimer = setInterval(() => {
      tickDoorTimer();
    }, 1000);
    return () => clearInterval(doorTimer);
  }, [tickDoorTimer]);

  // Thermal Physics & Telemetry Sampling Interval (Every 2 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      const st = useFridgeStore.getState();
      let nextTemp = st.temperature;

      if (st.autoPhysics) {
        const openDoorsCount = (st.doorLeftOpen ? 1 : 0) + (st.doorRightOpen ? 1 : 0);
        if (st.faultSimulation) {
          // Compressor/cooling ineffective fault rises above 7°C
          nextTemp = Math.min(13.5, st.temperature + 0.45);
        } else if (openDoorsCount > 0) {
          // Warm ambient air enters when doors are open
          nextTemp = Math.min(12.0, st.temperature + openDoorsCount * 0.35);
        } else if (st.cooling) {
          // Cooling active brings temperature down toward -0.2°C
          nextTemp = Math.max(-0.4, st.temperature - 0.25);
        } else {
          // Cooling OFF (T <= 0°C): Natural slow thermal drift upward
          nextTemp = st.temperature + 0.15;
        }
        nextTemp = Number(nextTemp.toFixed(1));
        st.setTemperature(nextTemp);
      }

      const updated = useFridgeStore.getState();
      updated.appendHistorySample(updated.temperature, updated.humidity);

      // Build JSON Telemetry Payload matching ESP32 format
      const payloadObj = {
        device: 'ESP32-SmartFridge-01',
        temperature: updated.temperature,
        humidity: updated.humidity,
        cooling: updated.cooling ? 'ON' : 'OFF',
        buzzer: updated.buzzer ? 'ON' : 'OFF',
        doorStatus: updated.doorLeftOpen || updated.doorRightOpen ? 'OPEN' : 'CLOSED',
        doorOpenSeconds: updated.doorOpenSeconds,
        doorLeft: updated.doorLeftOpen ? 'OPEN' : 'CLOSED',
        doorRight: updated.doorRightOpen ? 'OPEN' : 'CLOSED',
        alert:
          updated.doorTimeoutAlarm && updated.temperature > 7
            ? 'HIGH TEMPERATURE & DOOR OPEN > 15s'
            : updated.doorTimeoutAlarm
            ? 'DOOR OPEN > 15s – CLOSE DOOR'
            : updated.buzzer
            ? 'HIGH TEMPERATURE – COOLING INEFFECTIVE'
            : 'NORMAL'
      };
      const payloadStr = JSON.stringify(payloadObj);

      if (updated.mqttStatus === 'CONNECTED' && mqttClientRef.current) {
        try {
          mqttClientRef.current.publish(updated.mqttTopicSub, payloadStr);
          updated.addMqttLog('TX', updated.mqttTopicSub, payloadStr);
        } catch {
          // Ignore publish error
        }
      } else if (updated.mqttStatus === 'SIMULATED') {
        updated.addMqttLog('RX', updated.mqttTopicSub, payloadStr);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Connect to Live WebSocket MQTT Broker
  const handleConnectMqtt = () => {
    setMqttConfig(brokerInput, topicSubInput, topicPubInput);

    if (mqttClientRef.current) {
      try {
        mqttClientRef.current.end(true);
      } catch {
        // Ignore cleanup error
      }
      mqttClientRef.current = null;
    }

    if (!window.mqtt) {
      setMqttStatus('SIMULATED');
      addMqttLog('SYS', 'mqtt/fallback', 'Thư viện MQTT.js đang ở chế độ giả lập cục bộ (Loopback Mode).');
      return;
    }

    setMqttStatus('CONNECTING');
    addMqttLog('SYS', brokerInput, `Đang kết nối WebSocket tới ${brokerInput}...`);

    try {
      const client = window.mqtt.connect(brokerInput, {
        clientId: `smart_fridge_ui_${Math.random().toString(16).slice(2, 8)}`,
        connectTimeout: 5000,
        reconnectPeriod: 0
      });
      mqttClientRef.current = client;

      client.on('connect', () => {
        setMqttStatus('CONNECTED');
        addMqttLog('SYS', brokerInput, 'Đã kết nối MQTT Broker qua WebSocket thành công!');
        client.subscribe(topicSubInput);
      });

      client.on('message', (topic: string, message: Uint8Array) => {
        const text = message.toString();
        addMqttLog('RX', topic, text);
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed.temperature === 'number' || typeof parsed.temperature === 'string') {
            const tVal = parseFloat(String(parsed.temperature));
            if (!Number.isNaN(tVal)) {
              setTemperature(tVal);
            }
          }
          if (typeof parsed.humidity === 'number') {
            setHumidity(parsed.humidity);
          }
          if (parsed.doorLeft === 'OPEN' || parsed.doorLeft === 'CLOSED') {
            setDoors(parsed.doorLeft === 'OPEN', parsed.doorRight === 'OPEN');
          }
        } catch {
          // Non-JSON payload
        }
      });

      client.on('error', () => {
        setMqttStatus('SIMULATED');
        addMqttLog(
          'SYS',
          'mqtt/fallback',
          'Không thể kết nối Broker bên ngoài từ môi trường hiện tại — Tự động chuyển sang ESP32 Simulator Loopback.'
        );
        try {
          client.end(true);
        } catch {
          // Ignore
        }
      });
    } catch {
      setMqttStatus('SIMULATED');
    }
  };

  const handleDisconnectMqtt = () => {
    if (mqttClientRef.current) {
      try {
        mqttClientRef.current.end(true);
      } catch {
        // Ignore
      }
      mqttClientRef.current = null;
    }
    setMqttStatus('SIMULATED');
    addMqttLog('SYS', 'mqtt/loopback', 'Đã chuyển về chế độ mô phỏng ESP32 Loopback.');
  };

  // Simulate injecting an incoming ESP32 MQTT packet
  const handleSimulateIncomingPacket = () => {
    const tVal = parseFloat(customJsonTemp);
    const validTemp = Number.isNaN(tVal) ? 8.5 : tVal;
    setTemperature(validTemp);
    const st = computeIoTState(validTemp);
    const packet = JSON.stringify({
      device: 'ESP32-SmartFridge-01',
      temperature: validTemp,
      humidity,
      cooling: st.cooling ? 'ON' : 'OFF',
      buzzer: st.buzzer ? 'ON' : 'OFF',
      doorStatus: doorLeftOpen || doorRightOpen ? 'OPEN' : 'CLOSED',
      alert: st.buzzer ? 'HIGH TEMPERATURE – COOLING INEFFECTIVE' : 'NORMAL'
    });
    addMqttLog('RX', mqttTopicSub, packet);
    appendHistorySample(validTemp, humidity);
  };

  const handleCopyFirmware = () => {
    try {
      navigator.clipboard.writeText(ESP32_FIRMWARE_CODE);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = ESP32_FIRMWARE_CODE;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const anyDoorOpen = doorLeftOpen || doorRightOpen;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-zinc-950">
      {/* TOP HEADER BAR */}
      <header className="border-b border-zinc-800/90 bg-zinc-900/70 backdrop-blur-md px-4 py-2.5 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Snowflake className="w-5 h-5 text-zinc-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold tracking-tight text-white">
                  SMART REFRIGERATOR – 3D IoT SIMULATOR
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  ESP32 + MQTT + Three.js
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Mô phỏng hệ thống giám sát & điều khiển tủ lạnh thông minh thời gian thực (Đồ án Internet of Things)
              </p>
            </div>
          </div>

          {/* Right Header Controls: Audio Permission & MQTT Status */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleToggleAudio}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 ${
                audioAllowed
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/50 text-amber-300 hover:bg-amber-500/25'
              }`}
            >
              {audioAllowed ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span>{audioAllowed ? 'Âm thanh Buzzer: BẬT' : 'Cho phép âm thanh Buzzer'}</span>
            </button>

            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs">
              {mqttStatus === 'CONNECTED' || mqttStatus === 'SIMULATED' ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-zinc-500" />
              )}
              <span className="text-zinc-400">MQTT:</span>
              <span
                className={`font-mono font-bold ${
                  mqttStatus === 'CONNECTED'
                    ? 'text-emerald-400'
                    : mqttStatus === 'SIMULATED'
                    ? 'text-cyan-400'
                    : 'text-amber-400'
                }`}
              >
                {mqttStatus === 'SIMULATED' ? 'ESP32-SIM' : mqttStatus}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* CRITICAL ALERT BANNER (Shown when T > 7°C OR Door Open > 15s) */}
      {buzzer && (
        <div className="bg-red-950/90 border-b border-red-500/80 px-4 py-2.5">
          <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-red-400 animate-bounce shrink-0" />
              <span className="text-xs sm:text-sm font-extrabold tracking-wide text-red-100">
                {doorTimeoutAlarm && temperature > 7 ? (
                  <>
                    CẢNH BÁO KÉP: <span className="underline decoration-red-400">HIGH TEMPERATURE ({temperature.toFixed(1)}°C) &amp; CỬA MỞ QUÁ 15 GIÂY ({doorOpenSeconds}s)</span> — Đèn đỏ &amp; Buzzer kích hoạt ON!
                  </>
                ) : doorTimeoutAlarm ? (
                  <>
                    CẢNH BÁO CỬA TỦ: <span className="underline decoration-red-400">DOOR OPEN TIMEOUT ({doorOpenSeconds}s &gt; 15s)</span> — Cửa tủ mở quá 15 giây! Đèn cảnh báo đỏ &amp; Còi Buzzer đang kích hoạt ON!
                  </>
                ) : (
                  <>
                    CẢNH BÁO ĐỒ ÁN IoT: <span className="underline decoration-red-400">HIGH TEMPERATURE – COOLING INEFFECTIVE</span> (Nhiệt độ hiện tại {temperature.toFixed(1)}°C &gt; 7.0°C — Hệ thống Cooling vẫn giữ ON, Buzzer kích hoạt ON!)
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!audioAllowed && (
                <button
                  type="button"
                  onClick={handleToggleAudio}
                  className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition"
                >
                  Bật tiếng còi cảnh báo
                </button>
              )}
              {doorTimeoutAlarm && (
                <button
                  type="button"
                  onClick={() => setDoors(false, false)}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold transition"
                >
                  Đóng tất cả cửa ngay
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setFaultSimulation(false);
                  setDoors(false, false);
                  setTemperature(4.0);
                }}
                className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 text-xs font-semibold transition"
              >
                Khôi phục nhiệt độ chuẩn (4.0°C)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT GRID: LEFT 3D VIEWPORT + RIGHT IOT CONTROL DASHBOARD */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN (7 cols on desktop): 3D INTERACTIVE SIMULATOR + REALTIME CHART */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* 3D Canvas Container */}
          <div className="h-[440px] sm:h-[500px] w-full">
            <ThreeSmartFridgeViewport />
          </div>

          {/* Real-time Temperature Telemetry Chart (Recharts) */}
          <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-white">
                  Biểu Đồ Nhiệt Độ Thời Gian Thực (Recharts Telemetry)
                </h2>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> Ngưỡng ngắt lạnh (0°C)
                </span>
                <span className="flex items-center gap-1 text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-400" /> Ngưỡng báo động (7°C)
                </span>
              </div>
            </div>

            <div className="relative h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={history} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tempAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={buzzer ? '#ef4444' : '#38bdf8'} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={buzzer ? '#ef4444' : '#38bdf8'} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="time" stroke="#71717a" tick={{ fontSize: 11 }} />
                  <YAxis domain={[-6, 15]} stroke="#71717a" tick={{ fontSize: 11 }} unit="°C" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09090b',
                      borderColor: '#27272a',
                      borderRadius: '12px',
                      fontSize: '12px'
                    }}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    label={{ value: '0°C (Cooling OFF)', fill: '#10b981', fontSize: 10, position: 'insideBottomLeft' }}
                  />
                  <ReferenceLine
                    y={7}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{ value: '7°C (Buzzer ON)', fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="temperature"
                    name="Nhiệt độ (°C)"
                    stroke={buzzer ? '#ef4444' : '#38bdf8'}
                    fill="url(#tempAreaGrad)"
                    strokeWidth={2.5}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols on desktop): REAL-TIME IOT DASHBOARD & CONTROLS */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* 4-Card KPI Telemetry Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* Temperature Card */}
            <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Nhiệt độ</span>
                <Thermometer className="w-4 h-4 text-cyan-400" />
              </div>
              <div
                className={`text-xl font-mono font-extrabold mt-1 ${
                  buzzer ? 'text-red-400' : cooling ? 'text-cyan-300' : 'text-emerald-300'
                }`}
              >
                {temperature > 0 ? `+${temperature.toFixed(1)}` : temperature.toFixed(1)}°C
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5">Độ ẩm: {humidity}% RH</div>
            </div>

            {/* Cooling Card */}
            <div
              className={`rounded-2xl p-3 border flex flex-col justify-between transition ${
                cooling
                  ? 'bg-cyan-950/40 border-cyan-500/50'
                  : 'bg-zinc-900/90 border-zinc-800'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Cooling Fan</span>
                <Fan className={`w-4 h-4 ${cooling ? 'text-cyan-400 animate-spin' : 'text-zinc-500'}`} />
              </div>
              <div className={`text-xl font-mono font-extrabold mt-1 ${cooling ? 'text-cyan-300' : 'text-zinc-400'}`}>
                {cooling ? 'ON' : 'OFF'}
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                {cooling ? 'Quạt 3D đang quay' : 'Đã ngắt (T ≤ 0°C)'}
              </div>
            </div>

            {/* Buzzer Card */}
            <div
              className={`rounded-2xl p-3 border flex flex-col justify-between transition ${
                buzzer
                  ? 'bg-red-950/60 border-red-500 animate-pulse'
                  : 'bg-zinc-900/90 border-zinc-800'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Buzzer Alarm</span>
                <Bell className={`w-4 h-4 ${buzzer ? 'text-red-400 animate-bounce' : 'text-zinc-500'}`} />
              </div>
              <div className={`text-xl font-mono font-extrabold mt-1 ${buzzer ? 'text-red-400' : 'text-zinc-400'}`}>
                {buzzer ? 'ON' : 'OFF'}
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                {doorTimeoutAlarm && temperature > 7
                  ? 'Quá nhiệt & Mở cửa >15s'
                  : doorTimeoutAlarm
                  ? `Cửa mở ${doorOpenSeconds}s (>15s)`
                  : buzzer
                  ? 'Cảnh báo T > 7°C'
                  : 'An toàn (T ≤ 7°C)'}
              </div>
            </div>

            {/* Door Status Card */}
            <div
              className={`rounded-2xl p-3 border flex flex-col justify-between transition ${
                anyDoorOpen
                  ? 'bg-amber-950/40 border-amber-500/50'
                  : 'bg-zinc-900/90 border-zinc-800'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Door Status</span>
                {anyDoorOpen ? (
                  <DoorOpen className="w-4 h-4 text-amber-400" />
                ) : (
                  <DoorClosed className="w-4 h-4 text-emerald-400" />
                )}
              </div>
              <div
                className={`text-xl font-mono font-extrabold mt-1 ${
                  anyDoorOpen ? 'text-amber-300' : 'text-emerald-300'
                }`}
              >
                {anyDoorOpen ? 'OPEN' : 'CLOSED'}
              </div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                {anyDoorOpen
                  ? `Đang mở: ${doorOpenSeconds}s / 15s`
                  : 'Đèn LED tủ: OFF'}
              </div>
            </div>
          </div>

          {/* Navigation Tabs for Right Panel */}
          <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl flex-1 flex flex-col overflow-hidden shadow-xl">
            <div className="grid grid-cols-3 border-b border-zinc-800 bg-zinc-950/50 p-1 gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('controls')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'controls'
                    ? 'bg-cyan-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Điều Khiển & Logic</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('mqtt')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'mqtt'
                    ? 'bg-cyan-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>MQTT WebSocket</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('firmware')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'firmware'
                    ? 'bg-cyan-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Code ESP32</span>
              </button>
            </div>

            {/* TAB 1: IOT CONTROLS & TRUTH TABLE */}
            {activeTab === 'controls' && (
              <div className="p-4 flex flex-col gap-4 overflow-y-auto">
                {/* Temperature Control Slider */}
                <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="temp-slider" className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                      <Thermometer className="w-4 h-4 text-cyan-400" />
                      <span>Giả lập Nhiệt độ Cảm biến (T):</span>
                    </label>
                    <span className="font-mono text-sm font-extrabold px-2.5 py-0.5 rounded-lg bg-zinc-900 border border-zinc-700 text-cyan-300">
                      {temperature.toFixed(1)} °C
                    </span>
                  </div>

                  <input
                    id="temp-slider"
                    type="range"
                    min={-5}
                    max={14}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => {
                      setAutoPhysics(false);
                      setFaultSimulation(false);
                      setTemperature(parseFloat(e.target.value));
                    }}
                    className="w-full accent-cyan-400 cursor-pointer h-2 bg-zinc-800 rounded-lg"
                  />

                  <div className="flex justify-between text-[11px] font-mono text-zinc-400 mt-1">
                    <span>-5.0°C (Đông lạnh)</span>
                    <span className="text-emerald-400">0.0°C</span>
                    <span className="text-cyan-400">4.0°C</span>
                    <span className="text-red-400">7.0°C</span>
                    <span>+14.0°C (Quá nhiệt)</span>
                  </div>

                  {/* Quick Test Zone Presets */}
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAutoPhysics(false);
                        setFaultSimulation(false);
                        setTemperature(-1.5);
                        appendHistorySample(-1.5, humidity);
                      }}
                      className={`px-2.5 py-2 rounded-xl border text-left transition ${
                        zone === 'FREEZE_STOP'
                          ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      <div className="text-[10px] font-mono uppercase text-emerald-400 font-bold">
                        Test T ≤ 0°C
                      </div>
                      <div className="text-xs font-bold mt-0.5">Đặt -1.5°C</div>
                      <div className="text-[10px] text-zinc-400">Cool OFF • Buzz OFF</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAutoPhysics(false);
                        setFaultSimulation(false);
                        setTemperature(4.0);
                        appendHistorySample(4.0, humidity);
                      }}
                      className={`px-2.5 py-2 rounded-xl border text-left transition ${
                        zone === 'OPTIMAL_COOL'
                          ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      <div className="text-[10px] font-mono uppercase text-cyan-400 font-bold">
                        Test 0°C &lt; T ≤ 7°C
                      </div>
                      <div className="text-xs font-bold mt-0.5">Đặt +4.0°C</div>
                      <div className="text-[10px] text-zinc-400">Cool ON • Buzz OFF</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAutoPhysics(false);
                        setFaultSimulation(false);
                        setTemperature(9.2);
                        appendHistorySample(9.2, humidity);
                      }}
                      className={`px-2.5 py-2 rounded-xl border text-left transition ${
                        zone === 'HIGH_TEMP_ALARM'
                          ? 'bg-red-950/70 border-red-500 text-red-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      <div className="text-[10px] font-mono uppercase text-red-400 font-bold">
                        Test T &gt; 7°C
                      </div>
                      <div className="text-xs font-bold mt-0.5">Đặt +9.2°C</div>
                      <div className="text-[10px] text-zinc-400">Cool ON • Buzz ON</div>
                    </button>
                  </div>
                </div>

                {/* IoT Control Logic Truth Table (Live Highlighted) */}
                <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>Bảng Trạng Thái Logic Điều Khiển IoT</span>
                    </span>
                    <span className="text-[11px] text-zinc-400">Tự động cập nhật theo T</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-400">
                          <th className="py-1.5 px-2">Điều kiện Nhiệt độ</th>
                          <th className="py-1.5 px-2 text-center">Cooling</th>
                          <th className="py-1.5 px-2 text-center">Buzzer</th>
                          <th className="py-1.5 px-2">Trạng thái Mô phỏng</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 font-mono">
                        <tr
                          className={
                            zone === 'FREEZE_STOP'
                              ? 'bg-emerald-500/15 text-emerald-200 font-bold'
                              : 'text-zinc-400'
                          }
                        >
                          <td className="py-2 px-2">T ≤ 0°C</td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">OFF</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">OFF</span>
                          </td>
                          <td className="py-2 px-2 font-sans text-[11px]">
                            Đủ độ lạnh, quạt dừng quay, đèn Cooling tắt
                          </td>
                        </tr>

                        <tr
                          className={
                            zone === 'OPTIMAL_COOL'
                              ? 'bg-cyan-500/15 text-cyan-200 font-bold'
                              : 'text-zinc-400'
                          }
                        >
                          <td className="py-2 px-2">0°C &lt; T ≤ 7°C</td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                              ON
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">OFF</span>
                          </td>
                          <td className="py-2 px-2 font-sans text-[11px]">
                            Quạt 3D quay, luồng khí lạnh & đèn Cooling sáng
                          </td>
                        </tr>

                        <tr
                          className={
                            zone === 'HIGH_TEMP_ALARM'
                              ? 'bg-red-500/20 text-red-200 font-bold'
                              : 'text-zinc-400'
                          }
                        >
                          <td className="py-2 px-2">T &gt; 7°C</td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                              ON
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-red-500/30 text-red-300 border border-red-500/50">
                              ON
                            </span>
                          </td>
                          <td className="py-2 px-2 font-sans text-[11px]">
                            HIGH TEMPERATURE – COOLING INEFFECTIVE
                          </td>
                        </tr>

                        <tr
                          className={
                            doorTimeoutAlarm
                              ? 'bg-red-500/25 text-red-200 font-bold'
                              : 'text-zinc-400'
                          }
                        >
                          <td className="py-2 px-2">Cửa mở &gt; 15s</td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              Theo T
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-2 py-0.5 rounded bg-red-500/30 text-red-300 border border-red-500/50">
                              ON
                            </span>
                          </td>
                          <td className="py-2 px-2 font-sans text-[11px]">
                            Báo động âm thanh &amp; chớp đèn đỏ (Quên đóng cửa)
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Interactive Door & Thermal Physics Simulation Controls */}
                <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3.5 flex flex-col gap-3">
                  <div className="text-xs font-bold text-zinc-200 flex items-center justify-between">
                    <span>Điều Khiển Cửa Tủ & Mô Phỏng Nhiệt Động Học</span>
                    <span
                      className={`text-[11px] font-mono font-bold ${
                        doorTimeoutAlarm
                          ? 'text-red-400 animate-pulse'
                          : anyDoorOpen
                          ? 'text-amber-300'
                          : 'text-zinc-400'
                      }`}
                    >
                      {anyDoorOpen
                        ? `Mở cửa: ${doorOpenSeconds}s / 15s ${doorTimeoutAlarm ? '(BÁO ĐỘNG!)' : ''}`
                        : 'Đèn trong tủ: TẮT'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={toggleLeftDoor}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition ${
                        doorLeftOpen
                          ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {doorLeftOpen ? <DoorOpen className="w-4 h-4" /> : <DoorClosed className="w-4 h-4" />}
                      <span>{doorLeftOpen ? 'Đóng Cửa Trái' : 'Mở Cửa Trái'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={toggleRightDoor}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition ${
                        doorRightOpen
                          ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {doorRightOpen ? <DoorOpen className="w-4 h-4" /> : <DoorClosed className="w-4 h-4" />}
                      <span>{doorRightOpen ? 'Đóng Cửa Phải' : 'Mở Cửa Phải'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setAutoPhysics(!autoPhysics)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition ${
                        autoPhysics
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {autoPhysics ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{autoPhysics ? 'Đang chạy Vật lý Tự động' : 'Bật Tự động Nhiệt học'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFaultSimulation(!faultSimulation)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition ${
                        faultSimulation
                          ? 'bg-red-500/25 border-red-500 text-red-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>{faultSimulation ? 'Đang giả lập Lỗi Làm Lạnh' : 'Giả lập Lỗi Quá Nhiệt'}</span>
                    </button>
                  </div>

                  {/* Quick Test Button for >15s Door Open Alarm */}
                  <button
                    type="button"
                    onClick={triggerDoorTimeoutTest}
                    className={`w-full py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition ${
                      doorTimeoutAlarm
                        ? 'bg-red-500/25 border-red-500 text-red-200 animate-pulse'
                        : 'bg-zinc-900 border-zinc-800 text-amber-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>
                      {doorTimeoutAlarm
                        ? `Đang Báo Động Mở Cửa Quá 15s (${doorOpenSeconds}s) — Click Cửa để tắt`
                        : 'Test nhanh: Giả lập Mở Cửa > 15 giây (Báo động Đèn + Âm thanh)'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: MQTT OVER WEBSOCKET INTEGRATION */}
            {activeTab === 'mqtt' && (
              <div className="p-4 flex flex-col gap-3.5 overflow-y-auto">
                <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3.5 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Settings className="w-4 h-4 text-cyan-400" />
                      <span>Cấu hình MQTT Broker (WebSocket)</span>
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-cyan-300">
                      {mqttStatus}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <label htmlFor="mqtt-broker-input" className="block text-[11px] text-zinc-400 mb-1">
                        WebSocket Broker URL:
                      </label>
                      <input
                        id="mqtt-broker-input"
                        type="text"
                        value={brokerInput}
                        onChange={(e) => setBrokerInput(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="mqtt-sub-input" className="block text-[11px] text-zinc-400 mb-1">
                          Subscribe Topic (ESP32 → Web):
                        </label>
                        <input
                          id="mqtt-sub-input"
                          type="text"
                          value={topicSubInput}
                          onChange={(e) => setTopicSubInput(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="mqtt-pub-input" className="block text-[11px] text-zinc-400 mb-1">
                          Publish Topic (Web → ESP32):
                        </label>
                        <input
                          id="mqtt-pub-input"
                          type="text"
                          value={topicPubInput}
                          onChange={(e) => setTopicPubInput(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleConnectMqtt}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs transition"
                    >
                      Kết nối MQTT WebSocket
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectMqtt}
                      className="py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs transition"
                    >
                      Chế độ Loopback
                    </button>
                  </div>
                </div>

                {/* Inject Simulated ESP32 JSON Packet */}
                <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3.5 flex flex-col gap-2">
                  <div className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Giả lập Gói Tin JSON Gửi Từ ESP32</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      value={customJsonTemp}
                      onChange={(e) => setCustomJsonTemp(e.target.value)}
                      className="w-24 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-xs"
                      aria-label="Nhiệt độ gói tin JSON"
                    />
                    <span className="text-xs text-zinc-400">°C</span>
                    <button
                      type="button"
                      onClick={handleSimulateIncomingPacket}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-cyan-300 font-semibold text-xs transition"
                    >
                      Bắn gói tin MQTT RX vào Simulator
                    </button>
                  </div>
                </div>

                {/* Live MQTT Packet Inspector Console */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                      <span>MQTT Telemetry Log</span>
                    </span>
                    <button
                      type="button"
                      onClick={clearMqttLogs}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Xóa log
                    </button>
                  </div>
                  <div className="h-44 overflow-y-auto font-mono text-[11px] space-y-1.5 pr-1">
                    {mqttLogs.map((item) => (
                      <div
                        key={item.id}
                        className="p-1.5 rounded bg-zinc-900/90 border border-zinc-800/80 break-all"
                      >
                        <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-0.5">
                          <span
                            className={`font-bold px-1.5 rounded ${
                              item.dir === 'RX'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : item.dir === 'TX'
                                ? 'bg-cyan-500/20 text-cyan-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {item.dir}
                          </span>
                          <span>{item.topic}</span>
                          <span>{item.time}</span>
                        </div>
                        <div className="text-zinc-300">{item.payload}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: ESP32 ARDUINO C++ FIRMWARE CODE */}
            {activeTab === 'firmware' && (
              <div className="p-4 flex flex-col gap-3 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white">
                      Mã nguồn ESP32 (Arduino C++ / PubSubClient)
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Đồng bộ 100% bảng logic điều khiển Cooling & Buzzer của đồ án IoT
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyFirmware}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Đã sao chép' : 'Copy Code'}</span>
                  </button>
                </div>

                <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-cyan-200 overflow-x-auto max-h-[360px] leading-relaxed">
                  <code>{ESP32_FIRMWARE_CODE}</code>
                </pre>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
