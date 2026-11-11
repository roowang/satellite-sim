import { formatLocalTime, formatTimezoneBadge } from '../core/simClock.js';

export class TimeControls {
  constructor(simClock, { onChange }) {
    this.simClock = simClock;
    this.onChange = onChange;

    this.btnLive = document.getElementById('btnLive');
    this.btnPlay = document.getElementById('btnPlay');
    this.btnSpeed1 = document.getElementById('btnSpeed1');
    this.btnSpeed2 = document.getElementById('btnSpeed2');
    this.dateDisplay = document.getElementById('watchDate');
    this.timeDisplay = document.getElementById('watchTime');
    this.badgeDisplay = document.getElementById('watchBadge');

    this._bindEvents();
    this._enableDrag();
    this.refresh();
  }

  /** 时钟窗口可拖动为浮动面板 */
  _enableDrag() {
    const panel = document.getElementById('timeBar');
    const handle = document.getElementById('timeBarHandle');
    if (!panel || !handle) return;

    const MARGIN = 8;
    const MIN_TOP = 76;
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const clamp = (x, y) => {
      const rect = panel.getBoundingClientRect();
      const maxX = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
      const maxY = Math.max(
        MIN_TOP,
        window.innerHeight - rect.height - MARGIN,
      );
      return {
        x: Math.min(Math.max(MARGIN, x), maxX),
        y: Math.min(Math.max(MIN_TOP, y), maxY),
      };
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.classList.add('is-dragging');
      dragging = true;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* 指针捕获不可用时仍可拖动 */
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', stopDrag);
      window.addEventListener('pointercancel', stopDrag);
      event.preventDefault();
    });

    function onPointerMove(event) {
      if (!dragging) return;
      const { x, y } = clamp(
        event.clientX - offsetX,
        event.clientY - offsetY,
      );
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    }

    function stopDrag(event) {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* 指针已释放 */
      }
    }

    window.addEventListener('resize', () => {
      if (!panel.style.left) return;
      const rect = panel.getBoundingClientRect();
      const { x, y } = clamp(rect.left, rect.top);
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    });
  }

  _bindEvents() {
    this.btnLive.addEventListener('click', () => {
      this.simClock.goLive();
      this.onChange();
      this.refresh();
    });

    this.btnPlay.addEventListener('click', () => {
      this.simClock.togglePlay();
      this.onChange();
      this.refresh();
    });

    this.btnSpeed1.addEventListener('click', () => {
      this.simClock.setSpeed1();
      this.onChange();
      this.refresh();
    });

    this.btnSpeed2.addEventListener('click', () => {
      this.simClock.setSpeed2();
      this.onChange();
      this.refresh();
    });
  }

  refresh() {
    const { dateLabel, timeLabel } = formatLocalTime(this.simClock.currentTime);
    this.dateDisplay.textContent = dateLabel;
    this.timeDisplay.textContent = timeLabel;
    if (this.badgeDisplay) {
      this.badgeDisplay.textContent = formatTimezoneBadge();
    }

    this.btnLive.classList.toggle('active', this.simClock.live);
    this.btnPlay.classList.toggle('active', this.simClock.playing);
    this.btnPlay.innerHTML = this.simClock.playing
      ? '<svg class="wf-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4"/></svg>'
      : '<svg class="wf-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    this.btnPlay.setAttribute(
      'aria-label',
      this.simClock.playing ? '暂停' : '播放',
    );
    this.btnSpeed1.classList.toggle(
      'active',
      this.simClock.activeSpeed === 'speed1',
    );
    this.btnSpeed2.classList.toggle(
      'active',
      this.simClock.activeSpeed === 'speed2',
    );
  }
}
