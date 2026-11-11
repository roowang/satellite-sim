# XSD-47 / XSD-48 卫星通信仿真

> "星算"计划 02 组计算 III 型 04 / 05 星 · 宇算星河（广州）科技有限公司

基于 Cesium 的三维卫星轨道与通信可视化仿真平台。支持 XSD-47 / XSD-48 双星同轨飞行模拟、广汉站每日星地通信规划，以及与三体星座的异轨激光链路分析。

## 功能特性

### 🛰️ 轨道仿真

- **XSD-47 / XSD-48 双星模型**：525 km 太阳同步晨昏轨道，倾角 97.5°，降交点地方时 18:00，两星相位间隔 15°
- **解析轨道传播**：圆轨道 + 太阳同步条件，支持任意时间的 ECEF 位置解算
- **全球相机锁定视角**：以地心为基准的球面缩放，保证轨道弧段无扭曲
- **可调节参数**：卫星数量、轨道高度、相位、条带宽度

### 📡 广汉站每日通信规划

- **实时可见性**：星地链路仰角、方位角、斜距计算（最低仰角阈值 5°）
- **每日过境时刻表**：24 小时内所有 AOS/LOS 窗口，线性插值精确到秒
- **通信时长与数据量**：按 2 Mbps 下行速率累计当日总数据
- **交互跳转**：一键跳到下一过境时刻，自动触发重算

### 🌌 三体星座异轨通信

- **SGP4 / TLE 传播**：内置 `satellite.js` 对三体星座 12 颗卫星进行标准 SGP4 轨道传播
- **TLE 动态拉取**：运行时优先请求 `citybrain.org` 接口获取最新 TLE，受 CORS 限制时自动回退内置快照
- **异轨激光链路**：3500 km 最大斜距 + 80 km 地球遮挡净空，每星最多 2 条同时链路，单链路 10 Gbps
- **通信计划计算**：按 30 秒步长扫描 24 小时，输出完整的我方卫星 × 三体卫星通信窗口

### 🎨 界面设计

- **深色玻璃仪表盘主题**：参考 onecity.citybrain.org，半透明面板 + 青绿色强调色 + 背景模糊
- **顶部信息栏**：任务标题、广汉站坐标、轨道参数、TLE 状态芯片
- **右侧指标卡**：今日过境次数 / 星地通信时长 / 异轨次数 / 异轨时长
- **可拖动时钟面板**：浮动定位，指针拖动，边界约束
- **响应式布局**：1280px / 1100px / 860px 三档断点

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 构建 | Vite 6 | 原生 ES Modules，零配置启动 |
| 三维引擎 | Cesium 1.125 | Viewer / Entity / Polyline / EllipseGraphics |
| 轨道传播 | satellite.js 5.0（内置 ESM） | SGP4 / TLE / ECI↔ECEF |
| 前端 | 原生 HTML/CSS/JS | 无框架，直接 DOM 操作 |
| 部署 | 静态文件（dist/） | Nginx / Python http.server 均可 |

## 项目结构

