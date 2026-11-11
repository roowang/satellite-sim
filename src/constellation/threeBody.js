import * as Cesium from 'cesium';
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
} from '../vendor/satellite.es.js';
import {
  THREE_BODY_TLE_FALLBACK,
  THREE_BODY_TLE_SNAPSHOT_ISO,
} from '../config/threeBodyTle.js';
import { INTER_SATELLITE_LINK } from '../config/satellite.js';

const { Cartesian3, Color, JulianDate } = Cesium;

const TLE_API_URL =
  'https://www.citybrain.org/api/satellite/orbit/list';
const EARTH_MIN_RADIUS_KM = 6356.752;

const ORBIT_COLORS = [
  '#5EE8F0',
  '#FFB35C',
  '#B8FF5C',
  '#FF8C5C',
  '#8CFF5C',
  '#5C9AFF',
  '#FFD15C',
  '#C85CFF',
  '#5CFFD1',
  '#FF5C8C',
  '#9CC8FF',
  '#E0FF5C',
];

function eciToEcefCartesian(positionEciKm, date, result) {
  const gmst = gstime(date);
  const ecf = eciToEcf(positionEciKm, gmst);
  if (!ecf || !Number.isFinite(ecf.x)) return null;
  return Cartesian3.fromElements(
    ecf.x * 1000,
    ecf.y * 1000,
    ecf.z * 1000,
    result ?? new Cartesian3(),
  );
}

function propagateRecord(record, julianDate, result) {
  const date = JulianDate.toDate(julianDate);
  const pv = propagate(record.satrec, date);
  if (!pv?.position) return null;
  return eciToEcefCartesian(pv.position, date, result);
}

/** 两个航天器之间的视线是否被地球遮挡 */
function hasLineOfSight(a, b, clearanceKm) {
  const ab = Cartesian3.subtract(b, a, new Cartesian3());
  const lenSq = Cartesian3.magnitudeSquared(ab);
  if (lenSq < 1) return false;

  const t = Math.max(
    0,
    Math.min(1, -Cartesian3.dot(a, ab) / lenSq),
  );
  const closest = Cartesian3.add(
    a,
    Cartesian3.multiplyByScalar(ab, t, new Cartesian3()),
    new Cartesian3(),
  );
  return (
    Cartesian3.magnitude(closest) / 1000 >
    EARTH_MIN_RADIUS_KM + clearanceKm
  );
}

