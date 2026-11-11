import 'cesium/Build/Cesium/Widgets/widgets.css';
import * as Cesium from 'cesium';
import {
  createViewer,
  setupImagery,
  ensureViewerSize,
} from './core/viewer.js';
import { CameraController } from './core/cameraController.js';
import { SimClock, getOrbitEpoch } from './core/simClock.js';
import {
  TIME_CONTROL,
  SIMULATION,
  DEFAULT_SIM_PARAMS,
  DEFAULT_SATELLITES,
  MISSION,
  buildSatelliteConfigs,
} from './config/satellite.js';
import { SatelliteRegistry } from './satellites/registry.js';
import { orbitalPeriodSeconds, ensureIcrfReady } from './orbit/propagate.js';
import { GroundStation } from './comm/groundStation.js';
import { ThreeBodyConstellation } from './constellation/threeBody.js';
import { TimeControls } from './ui/timeControls.js';
import { DayJumpControls } from './ui/dayJumpControls.js';
import { SimSettingsControls } from './ui/simSettingsControls.js';
import { MissionHud } from './ui/missionHud.js';
import './style.css';

const { JulianDate } = Cesium;

/** 后台每步最大仿真推进（秒） */
const BG_SIM_CHUNK_SEC = 90;

/** 广汉站面板按 UTC+8 统计“今日” */
const LOCAL_OFFSET_HOURS = 8;

function getLocalDayStart(julianDate) {
  const date = JulianDate.toDate(julianDate);
  const localMs = date.getTime() + LOCAL_OFFSET_HOURS * 3600 * 1000;
  const dayMs = Math.floor(localMs / 86400000) * 86400000;
  return JulianDate.fromDate(
    new Date(dayMs - LOCAL_OFFSET_HOURS * 3600 * 1000),
  );
}

function renderParamDisplay(registry, simClock, simParams) {
  const stats = registry?.getCoverageStats() ?? { satellites: [] };
  const simDays = simClock?.getElapsedSimDays?.()?.toFixed(1) ?? '0.0';
  const configs = [...(registry?.satellites?.values() ?? [])].map(
    (sat) => sat.config,
  );

  const rows = [
    ['任务', MISSION.name],
    ['轨道类型', '晨昏轨道（太阳同步）'],
    ['轨道高度', '525 km（标称）'],
    ['倾角 / 偏心率', '97.5° / 0.001'],
    ['降交点地方时', '18:00'],
    ['卫星数量', `${stats.satellites.length || simParams.satelliteCount} 颗`],
    ['仿真天数', `${simDays} 天`],
  ];

  const detailRows = configs.map((config) => {
    const phase = Number.isFinite(config.orbit.initialPhaseDeg)
      ? config.orbit.initialPhaseDeg.toFixed(1)
      : '—';
    const mass = Number.isFinite(config.massKg)
      ? `${config.massKg.toFixed(3)} kg`
      : '—';
    const uplink = Number.isFinite(config.uplinkMbps)
      ? `${config.uplinkMbps} Mbps`
      : '—';
    const periodMin = (
      orbitalPeriodSeconds(config.orbit.altitudeKm) / 60
    ).toFixed(1);
    return [
      config.name,
      `相位 ${phase}° · ${config.orbit.altitudeKm} km · ${mass} · 上行 ${uplink} · ${config.sensor.swathWidthKm} km 视场 · ${periodMin} min`,
    ];
  });

  document.getElementById('paramDisplay').innerHTML = [
    ...rows.map(
      ([label, value]) =>
        `<div class="param-row"><dt>${label}</dt><dd>${value}</dd></div>`,
    ),
    ...detailRows.map(
      ([label, value]) =>
        `<div class="param-row param-row-sat"><dt>${label}</dt><dd>${value}</dd></div>`,
    ),
  ].join('');
}

