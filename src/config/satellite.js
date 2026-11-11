/** 地球物理常数 */
export const EARTH_RADIUS_KM = 6371.0;
export const MU_EARTH = 398600.4418; // km³/s²

/** 地球自转角速度（恒星日，rad/s）——ECI→ECEF，星下点逐圈西漂 */
export const EARTH_ROTATION_RAD_PER_SEC = 7.2921159e-5;

/** 恒星日长度（秒） */
export const SIDEREAL_DAY_SEC = 86164.0905;

/** 轨道参考历元（惯性系轨道相位起点）：02 组卫星发射入轨时刻 */
export const ORBIT_EPOCH_ISO = '2026-10-14T11:40:00Z';

/**
 * 本次仿真任务：XSD-47 / XSD-48（“星算”计划 02 组计算 III 型 04 / 05 星）
 * 参数来源：《XSD-44～XSD-49 星研制总结报告》
 */
export const MISSION = {
  name: 'XSD-47 / XSD-48',
  title: '“星算”计划 02 组计算 III 型 04 / 05 星',
  operator: '宇算星河（广州）科技有限公司',
  orbit: {
    type: 'sun-sync',
    altitudeKm: 525,
    inclinationDeg: 97.5,
    eccentricity: 0.001,
    ltdnHours: 18,
    periodSec: 5708,
    phaseSeparationDeg: 15,
  },
};

/** 广汉地面站（用户指定） */
export const GROUND_STATION = {
  id: 'guanghan',
  name: '广汉站',
  latitudeDeg: 30.98,
  longitudeDeg: 104.28,
  heightM: 500,
  /** 测控最低仰角 */
  minElevationDeg: 5,
  /** X 频段下行数传 / 遥测速率 */
  downlinkMbps: 2,
  /** 05 星独立 10Mbps 上注通道 */
  uplinkMbps: 10,
  /** 星地激光下行能力 */
  laserDownlinkGbps: 10,
};

/** 异轨星间激光链路约束 */
export const INTER_SATELLITE_LINK = {
  /** 激光终端可靠建链最大斜距 */
  maxRangeKm: 3500,
  /** 视线与地球表面最小净空（避免大气遮挡） */
  minEarthClearanceKm: 80,
  /** 单条链路速率 */
  rateGbps: 10,
  /** 每星 2 套星间/星地激光终端，最多同时保持 2 条异轨链路 */
  maxLinksPerSatellite: 2,
};

/** 仿真时间：仅限制最早时刻，向前播放无上限 */
export const SIMULATION = {
  historyDays: 7,
  unbounded: true,
  /** ICRF 预加载未来天数（长程仿真） */
  icrfPreloadDays: 400,
};

/**
 * 倍速
 * Speed1: 600×；Speed2: 1000×
 */
export const TIME_CONTROL = {
  speed1: 600,
  speed2: 1000,
};

/** 底部时间轴可视窗口（小时），刻度每 5 分钟 */
export const TIMELINE_WINDOW_HOURS = 2;

/** 中国区域边界（用于区域/全球视角） */
export const CHINA_BOUNDS = {
  west: 73,
  south: 18,
  east: 135,
  north: 53,
};

/** 可调参数范围 */
export const PARAM_LIMITS = {
  altitudeKm: { min: 400, max: 800, step: 10, default: 525 },
  swathWidthKm: { min: 20, max: 120, step: 5, default: 60 },
  satelliteCount: { min: 1, max: 12, step: 1, default: 2 },
};

const SATELLITE_COLORS = [
  '#00FFFF',
  '#FF9A5C',
  '#B8FF5C',
  '#FF5CB8',
  '#5C9AFF',
  '#FFD15C',
  '#C85CFF',
  '#5CFFD1',
  '#FF8C5C',
  '#8CFF5C',
  '#5C8CFF',
  '#FF5C8C',
];

/** 04 / 05 星出厂参数（质量、上行速率见研制总结报告） */
export const MISSION_SATELLITES = [
  {
    id: 'xsd-47',
    name: 'XSD-47（04星）',
    altitudeKm: 525,
    swathWidthKm: 60,
    phaseDeg: 0,
    pointColor: '#00E5FF',
    massKg: 98.965,
    uplinkMbps: 2,
  },
  {
    id: 'xsd-48',
    name: 'XSD-48（05星）',
    altitudeKm: 525,
    swathWidthKm: 60,
    phaseDeg: MISSION.orbit.phaseSeparationDeg,
    pointColor: '#FFB35C',
    massKg: 97.811,
    uplinkMbps: 10,
  },
];

const SHARED_MODEL = {
  localUri: `${import.meta.env.BASE_URL}models/satellite.glb`,
  maxLocalSizeMb: 12,
  ionAssetIds: [5015623],
  scale: 1,
  minimumPixelSize: 42,
  maximumPixelSize: 42,
  pitchDeg: 0,
  rollDeg: 0,
  yawDeg: 0,
};

export function satelliteDisplayName(index) {
  if (index < 26) return `卫星 ${String.fromCharCode(65 + index)}`;
  return `卫星 ${index + 1}`;
}

/** @returns {{ altitudeKm: number, swathWidthKm: number }} */
export function createDefaultSatelliteSpec() {
  return {
    altitudeKm: PARAM_LIMITS.altitudeKm.default,
    swathWidthKm: PARAM_LIMITS.swathWidthKm.default,
  };
}