/** 合并同一对卫星之间短暂中断的通信窗口 */
function mergeContactWindows(windows, gapSec) {
  const byKey = new Map();
  for (const win of windows) {
    const key = `${win.ourId}->${win.cbId}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(win);
  }

  const merged = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.startSec - b.startSec);
    let current = { ...list[0] };
    for (let i = 1; i < list.length; i++) {
      const next = list[i];
      if (next.startSec - current.endSec <= gapSec) {
        current.endSec = Math.max(current.endSec, next.endSec);
        current.maxDistanceKm = Math.max(
          current.maxDistanceKm,
          next.maxDistanceKm,
        );
        current.distanceSum += next.distanceSum;
        current.samples += next.samples;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }
  return merged;
}

/**
 * 三体计算星座（实时 / 内置 TLE + SGP4）
 * 计算与 XSD-47 / XSD-48 的异轨激光链路。
 */
export class ThreeBodyConstellation {
  constructor(viewer, { onStatus } = {}) {
    this.viewer = viewer;
    this.onStatus = onStatus;
    this.records = [];
    this.pointEntities = new Map();
    this.orbitEntities = new Map();
    this.linkEntities = new Map();
    this.showConstellation = true;
    this.showLinks = true;
    this.source = 'fallback';
    this._lastOrbitUpdateSec = null;
    this._lastSummary = {
      satellites: 0,
      links: [],
      count: 0,
      source: 'fallback',
      snapshotIso: THREE_BODY_TLE_SNAPSHOT_ISO,
    };
  }

  async load() {
    let raw = THREE_BODY_TLE_FALLBACK;
    this.source = 'fallback';

    try {
      const response = await fetch(TLE_API_URL, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        const withTle = Array.isArray(data)
          ? data.filter((item) => item.line1 && item.line2)
          : [];
        if (withTle.length > 0) {
          raw = withTle;
          this.source = 'live';
        }
      }
    } catch (err) {
      console.warn('三体星座实时 TLE 拉取失败，使用内置快照：', err?.message ?? err);
    }

    this.records = raw
      .filter((item) => item.line1 && item.line2)
      .map((item, index) => {
        const satrec = twoline2satrec(item.line1, item.line2);
        return {
          ...item,
          index,
          satelliteId:
            item.satelliteId ?? item.noradId ?? item.seq ?? index,
          name: item.name ?? `三体计算${String(index + 1).padStart(2, '0')}星`,
          shortName: `CB-${String(index + 1).padStart(2, '0')}`,
          color:
            ORBIT_COLORS[index % ORBIT_COLORS.length],
          satrec,
          position: null,
        };
      });

    this._buildEntities();
    this._emitStatus();
    return this.records.length;
  }

  _buildEntities() {
    const now = JulianDate.now();

    for (const record of this.records) {
      const initial = propagateRecord(record, now);
      record.position = initial;

      const pointEntity = this.viewer.entities.add({
        id: `three-body-${record.satelliteId}`,
        position: initial ?? Cartesian3.ZERO,
        point: {
          pixelSize: 5,
          color: Color.fromCssColorString(record.color),
          outlineColor: Color.BLACK,
          outlineWidth: 1,
          show: Boolean(initial),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.pointEntities.set(record.satelliteId, pointEntity);

      const orbitEntity = this.viewer.entities.add({
        id: `three-body-orbit-${record.satelliteId}`,
        polyline: {
          positions: [],
          width: 1,
          arcType: Cesium.ArcType.NONE,
          material: Color.fromCssColorString(record.color).withAlpha(0.28),
          show: false,
        },
      });
      this.orbitEntities.set(record.satelliteId, orbitEntity);
    }

    this._updateOrbitPaths(now, { force: true });
  }

  _updateOrbitPaths(time, { force = false } = {}) {
    const sec = JulianDate.secondsDifference(time, JulianDate.now());
    if (
      !force &&
      this._lastOrbitUpdateSec !== null &&
      Math.abs(sec - this._lastOrbitUpdateSec) < 300
    ) {
      return;
    }
    this._lastOrbitUpdateSec = sec;

    const scratchTime = new JulianDate();
    for (const record of this.records) {
      const entity = this.orbitEntities.get(record.satelliteId);
      if (!entity) continue;

      const meanMotion = Number(record.satrec.no);
      const periodSec =
        Number.isFinite(meanMotion) && meanMotion > 0
          ? (2 * Math.PI * 60) / meanMotion
          : 5700;
      const segments = 72;
      const positions = [];

      for (let i = 0; i <= segments; i++) {
        JulianDate.addSeconds(
          time,
          (periodSec * i) / segments,
          scratchTime,
        );
        const pos = propagateRecord(record, scratchTime);
        if (pos) positions.push(pos);
      }

      entity.polyline.positions = positions;
      entity.polyline.show = this.showConstellation && positions.length > 1;
    }
  }

  update(time, ourSatellites) {
    if (this.records.length === 0) {
      return this._lastSummary;
    }

    for (const record of this.records) {
      const pos = propagateRecord(record, time);
      record.position = pos;
      const entity = this.pointEntities.get(record.satelliteId);
      if (!entity) continue;
      entity.show = this.showConstellation && Boolean(pos);
      if (pos) entity.position = pos;
    }

    if (this.showConstellation) {
      this._updateOrbitPaths(time);
    }

    const links = this.showConstellation
      ? this._computeLinks(time, ourSatellites)
      : [];
    this._syncLinkEntities(links);
    this._lastSummary = {
      satellites: this.records.length,
      links,
      count: links.length,
      source: this.source,
      snapshotIso: THREE_BODY_TLE_SNAPSHOT_ISO,
    };
    return this._lastSummary;
  }

  _computeLinks(time, ourSatellites) {
    if (!this.showLinks) return [];

    const ourEntries = [];
    for (const sat of ourSatellites) {
      const position = sat.getEcefPosition(time);
      if (position) ourEntries.push({ sat, position });
    }

    const cbEntries = [];
    for (const record of this.records) {
      if (record.position) {
        cbEntries.push({ record, position: record.position });
      }
    }

    return this._selectLinks(ourEntries, cbEntries);
  }

  /** 按距离与地球遮挡筛选，单星最多保留 2 条最近链路 */
  _selectLinks(ourEntries, cbEntries) {
    const candidates = [];

    for (const our of ourEntries) {
      for (const cb of cbEntries) {
        if (!cb.position) continue;
        const distanceKm =
          Cartesian3.distance(our.position, cb.position) / 1000;
        if (distanceKm > INTER_SATELLITE_LINK.maxRangeKm) continue;
        if (
          !hasLineOfSight(
            our.position,
            cb.position,
            INTER_SATELLITE_LINK.minEarthClearanceKm,
          )
        ) {
          continue;
        }

        candidates.push({
          ourId: our.sat.config.id,
          ourName: our.sat.config.name,
          cbId: cb.record.satelliteId,
          cbName: cb.record.name,
          cbShortName: cb.record.shortName,
          distanceKm,
          ourPosition: our.position,
          cbPosition: cb.position,
        });
      }
    }

    candidates.sort((a, b) => a.distanceKm - b.distanceKm);

    const selected = [];
    const perSatellite = new Map();
    for (const link of candidates) {
      const count = perSatellite.get(link.ourId) ?? 0;
      if (count >= INTER_SATELLITE_LINK.maxLinksPerSatellite) continue;
      selected.push(link);
      perSatellite.set(link.ourId, count + 1);
    }

    return selected;
  }

  /**
   * 计算某日 24 小时内的异轨通信窗口
   * @param {import('cesium').JulianDate} dayStart 当日 00:00（UTC+8）
   * @returns {{ ourId: string, ourName: string, cbId: number|string, cbName: string,
   *   startSec: number, endSec: number, durationSec: number,
   *   avgDistanceKm: number, maxDistanceKm: number }[]}
   */
  computeDailyContacts(
    dayStart,
    ourSatellites,
    { durationHours = 24, stepSec = 30 } = {},
  ) {
    if (!dayStart || !ourSatellites?.length || this.records.length === 0) {
      return [];
    }

    const totalSec = durationHours * 3600;
    const steps = Math.floor(totalSec / stepSec);
    const scratchTime = new JulianDate();
    const openWindows = new Map();
    const windows = [];

    for (let i = 0; i <= steps; i++) {
      const offsetSec = Math.min(i * stepSec, totalSec);
      JulianDate.addSeconds(dayStart, offsetSec, scratchTime);

      const ourEntries = [];
      for (const sat of ourSatellites) {
        const position = sat.getEcefPosition(scratchTime);
        if (position) ourEntries.push({ sat, position });
      }

      const cbEntries = [];
      for (const record of this.records) {
        const position = propagateRecord(record, scratchTime);
        if (position) cbEntries.push({ record, position });
      }

      const activeKeys = new Set();
      for (const link of this._selectLinks(ourEntries, cbEntries)) {
        const key = `${link.ourId}->${link.cbId}`;
        activeKeys.add(key);

        const existing = openWindows.get(key);
        if (existing) {
          existing.endSec = offsetSec;
          existing.maxDistanceKm = Math.max(
            existing.maxDistanceKm,
            link.distanceKm,
          );
          existing.distanceSum += link.distanceKm;
          existing.samples += 1;
        } else {
          openWindows.set(key, {
            ourId: link.ourId,
            ourName: link.ourName,
            cbId: link.cbId,
            cbName: link.cbName,
            startSec: offsetSec,
            endSec: offsetSec,
            maxDistanceKm: link.distanceKm,
            distanceSum: link.distanceKm,
            samples: 1,
          });
        }
      }

      for (const [key, win] of openWindows) {
        if (!activeKeys.has(key)) {
          windows.push(win);
          openWindows.delete(key);
        }
      }
    }

    for (const win of openWindows.values()) windows.push(win);

    return mergeContactWindows(windows, stepSec * 2)
      .map((win) => ({
        ourId: win.ourId,
        ourName: win.ourName,
        cbId: win.cbId,
        cbName: win.cbName,
        startSec: win.startSec,
        endSec: win.endSec,
        durationSec: Math.max(win.endSec - win.startSec, stepSec),
        avgDistanceKm: win.samples ? win.distanceSum / win.samples : 0,
        maxDistanceKm: win.maxDistanceKm,
      }))
      .sort((a, b) => a.startSec - b.startSec);
  }

  _syncLinkEntities(links) {
    const activeKeys = new Set();

    for (const link of links) {
      const key = `${link.ourId}->${link.cbId}`;
      activeKeys.add(key);
      let entity = this.linkEntities.get(key);

      const alpha = Math.max(
        0.25,
        1 - link.distanceKm / INTER_SATELLITE_LINK.maxRangeKm,
      );
      const material = Color.fromCssColorString('#5EE8F0').withAlpha(
        alpha,
      );
      const positions = [link.ourPosition, link.cbPosition];

      if (!entity) {
        entity = this.viewer.entities.add({
          id: `isl-${key}`,
          polyline: {
            positions,
            width: 1.4,
            arcType: Cesium.ArcType.NONE,
            material,
          },
        });
        this.linkEntities.set(key, entity);
      } else {
        entity.polyline.positions = positions;
        entity.polyline.material = material;
      }
    }

    for (const [key, entity] of this.linkEntities) {
      if (!activeKeys.has(key)) {
        this.viewer.entities.remove(entity);
        this.linkEntities.delete(key);
      }
    }
  }

  setConstellationVisible(visible) {
    this.showConstellation = Boolean(visible);
    for (const entity of this.pointEntities.values()) {
      entity.show = this.showConstellation;
    }
    for (const entity of this.orbitEntities.values()) {
      entity.polyline.show =
        this.showConstellation && entity.polyline.positions.length > 1;
    }
    if (!this.showConstellation) {
      this._clearLinks();
    }
    this.viewer.scene.requestRender();
  }

  setLinksVisible(visible) {
    this.showLinks = Boolean(visible);
    if (!this.showLinks) this._clearLinks();
    this.viewer.scene.requestRender();
  }

  _clearLinks() {
    for (const entity of this.linkEntities.values()) {
      this.viewer.entities.remove(entity);
    }
    this.linkEntities.clear();
  }

  _emitStatus() {
    this.onStatus?.({
      satellites: this.records.length,
      source: this.source,
      snapshotIso: THREE_BODY_TLE_SNAPSHOT_ISO,
      records: this.records,
    });
  }

  get summary() {
    return this._lastSummary;
  }

  destroy() {
    this._clearLinks();
    for (const entity of this.pointEntities.values()) {
      this.viewer.entities.remove(entity);
    }
    this.pointEntities.clear();
    for (const entity of this.orbitEntities.values()) {
      this.viewer.entities.remove(entity);
    }
    this.orbitEntities.clear();
    this.records = [];
  }
}
