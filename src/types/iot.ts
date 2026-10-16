export type ThermalZone = 'FREEZE_STOP' | 'OPTIMAL_COOL' | 'HIGH_TEMP_ALARM';

export interface TelemetryPoint {
  time: string;
  temperature: number;
  humidity: number;
  coolingNum: number;
  buzzerNum: number;
  zone: ThermalZone;
}

export interface MqttLogMessage {
  id: string;
  time: string;
  dir: 'RX' | 'TX' | 'SYS';
  topic: string;
  payload: string;
}

export type CameraPreset = 'overview' | 'display' | 'interior' | 'angled';