/** @param {number} count */
export function createDefaultSatelliteSpecs(count) {
  return Array.from({ length: count }, () => createDefaultSatelliteSpec());
}

/**
 * 同轨道高度组内均匀分布相位；显式 phaseDeg 保持不变
 * 04 / 05 星按报告要求固定 15° 相位间隔。
 * @param {{ altitudeKm: number, phaseDeg?: number }[]} specs
 */
export function computeInitialPhases(specs) {
  const phases = specs.map((spec) =>
    Number.isFinite(spec.phaseDeg) ? spec.phaseDeg : null,
  );
  const groups = new Map();

  for (let i = 0; i < specs.length; i++) {
    const alt = specs[i].altitudeKm;
    if (!groups.has(alt)) groups.set(alt, []);
    groups.get(alt).push(i);
  }

  for (const indices of groups.values()) {
    const pending = indices.filter((i) => phases[i] === null);
    if (pending.length === 0) continue;
    const n = indices.length;
    pending.forEach((index, j) => {
      phases[index] = (360 / n) * j;
    });
  }

  return phases.map((phase) => phase ?? 0);
}

/**
 * @param {{
 *   satelliteCount: number,
 *   satellites: { altitudeKm: number, swathWidthKm: number }[],
 *   hideAfterCycle?: boolean,
 * }} params
 */
export function buildSatelliteConfigs({
  satelliteCount,
  satellites,
  hideAfterCycle = true,
}) {
  const count = Math.max(
    1,
    Math.min(
      PARAM_LIMITS.satelliteCount.max,
      satelliteCount ?? satellites?.length ?? 1,
    ),
  );

  const specs = [];
  for (let i = 0; i < count; i++) {
    const src = satellites?.[i] ?? createDefaultSatelliteSpec();
    specs.push({
      id: src.id,
      name: src.name,
      altitudeKm: src.altitudeKm ?? PARAM_LIMITS.altitudeKm.default,
      swathWidthKm: src.swathWidthKm ?? PARAM_LIMITS.swathWidthKm.default,
      phaseDeg: src.phaseDeg,
      pointColor: src.pointColor,
      massKg: src.massKg,
      uplinkMbps: src.uplinkMbps,
    });
  }

  const phases = computeInitialPhases(specs);
  const fade = {
    cycleDays: 30,
    /** true: 30 天后隐藏；false: 10 天后保持灰 0.95 / α 0.8 */
    hideAfterCycle,
  };

  return specs.map((spec, index) => {
    const sensor = {
      swathWidthKm: spec.swathWidthKm,
      maxRollDeg: 30,
      rollDeg: 0,
      coverageCellDeg: 0.05,
      coverageMarkStepM: 3000,
    };

    return {
      id: spec.id ?? `sat-${index + 1}`,
      name: spec.name ?? satelliteDisplayName(index),
      massKg: spec.massKg,
      uplinkMbps: spec.uplinkMbps,
      orbit: {
        type: MISSION.orbit.type,
        altitudeKm: spec.altitudeKm,
        inclinationDeg: MISSION.orbit.inclinationDeg,
        initialPhaseDeg: phases[index],
      },
      sensor: { ...sensor },
      fade: { ...fade },
      appearance: {
        pointColor:
          spec.pointColor ??
          SATELLITE_COLORS[index % SATELLITE_COLORS.length],
        pointSize: 14,
        model: { ...SHARED_MODEL },
        sensorCone: { footprintScale: 0.55 },
      },
    };
  });
}

/** 默认双星配置：XSD-47 / XSD-48 */
export const DEFAULT_SIM_PARAMS = {
  satelliteCount: MISSION_SATELLITES.length,
  hideAfterCycle: true,
  satellites: MISSION_SATELLITES.map((spec) => ({ ...spec })),
};

export const DEFAULT_SATELLITES = buildSatelliteConfigs(DEFAULT_SIM_PARAMS);

/** 星下点移动超过此距离（米）时追加条带 */
export const SWATH_SAMPLE_INTERVAL_M = 150;

/** 时间轴跳变超过此秒数时重置条带采样（仅用于 scrub，不影响加速播放） */
export const SWATH_SCRUB_RESET_SEC = 120;

/** Safari 实测可过：15 天 × 2 星 × 80 点/圈 */
export const JUMP_REFERENCE_DAYS = 15;
export const JUMP_REFERENCE_SATELLITES = 2;
export const JUMP_REFERENCE_SAMPLES = 80;

/** 离线跳转默认采样（短跳转用） */
export const JUMP_SAMPLES_PER_ORBIT = 80;

/** 单个 GroundPrimitive 最大四边形数 */
export const SWATH_INSTANCES_PER_PRIMITIVE = 4000;

/**
 * 按「总卫星·天」预算采样（与单星 N 天同公式）
 * 例：双星 30 天 ≡ 单星 60 天 → 同为 40 点/圈
 */
export function computeJumpSamplesPerOrbit(totalSatDays, orbitPeriodSec) {
  const refOrbits = Math.floor((JUMP_REFERENCE_DAYS * 86400) / orbitPeriodSec);
  const targetOrbits = Math.floor((totalSatDays * 86400) / orbitPeriodSec);
  const refInstances = refOrbits * JUMP_REFERENCE_SATELLITES * JUMP_REFERENCE_SAMPLES;
  const scaled = Math.floor(refInstances / Math.max(1, targetOrbits));
  return Math.max(28, Math.min(JUMP_REFERENCE_SAMPLES, scaled));
}
