# PROJECT: SMART REFRIGERATOR – INTERACTIVE 3D IoT SIMULATOR

Ứng dụng web mô phỏng **Tủ Lạnh Thông Minh 3D (Smart Refrigerator IoT)** phục vụ đồ án môn **Internet of Things (IoT)**, tích hợp mô hình 3D tương tác thời gian thực, bảng điều khiển Telemetry và kết nối vi điều khiển **ESP32 qua giao thức MQTT over WebSocket**.

---

## 1. Tech Stack

- **Frontend Framework**: React 18 + Vite + TypeScript
- **3D Rendering**: Three.js + React Three Fiber (`@react-three/fiber`) + `@react-three/drei`
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Biểu đồ Telemetry**: Recharts
- **Giao thức IoT**: MQTT.js (kết nối MQTT Broker qua WebSocket)
- **Icons**: Lucide React
- **Âm thanh cảnh báo**: Web Audio API Synthesizer (Piezo Buzzer Tone)

---

## 2. Cấu trúc thư mục dự án

```text
smart-refrigerator-iot-project/
├── esp32_firmware/
│   ├── smart_fridge_esp32.ino        # Code Arduino C++ cho mạch ESP32
│   └── platformio.ini                # Cấu hình PlatformIO
├── src/
│   ├── components/
│   │   └── R3F/
│   │       └── SmartFridgeR3F.tsx    # Component 3D viết bằng React Three Fiber & Drei
│   ├── types/
│   │   └── iot.ts                    # Định nghĩa kiểu dữ liệu TypeScript cho IoT Telemetry
│   ├── utils/
│   │   └── iotControlLogic.ts        # Hàm đánh giá logic điều khiển Cooling & Buzzer
│   ├── App.tsx                       # Ứng dụng chính tích hợp 3D Scene, Dashboard, Recharts, MQTT & Zustand
│   ├── main.tsx                      # Điểm khởi chạy React DOM
│   └── index.css                     # Cấu hình Tailwind CSS
├── .env.example                      # Biến môi trường mẫu cho MQTT Broker
├── index.html                        # Trang HTML gốc
├── package.json                      # Danh sách thư viện và scripts
├── postcss.config.js                 # Cấu hình PostCSS cho Tailwind
├── tailwind.config.js                # Cấu hình Tailwind CSS
├── tsconfig.json                     # Cấu hình TypeScript
└── vite.config.ts                    # Cấu hình Vite Bundler
```

---

## 3. Hướng dẫn cài đặt và chạy trên máy tính (Local)

### Yêu cầu hệ thống
- Đã cài đặt **Node.js** (phiên bản `>= 18.x` khuyến nghị).

### Các bước chạy dự án
1. Giải nén file `smart-refrigerator-iot-full-project.zip`.
2. Mở Terminal / Command Prompt tại thư mục dự án và cài đặt thư viện:
   ```bash
   npm install
   ```
3. Khởi chạy server phát triển (Development Server):
   ```bash
   npm run dev
   ```
4. Mở trình duyệt tại địa chỉ hiển thị trên terminal (mặc định là `http://localhost:5173`).

---

## 4. Bảng Logic Điều Khiển IoT

| Nhiệt độ (`T`) | Quạt làm lạnh (`Cooling`) | Còi & Đèn báo động (`Buzzer`) | Trạng thái & Hiển thị |
| :--- | :---: | :---: | :--- |
| **`T ≤ 0°C`** | `OFF` | `OFF` | Đủ độ lạnh sâu, quạt 3D dừng quay, tắt luồng khí lạnh |
| **`0°C < T ≤ 7°C`** | `ON` | `OFF` | Quạt 3D quay mượt, đèn Cooling sáng xanh, hiển thị hạt khí lạnh |
| **`T > 7°C`** | `ON` | `ON` | **Cooling giữ ON**, đèn chớp đỏ, kêu còi Buzzer, cảnh báo `HIGH TEMPERATURE – COOLING INEFFECTIVE` |