function startSimulationLoop(viewer, simClock, registry, timeControls, ctx) {
  const { isJumping, getSimParams } = ctx;
  let lastWall = performance.now();
  let lastBgWall = Date.now();
  let lastUiRefresh = 0;
  let bgTimer = null;

  const syncAndUpdate = () => {
    simClock.syncToViewer(viewer);
    const fastPlayback =
      !simClock.live && simClock.playing && simClock.multiplier >= 100;
    registry.updateAll(simClock.currentTime, { fastPlayback });
    ctx.onSimUpdate?.(simClock.currentTime);
  };

  /** 后台：把墙钟时间拆成多步仿真推进 */
  const advanceBackground = (wallDeltaSec) => {
    if (isJumping() || simClock.live || !simClock.playing || wallDeltaSec <= 0) {
      return;
    }

    let remaining = wallDeltaSec * simClock.multiplier;
    while (remaining > 0.5) {
      const chunk = Math.min(remaining, BG_SIM_CHUNK_SEC);
      JulianDate.addSeconds(
        simClock.currentTime,
        chunk,
        simClock.currentTime,
      );
      simClock.currentTime = simClock.clamp(simClock.currentTime);
      registry.updateAll(simClock.currentTime, {
        fastPlayback: simClock.multiplier >= 100,
      });
      remaining -= chunk;
    }
    simClock.syncToViewer(viewer);
    ctx.onSimUpdate?.(simClock.currentTime);
  };

  const frame = () => {
    const now = performance.now();
    const wallDelta = Math.min((now - lastWall) / 1000, 0.1);
    lastWall = now;

    if (!document.hidden && !isJumping()) {
      simClock.tick(wallDelta);
      syncAndUpdate();

      if (now - lastUiRefresh > 1000) {
        timeControls.refresh();
        renderParamDisplay(registry, simClock, getSimParams());
        ctx.onUiTick?.();
        lastUiRefresh = now;
      }
      viewer.scene.requestRender();
    }

    requestAnimationFrame(frame);
  };

  const startBgTimer = () => {
    if (bgTimer) return;
    lastBgWall = Date.now();
    bgTimer = setInterval(() => {
      const now = Date.now();
      const wallDelta = (now - lastBgWall) / 1000;
      lastBgWall = now;
      advanceBackground(wallDelta);
      viewer.scene.requestRender();
    }, 1000);
  };

  const stopBgTimer = () => {
    if (!bgTimer) return;
    clearInterval(bgTimer);
    bgTimer = null;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lastBgWall = Date.now();
      startBgTimer();
    } else {
      const catchup = (Date.now() - lastBgWall) / 1000;
      stopBgTimer();
      advanceBackground(catchup);
      lastWall = performance.now();
      viewer.scene.requestRender();
    }
  });

  requestAnimationFrame(frame);
}

async function applySimSettings(nextParams, ctx) {
  const { simClock, registry, viewer, timeControls, loadingEl } = ctx;

  if (loadingEl) {
    loadingEl.textContent = '正在应用新参数…';
    loadingEl.classList.remove('hidden');
  }

  simClock.live = false;
  simClock.markSimAnchor();
  simClock.jumpToSimDays(0);

  const configs = buildSatelliteConfigs(nextParams);
  registry.replaceAll(configs);
  await registry.loadAllModels();

  simClock.syncToViewer(viewer);
  registry.updateAll(simClock.currentTime);
  timeControls?.refresh();
  viewer.scene.requestRender();

  if (loadingEl) loadingEl.classList.add('hidden');
}