```
satellite-sim-main/
├── index.html                    # 入口 HTML（顶部栏 / 左右面板 / 浮动时钟）
├── vite.config.js                # Vite + Cesium 插件，base = /satellite-sim/
├── package.json
├── scripts/
│   └── fix-cesium-path.js        # 构建后修正 Cesium 静态资源路径
└── src/
    ├── main.js                   # 主入口：Viewer / SimClock / 渲染循环 / 面板接入
    ├── style.css                 # 全部样式（深色玻璃主题 + 响应式）
    ├── vendor/
    │   └── satellite.es.js       # 内置 satellite.js 5.0 ESM 构建
    ├── config/
    │   ├── satellite.js          # 任务参数（MISSION / GROUND_STATION / LINK / 卫星配置）
    │   └── threeBodyTle.js       # 三体星座 12 颗卫星 TLE 快照
    ├── core/
    │   ├── viewer.js             # Cesium Viewer 初始化与 Ion token
    │   ├── simClock.js           # 仿真时钟（倍速 / 跳日 / anchor）
    │   └── cameraController.js   # 全球视角相机锁定与缩放
    ├── orbit/
    │   ├── camera.js             # 相机快照 / 全球视角计算
    │   └── propagate.js          # 解析轨道传播（ICRF → Fixed / ECEF）
    ├── satellites/
    │   ├── Satellite.js          # 卫星实体（位置更新 / ECEF 缓存 / 传感器锥）
    │   ├── registry.js           # 卫星注册表（Map + replaceAll）
    │   ├── modelLoader.js        # glTF 模型加载（本地优先，Ion 回退）
    │   └── sensorCone.js         # 传感器覆盖锥
    ├── comm/
    │   └── groundStation.js      # 广汉站实体 / 星地链路 / 每日过境规划
    ├── constellation/
    │   └── threeBody.js          # 三体星座 TLE 加载 / SGP4 / 异轨链路计算
    ├── sensor/
    │   └── coveragePlanner.js    # 覆盖规划（日环 / 区域覆盖）
    ├── swath/
    │   ├── manager.js            # 星下点条带采样与 Fade 控制
    │   ├── geometry.js           # GroundPrimitive 三角形构建
    │   └── fade.js               # 条带颜色渐变（30 天灰化）
    └── ui/
        ├── missionHud.js         # 通信面板 / 星座面板 / 指标卡渲染
        ├── timeControls.js       # 浮动时钟 / 倍速 / 跳转 / 可拖动窗口
        ├── simSettingsControls.js # 左侧仿真设置（保留任务元数据）
        ├── dayJumpControls.js    # 时间轴 scrub
        └── viewControls.js       # 相机视角切换
```

## 快速开始

### 环境要求

- Node.js ≥ 20
- 现代浏览器（Chrome / Edge / Firefox）

### 安装与开发

```bash
# 安装依赖
npm install

# 开发模式（自动打开 http://localhost:5173/satellite-sim/）
npm run dev

# 构建生产包（输出到 dist/）
npm run build

# 本地预览生产包
npm run preview
```

### 部署到 Nginx

构建产物为纯静态文件，上传到服务器后用 Nginx 托管即可。

```bash
# 构建
npm run build

# 上传 dist/ 到服务器
scp -r dist/* user@180.76.120.85:/var/www/satellite-sim/
```

**Nginx 配置示例**：

```nginx
server {
    listen 80;
    server_name 180.76.120.85;

    location /satellite-sim/ {
        alias /var/www/satellite-sim/;
        index index.html;
        try_files $uri $uri/ /satellite-sim/index.html;

        # Cesium 静态资源缓存
        location ~* /cesium/.*\.(js|css|wasm|glb)$ {
            alias /var/www/satellite-sim/cesium/;
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

**简单替代方案**（无 sudo / 无 Nginx）：

```bash
cd /var/www/satellite-sim && python3 -m http.server 8080
# 访问 http://180.76.120.85:8080/satellite-sim/
```

## 关键参数

| 参数 | 值 | 来源 |
|------|----|------|
| XSD-47 发射质量 | 98.965 kg | 《XSD-44～XSD-49 星研制总结报告》 |
| XSD-48 发射质量 | 97.811 kg | 同上 |
| 轨道高度 | 525 km | 同上 |
| 倾角 | 97.5° | 同上 |
| 降交点地方时 | 18:00 | 同上 |
| 轨道周期 | 5708 s（95 min） | 同上 |
| 相位间隔 | 15° | 同上 |
| 广汉站坐标 | 30.98°N, 104.28°E, 500 m | 近似坐标，PDF 未给出 |
| 测控最低仰角 | 5° | 工程经验值 |
| X 频段数传速率 | 2 Mbps | 研制报告 |
| 星间激光链路 | ≤3500 km / 10 Gbps / 每星 2 条 | 报告载荷规格 |

## 三体星座 TLE 说明

| 项目 | 说明 |
|------|------|
| 数据源 | `https://www.citybrain.org/api/satellite/orbit/list` |
| 有效 TLE 数 | 12 条（接口返回 16 条，4 条 line1/line2 为空） |
| CORS 限制 | 仅允许 `https://onecity.citybrain.org` 来源，其他来源 403 |
| 兜底策略 | 内置 2026-11-09 TLE 快照，面板标注来源 |
| SGP4 传播 | `satellite.js@5.0.0` `propagate()` + `gstime()` + `eciToEcf()` |

## 参考

- [Cesium 官方文档](https://cesium.com/docs/)
- [satellite.js 文档](https://github.com/shashwatak/satellite-js)
- onecity.citybrain.org city-earth/online 界面风格参考
