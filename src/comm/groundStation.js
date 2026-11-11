import * as Cesium from 'cesium';
import { GROUND_STATION } from '../config/satellite.js';

const {
  Cartesian3,
  Cartographic,
  Color,
  JulianDate,
  LabelStyle,
  VerticalOrigin,
  Math: CesiumMath,
} = Cesium;

const _satPosition = new Cartesian3();
const _toSat = new Cartesian3();
const _normal = new Cartesian3();
const _east = new Cartesian3();
const _north = new Cartesian3();

/**
 * 广汉地面站：可视性计算、每日过境规划与链路可视化
 */
export class GroundStation {
  constructor(viewer) {
    this.viewer = viewer;
    this.ellipsoid = viewer.scene.globe.ellipsoid;
    this.cartographic = Cartographic.fromDegrees(
      GROUND_STATION.longitudeDeg,
      GROUND_STATION.latitudeDeg,
      GROUND_STATION.heightM,
    );
    this.cartesian = this.ellipsoid.cartographicToCartesian(this.cartographic);
    this._linkEntities = new Map();
    this._lastLinks = [];
    this._buildEntity();
  }

  _buildEntity() {
    const color = Color.fromCssColorString('#FFD15C');

    this.entity = this.viewer.entities.add({
      id: `ground-station-${GROUND_STATION.id}`,
      position: this.cartesian,
      point: {
        pixelSize: 13,
        color,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: GROUND_STATION.name,
        font: '600 13px "Segoe UI", sans-serif',
        fillColor: Color.WHITE,
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#0c121c').withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(7, 4),
        pixelOffset: new Cesium.Cartesian2(0, -24),
        verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      ellipse: {
        semiMajorAxis: 350000,
        semiMinorAxis: 350000,
        material: color.withAlpha(0.06),
        outline: true,
        outlineColor: color.withAlpha(0.35),
        outlineWidth: 1,
        height: 0,
      },
    });
  }

  /** 卫星相对地面站的仰角 / 方位角 / 斜距 */
  computeLookAngles(satEcef) {
    const toSat = Cartesian3.subtract(satEcef, this.cartesian, _toSat);
    const rangeM = Cartesian3.magnitude(toSat);
    if (rangeM < 1) {
      return { elevationDeg: 90, azimuthDeg: 0, rangeKm: 0 };
    }

    const normal = this.ellipsoid.geodeticSurfaceNormal(
      this.cartesian,
      _normal,
    );
    let east = Cartesian3.cross(Cartesian3.UNIT_Z, normal, _east);
    if (Cartesian3.magnitudeSquared(east) < 1e-8) {
      east = Cartesian3.cross(Cartesian3.UNIT_X, normal, _east);
    }
    Cartesian3.normalize(east, east);
    const north = Cartesian3.normalize(
      Cartesian3.cross(normal, east, _north),
      _north,
    );

    const upComp = Cartesian3.dot(toSat, normal);
    const eastComp = Cartesian3.dot(toSat, east);
    const northComp = Cartesian3.dot(toSat, north);

    const elevationDeg = CesiumMath.toDegrees(Math.asin(upComp / rangeM));
    let azimuthDeg = CesiumMath.toDegrees(Math.atan2(eastComp, northComp));
    if (azimuthDeg < 0) azimuthDeg += 360;

    return {
      elevationDeg,
      azimuthDeg,
      rangeKm: rangeM / 1000,
    };
  }

  /** 当前时刻各卫星与地面站的链路状态 */
  getLinks(time, satellites) {
    const links = [];
    for (const sat of satellites) {
      const pos = sat.getEcefPosition(time, _satPosition);
      const look = this.computeLookAngles(pos);
      links.push({
        id: sat.config.id,
        name: sat.config.name,
        position: Cartesian3.clone(pos),
        ...look,
        visible: look.elevationDeg >= GROUND_STATION.minElevationDeg,
      });
    }
    return links;
  }

  /** 每帧更新：刷新链路连线，返回最新状态 */
  update(time, satellites) {
    const links = this.getLinks(time, satellites);
    this._lastLinks = links;
    this._syncLinkEntities(links);
    return links;
  }

  _syncLinkEntities(links) {
    const activeIds = new Set();

    for (const link of links) {
      if (!link.visible) continue;
      activeIds.add(link.id);
      const positions = [link.position, this.cartesian];
      let entity = this._linkEntities.get(link.id);

      if (!entity) {
        entity = this.viewer.entities.add({
          id: `ground-link-${link.id}`,
          polyline: {
            positions,
            width: 2,
            arcType: Cesium.ArcType.NONE,
            material: Color.fromCssColorString('#FFD15C').withAlpha(0.9),
          },
        });
        this._linkEntities.set(link.id, entity);
      } else {
        entity.polyline.positions = positions;
      }
    }

    for (const [id, entity] of this._linkEntities) {
      if (!activeIds.has(id)) {
        this.viewer.entities.remove(entity);
        this._linkEntities.delete(id);
      }
    }
  }

  /**
   * 规划一天内的过境窗口
   * @param {Cesium.JulianDate} dayStart 当天 00:00（UTC+8）
   * @param {Array} satellites
   * @param {{ durationHours?: number, stepSec?: number }} options
   * @returns {Array<{satelliteId:string,satelliteName:string,startSec:number,endSec:number,durationSec:number,maxElevationDeg:number,dataMb:number}>}
   */
  computeDailyPasses(dayStart, satellites, options = {}) {
    const durationSec = (options.durationHours ?? 24) * 3600;
    const stepSec = options.stepSec ?? 10;
    const passes = [];
    const scratchTime = new JulianDate();
    const scratchPos = new Cartesian3();

    for (const sat of satellites) {
      let passStart = null;
      let prevT = 0;
      let prevElev = -90;
      let maxElev = -90;

      const evaluate = (t) => {
        JulianDate.addSeconds(dayStart, t, scratchTime);
        sat.getEcefPosition(scratchTime, scratchPos);
        return this.computeLookAngles(scratchPos).elevationDeg;
      };

      const refineCrossing = (t0, e0, t1, e1) => {
        if (Math.abs(e1 - e0) < 1e-6) return t1;
        const ratio =
          (GROUND_STATION.minElevationDeg - e0) / (e1 - e0);
        return t0 + Math.max(0, Math.min(1, ratio)) * (t1 - t0);
      };

      for (let t = 0; t <= durationSec + 0.001; t += stepSec) {
        const elev = evaluate(Math.min(t, durationSec));
        const currentT = Math.min(t, durationSec);

        if (
          passStart === null &&
          elev >= GROUND_STATION.minElevationDeg
        ) {
          passStart =
            currentT === 0
              ? 0
              : refineCrossing(prevT, prevElev, currentT, elev);
          maxElev = elev;
        } else if (passStart !== null) {
          maxElev = Math.max(maxElev, elev);
          if (elev < GROUND_STATION.minElevationDeg) {
            const passEnd = refineCrossing(
              prevT,
              prevElev,
              currentT,
              elev,
            );
            passes.push(
              this._makePass(sat, passStart, passEnd, maxElev),
            );
            passStart = null;
            maxElev = -90;
          }
        }

        prevT = currentT;
        prevElev = elev;
      }

      if (passStart !== null) {
        passes.push(
          this._makePass(sat, passStart, durationSec, maxElev),
        );
      }
    }

    return passes.sort((a, b) => a.startSec - b.startSec);
  }

  _makePass(sat, startSec, endSec, maxElevationDeg) {
    const durationSec = Math.max(0, endSec - startSec);
    return {
      satelliteId: sat.config.id,
      satelliteName: sat.config.name,
      startSec,
      endSec,
      durationSec,
      maxElevationDeg,
      dataMb: (durationSec * GROUND_STATION.downlinkMbps) / 8,
    };
  }

  /** 找到当前时刻之后的下一次过境 */
  findNextPass(passes, currentSec) {
    return passes.find((pass) => pass.startSec > currentSec + 5) ?? null;
  }

  get lastLinks() {
    return this._lastLinks;
  }

  get stationPosition() {
    return this.cartesian;
  }

  destroy() {
    for (const entity of this._linkEntities.values()) {
      this.viewer.entities.remove(entity);
    }
    this._linkEntities.clear();
    if (this.entity) {
      this.viewer.entities.remove(this.entity);
      this.entity = null;
    }
  }
}
