import * as Cesium from 'cesium';
import { GROUND_STATION } from '../config/satellite.js';

const { JulianDate } = Cesium;

/** 广汉站与“今日”均按 UTC+8 统计 */
const LOCAL_OFFSET_HOURS = 8;

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch],
  );
}

function formatOffsetTime(julianDate) {
  const date = JulianDate.toDate(julianDate);
  const local = new Date(
    date.getTime() + LOCAL_OFFSET_HOURS * 3600 * 1000,
  );
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  const ss = String(local.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatClock(dayStart, sec) {
  return formatOffsetTime(JulianDate.addSeconds(dayStart, sec, new JulianDate()));
}

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0 分';
  const totalMinutes = Math.round(sec / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} 时 ${m} 分` : `${m} 分`;
}

/** 通信时长精确到秒 */
function formatPreciseDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0 秒';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function formatData(mb) {
  if (!Number.isFinite(mb) || mb <= 0) return '0 MB';
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * 右侧任务面板：广汉站每日通信 + 三体星座异轨链路
 */
export class MissionHud {
  constructor({
    onRecomputePasses,
    onJumpToNextPass,
    onToggleConstellation,
    onToggleLinks,
  } = {}) {
    this.callbacks = {
      onRecomputePasses,
      onJumpToNextPass,
      onToggleConstellation,
      onToggleLinks,
    };

    this.el = {
      stationName: document.getElementById('commStationName'),
      dayLabel: document.getElementById('commDayLabel'),
      visibleNow: document.getElementById('commVisibleNow'),
      passCount: document.getElementById('commPassCount'),
      totalDuration: document.getElementById('commTotalDuration'),
      totalData: document.getElementById('commTotalData'),
      nextPass: document.getElementById('commNextPass'),
      passList: document.getElementById('commPassList'),
      cbSource: document.getElementById('cbSource'),
      cbCount: document.getElementById('cbCount'),
      cbLinkCount: document.getElementById('cbLinkCount'),
      cbLinkList: document.getElementById('cbLinkList'),
      cbContactCount: document.getElementById('cbContactCount'),
      cbContactDuration: document.getElementById('cbContactDuration'),
      cbNextContact: document.getElementById('cbNextContact'),
      cbContactList: document.getElementById('cbContactList'),
      toggleConstellation: document.getElementById('cbToggleConstellation'),
      toggleLinks: document.getElementById('cbToggleLinks'),
    };

    this._passes = [];
    this._contacts = [];
    this._dayStart = null;
    this._computing = false;
    this._lastLinkHtml = null;
    this._lastContactHtml = null;

    this._bind();
    this._renderStation();
  }

  _bind() {
    document
      .getElementById('btnRecomputePasses')
      ?.addEventListener('click', () =>
        this.callbacks.onRecomputePasses?.(),
      );
    document
      .getElementById('btnJumpNextPass')
      ?.addEventListener('click', () =>
        this.callbacks.onJumpToNextPass?.(),
      );

    this.el.toggleConstellation?.addEventListener('change', (event) => {
      this.callbacks.onToggleConstellation?.(event.target.checked);
    });
    this.el.toggleLinks?.addEventListener('change', (event) => {
      this.callbacks.onToggleLinks?.(event.target.checked);
    });
  }

  _renderStation() {
    if (!this.el.stationName) return;
    const lat = GROUND_STATION.latitudeDeg.toFixed(2);
    const lon = GROUND_STATION.longitudeDeg.toFixed(2);
    this.el.stationName.textContent = `${GROUND_STATION.name} ${lat}°N ${lon}°E`;
  }

  setPassComputing(flag) {
    this._computing = Boolean(flag);
    if (this._computing && this.el.dayLabel) {
      this.el.dayLabel.textContent = '计算中…';
    }
  }

  /** 过境结果由主循环计算后写入 */
  setPasses(passes, dayStart) {
    this._passes = Array.isArray(passes) ? passes : [];
    this._dayStart = dayStart ?? null;
    this._renderPassList();
  }

  /** 仅在过境结果变化时重建列表，避免每秒刷新打断滚动 */
  _renderPassList() {
    const { passList } = this.el;
    if (!passList) return;

    const passes = this._passes;
    const dayStart = this._dayStart;

    if (!dayStart) {
      passList.innerHTML = '';
      return;
    }
    if (!passes.length) {
      passList.innerHTML =
        '<li class="list-empty">今日无可见过境</li>';
      return;
    }

    passList.innerHTML = passes
      .slice(0, 12)
      .map(
        (pass, index) => `<li class="pass-item" data-pass-index="${index}">
          <div class="pass-head"><span>${escapeHtml(pass.satelliteName)}</span><span>${formatClock(dayStart, pass.startSec)} → ${formatClock(dayStart, pass.endSec)}</span></div>
          <div class="pass-sub">通信 ${formatPreciseDuration(pass.durationSec)} · 峰值仰角 ${pass.maxElevationDeg.toFixed(1)}° · ${formatData(pass.dataMb)}</div>
        </li>`,
      )
      .join('');
  }

  /** 异轨通信窗口由主循环计算后写入 */
  setContacts(contacts, dayStart) {
    this._contacts = Array.isArray(contacts) ? contacts : [];
    if (dayStart) this._dayStart = dayStart;
    this._renderContactList();
  }

  _renderContactList() {
    const { cbContactList } = this.el;
    if (!cbContactList) return;

    const contacts = this._contacts;
    const dayStart = this._dayStart;

    if (!dayStart) {
      cbContactList.innerHTML = '';
      this._lastContactHtml = '';
      return;
    }
    if (!contacts.length) {
      cbContactList.innerHTML =
        '<li class="list-empty">今日无异轨通信窗口</li>';
      this._lastContactHtml = '';
      return;
    }

    const html = contacts
      .slice(0, 24)
      .map(
        (contact) => `<li class="pass-item">
          <div class="pass-head"><span>${escapeHtml(contact.ourName)} → ${escapeHtml(contact.cbName)}</span><span>${formatClock(dayStart, contact.startSec)} → ${formatClock(dayStart, contact.endSec)}</span></div>
          <div class="pass-sub">通信 ${formatPreciseDuration(contact.durationSec)} · 平均距离 ${contact.avgDistanceKm.toFixed(0)} km</div>
        </li>`,
      )
      .join('');

    if (html !== this._lastContactHtml) {
      cbContactList.innerHTML = html;
      this._lastContactHtml = html;
    }
  }

  render({ simClock, links, constellation }) {
    this._renderGround(simClock, links);
    this._renderConstellation(constellation, simClock);
  }

  _renderGround(simClock, links) {
    const passes = this._passes;
    const dayStart = this._dayStart;

    if (!this._computing && dayStart) {
      const date = new Date(
        JulianDate.toDate(dayStart).getTime() +
          LOCAL_OFFSET_HOURS * 3600 * 1000,
      );
      this.el.dayLabel.textContent = `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
    }

    const visible = (links ?? []).filter((link) => link.visible);
    this.el.visibleNow.textContent = visible.length
      ? visible.map((link) => link.name).join('、')
      : '无';
    this.el.visibleNow.classList.toggle('is-ok', visible.length > 0);

    this.el.passCount.textContent = `${passes.length} 次`;

    let totalDuration = 0;
    let totalData = 0;
    for (const pass of passes) {
      totalDuration += pass.durationSec;
      totalData += pass.dataMb;
    }
    this.el.totalDuration.textContent = formatDuration(totalDuration);
    this.el.totalData.textContent = formatData(totalData);

    if (!dayStart || !simClock) {
      this.el.nextPass.textContent = '—';
      return;
    }

    const currentSec = JulianDate.secondsDifference(
      simClock.currentTime,
      dayStart,
    );
    const next = passes.find((pass) => pass.startSec > currentSec + 5);

    if (next) {
      this.el.nextPass.textContent = `${formatClock(dayStart, next.startSec)} · ${formatDuration(next.startSec - currentSec)}后`;
    } else {
      this.el.nextPass.textContent = passes.length
        ? '今日已无过境'
        : '今日无可见过境';
    }

    if (!passes.length) return;

    const items = this.el.passList.children;
    for (let i = 0; i < passes.length && i < items.length; i++) {
      const pass = passes[i];
      const item = items[i];
      const active =
        currentSec >= pass.startSec && currentSec <= pass.endSec;
      const done = pass.endSec < currentSec;
      item.classList.toggle('is-active', active);
      item.classList.toggle('is-done', done && !active);
    }
  }

  _renderConstellation(summary, simClock) {
    if (!summary) {
      this.el.cbSource.textContent = '加载中…';
      this.el.cbCount.textContent = '—';
      this.el.cbLinkCount.textContent = '—';
      this.el.cbLinkList.innerHTML = '';
      this._lastLinkHtml = '';
      return;
    }

    const snapshot = summary.snapshotIso
      ? summary.snapshotIso.slice(0, 10)
      : '';
    this.el.cbSource.textContent =
      summary.source === 'live'
        ? '实时 TLE'
        : `内置快照 ${snapshot}`;
    this.el.cbCount.textContent = `${summary.satellites ?? 0} 颗`;

    const tleChip = document.getElementById('topTleChip');
    if (tleChip) {
      tleChip.textContent =
        summary.source === 'live'
          ? `三体星座 TLE 实时 · ${summary.satellites ?? 0} 颗`
          : `三体星座 TLE 快照 · ${summary.satellites ?? 0} 颗`;
    }

    const linkCount = summary.count ?? 0;
    this.el.cbLinkCount.textContent = `${linkCount} 条`;
    this.el.cbLinkCount.classList.toggle('is-ok', linkCount > 0);

    this._renderContactSummary(simClock);

    const linkItems = summary.links ?? [];
    const html = linkItems.length
      ? linkItems
          .map(
            (link) => `<li class="link-item">
              <span>${escapeHtml(link.ourName)} → ${escapeHtml(link.cbName)}</span>
              <strong>${link.distanceKm.toFixed(0)} km</strong>
            </li>`,
          )
          .join('')
      : '<li class="list-empty">当前无满足约束的异轨链路</li>';

    if (html !== this._lastLinkHtml) {
      this.el.cbLinkList.innerHTML = html;
      this._lastLinkHtml = html;
    }
  }

  /** 当前优化：今日异轨次数、累计时长、下一窗口 */
  _renderContactSummary(simClock) {
    const contacts = this._contacts;
    const dayStart = this._dayStart;

    if (this._computing) {
      this.el.cbContactCount.textContent = '计算中…';
      this.el.cbContactDuration.textContent = '—';
      this.el.cbNextContact.textContent = '—';
      return;
    }

    this.el.cbContactCount.textContent = `${contacts.length} 次`;

    let totalDuration = 0;
    for (const contact of contacts) {
      totalDuration += contact.durationSec;
    }
    this.el.cbContactDuration.textContent = formatDuration(totalDuration);

    if (!dayStart || !simClock || contacts.length === 0) {
      this.el.cbNextContact.textContent = contacts.length ? '—' : '今日无';
      return;
    }

    const currentSec = JulianDate.secondsDifference(
      simClock.currentTime,
      dayStart,
    );
    const next = contacts.find(
      (contact) => contact.startSec > currentSec + 5,
    );
    this.el.cbNextContact.textContent = next
      ? `${formatClock(dayStart, next.startSec)} · ${next.cbName}`
      : '今日已无';
  }
}
