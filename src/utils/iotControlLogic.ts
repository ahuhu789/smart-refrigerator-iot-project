import { ThermalZone } from '../types/iot';

/**
 * BẢNG LOGIC ĐIỀU KHIỂN ĐỒ ÁN IoT:
 * - T <= 0°C       -> Cooling: OFF | Buzzer: OFF
 * - 0°C < T <= 7°C -> Cooling: ON  | Buzzer: OFF
 * - T > 7°C        -> Cooling: ON  | Buzzer: ON  (HIGH TEMPERATURE – COOLING INEFFECTIVE)
 */
export function evaluateSmartFridgeLogic(temp: number): {
  cooling: boolean;
  buzzer: boolean;
  zone: ThermalZone;
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
    // Lưu ý quan trọng: Khi nhiệt độ vượt 7°C, Cooling vẫn phải ON đồng thời Buzzer ON
    return {
      cooling: true,
      buzzer: true,
      zone: 'HIGH_TEMP_ALARM',
      statusLabel: 'HIGH TEMPERATURE – COOLING INEFFECTIVE'
    };
  }
}