async function main() {
  const loadingEl = document.getElementById('loadingOverlay');
  const simParams = {
    ...DEFAULT_SIM_PARAMS,
    satellites: DEFAULT_SIM_PARAMS.satellites.map((spec) => ({ ...spec })),
  };

  try {
    const viewer = createViewer('cesiumContainer');

    await new Promise((r) => requestAnimationFrame(r));
    ensureViewerSize(viewer);
    setTimeout(() => ensureViewerSize(viewer), 100);
    setTimeout(() => ensureViewerSize(viewer), 500);

    await setupImagery(viewer);
    ensureViewerSize(viewer);

    const cameraController = new CameraController(viewer);
    cameraController.init();

    ensureViewerSize(viewer);

    if (loadingEl) loadingEl.classList.add('hidden');

    window.addEventListener('resize', () => {
      ensureViewerSize(viewer);
      cameraController.recompute();
    });

    const simClock = new SimClock(TIME_CONTROL.speed1, TIME_CONTROL.speed2);
    simClock.markSimAnchor();

    if (loadingEl) loadingEl.textContent = '正在加载轨道数据…';
    try {
      const now = simClock.currentTime;
      const icrfStart = JulianDate.addDays(now, -30, new JulianDate());
      const icrfStop = JulianDate.addDays(
        now,
        SIMULATION.icrfPreloadDays ?? 400,
        new JulianDate(),
      );
      await ensureIcrfReady(icrfStart, icrfStop);
    } catch (err) {
      console.warn('ICRF preload failed, using Earth-rotation fallback:', err);
    }

    const orbitEpoch = getOrbitEpoch();
    const registry = new SatelliteRegistry(viewer, orbitEpoch);

    registry.registerAll(DEFAULT_SATELLITES);
    await registry.loadAllModels();

    viewer.scene.postRender.addEventListener(() => {
      for (const sat of registry.satellites.values()) {
        if (sat.entity?.label) {
          sat.entity.label = undefined;
        }
      }
    });

    if (loadingEl) {
      loadingEl.textContent = '正在加载广汉站与三体星座…';
      loadingEl.classList.remove('hidden');
    }

    const groundStation = new GroundStation(viewer);
    const constellation = new ThreeBodyConstellation(viewer);
    try {
      await constellation.load();
    } catch (err) {
      console.error('三体星座加载失败，跳过星座层:', err);
    }

    const missionHud = new MissionHud({
      onRecomputePasses: () => recomputePasses({ force: true }),
      onJumpToNextPass: () => jumpToNextPass(),
      onToggleConstellation: (visible) =>
        constellation.setConstellationVisible(visible),
      onToggleLinks: (visible) => constellation.setLinksVisible(visible),
    });

    if (loadingEl) loadingEl.classList.add('hidden');

    const getSatellites = () => [...registry.satellites.values()];

    let lastGroundLinks = [];
    let lastConstellation = null;
    let passes = [];
    let contacts = [];
    let passesDayStart = null;
    let passesComputing = false;

    const updateCommunication = (time) => {
      const satellites = getSatellites();
      lastGroundLinks = groundStation.update(time, satellites);
      lastConstellation = constellation.update(time, satellites);
    };

    const renderMissionHud = () => {
      missionHud.render({
        simClock,
        links: lastGroundLinks,
        constellation: lastConstellation,
      });
    };

    /** 计算/重算今日（UTC+8）过境窗口 */
    function recomputePasses({ force = false } = {}) {
      if (passesComputing) return;

      const dayStart = getLocalDayStart(simClock.currentTime);
      if (
        !force &&
        passesDayStart &&
        JulianDate.equals(dayStart, passesDayStart)
      ) {
        return;
      }

      passesComputing = true;
      missionHud.setPassComputing(true);

      // 先让“计算中”渲染出来，再执行 24h × 10s 采样
      setTimeout(() => {
        try {
          passes = groundStation.computeDailyPasses(
            dayStart,
            getSatellites(),
            { durationHours: 24, stepSec: 10 },
          );
          contacts = constellation.computeDailyContacts(
            dayStart,
            getSatellites(),
            { durationHours: 24, stepSec: 30 },
          );
          passesDayStart = dayStart;
          missionHud.setPasses(passes, passesDayStart);
          missionHud.setContacts(contacts, passesDayStart);
        } catch (err) {
          console.error('每日过境计算失败:', err);
        } finally {
          passesComputing = false;
          missionHud.setPassComputing(false);
          renderMissionHud();
        }
      }, 0);
    }

    function jumpToNextPass() {
      if (!passesDayStart) return;

      const currentSec = JulianDate.secondsDifference(
        simClock.currentTime,
        passesDayStart,
      );
      const next = groundStation.findNextPass(passes, currentSec);
      if (!next) return;

      simClock.live = false;
      simClock.playing = false;
      simClock.activeSpeed = 'paused';
      JulianDate.addSeconds(
        passesDayStart,
        Math.max(0, next.startSec - 15),
        simClock.currentTime,
      );
      simClock.currentTime = simClock.clamp(simClock.currentTime);
      simClock.syncToViewer(viewer);
      registry.updateAll(simClock.currentTime);
      updateCommunication(simClock.currentTime);
      timeControls.refresh();
      renderMissionHud();
      viewer.scene.requestRender();
    }

    const onTimeChange = () => {
      simClock.syncToViewer(viewer);
      registry.updateAll(simClock.currentTime);
      updateCommunication(simClock.currentTime);
      renderParamDisplay(registry, simClock, simParams);
      renderMissionHud();
      viewer.scene.requestRender();
    };

    onTimeChange();

    const timeControls = new TimeControls(simClock, { onChange: onTimeChange });

    let jumping = false;
    const isJumping = () => jumping;

    new DayJumpControls({
      simClock,
      registry,
      viewer,
      setJumping: (value) => {
        jumping = value;
      },
      onJumpComplete: () => {
        onTimeChange();
        recomputePasses();
      },
    });

    new SimSettingsControls({
      initialParams: simParams,
      onApply: async (next) => {
        simParams.satelliteCount = next.satelliteCount;
        simParams.hideAfterCycle = next.hideAfterCycle;
        simParams.satellites = next.satellites.map((spec) => ({ ...spec }));
        await applySimSettings(next, {
          simClock,
          registry,
          viewer,
          timeControls,
          loadingEl,
        });
        updateCommunication(simClock.currentTime);
        renderParamDisplay(registry, simClock, simParams);
        recomputePasses({ force: true });
      },
    });

    recomputePasses({ force: true });

    startSimulationLoop(viewer, simClock, registry, timeControls, {
      isJumping,
      getSimParams: () => simParams,
      onSimUpdate: (time) => updateCommunication(time),
      onUiTick: () => {
        renderMissionHud();
        recomputePasses();
      },
    });

    renderParamDisplay(registry, simClock, simParams);
  } catch (err) {
    console.error(err);
    if (loadingEl) loadingEl.classList.add('hidden');
    showError(err?.message ?? String(err));
  }
}

function showError(message) {
  const banner = document.createElement('div');
  banner.className = 'error-banner';
  banner.textContent = message;
  document.body.appendChild(banner);
}

main();
