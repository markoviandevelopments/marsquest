// On-screen touch controls for mobile / coarse-pointer devices.
// Provides: left joystick (move), right-side look drag, jump / sprint / break / place.

/**
 * Decide whether to show on-screen touch controls.
 *
 * Important: many Windows/Chromebook laptops have touchscreens and report
 * maxTouchPoints > 0 (and sometimes pointer:coarse). Those still have a mouse
 * or trackpad (pointer:fine + hover:hover) and should get desktop controls.
 *
 * Overrides:
 *   ?mobile=1  force on-screen controls
 *   ?mobile=0  force desktop controls
 *
 * @returns {boolean}
 */
export function isMobileDevice() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('mobile') === '1') return true;
    if (params.get('mobile') === '0') return false;
  } catch {
    // ignore
  }

  const ua = navigator.userAgent || '';
  // Avoid bare "Mobile" alone matching odd desktop UAs; require real device tokens
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile Safari|Windows Phone/i.test(ua)
    && !/Windows NT|Macintosh|X11|CrOS/i.test(ua);
  // iPadOS 13+ can report as Macintosh but is still a tablet
  const iPadDesktopUA = /Macintosh/i.test(ua)
    && typeof navigator.maxTouchPoints === 'number'
    && navigator.maxTouchPoints > 1
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(pointer: fine)').matches;

  const mq = typeof window.matchMedia === 'function'
    ? (q) => window.matchMedia(q).matches
    : () => false;

  // Primary pointing device is a mouse/trackpad → desktop (even if touch-capable)
  const hasFinePointer = mq('(pointer: fine)');
  const hasHover = mq('(hover: hover)');
  if (hasFinePointer && hasHover && !uaMobile && !iPadDesktopUA) {
    return false;
  }

  // Clear phone/tablet UA
  if (uaMobile || iPadDesktopUA) return true;

  // Touch-only / coarse primary pointer (typical phones & pure tablets)
  const coarsePrimary = mq('(pointer: coarse)') && !hasFinePointer;
  if (coarsePrimary) return true;

  // Small touch device with no fine pointer (fallback)
  const touchPoints = navigator.maxTouchPoints || 0;
  const shortSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  if (touchPoints > 0 && shortSide > 0 && shortSide <= 820 && !hasFinePointer) {
    return true;
  }

  return false;
}

/**
 * @typedef {object} MobileControlsOptions
 * @property {import('three').Camera} camera
 * @property {{ forward:boolean, backward:boolean, left:boolean, right:boolean, jump:boolean, sprint:boolean }} keys
 * @property {{ break:boolean, place:boolean }} mouse
 * @property {(index: number) => void} [onSelectBlock]
 * @property {number} [lookSensitivity]
 */

export class MobileControls {
  /**
   * @param {HTMLElement} rootEl  #mobile-controls container
   * @param {MobileControlsOptions} options
   */
  constructor(rootEl, options) {
    this.root = rootEl;
    this.camera = options.camera;
    this.keys = options.keys;
    this.mouse = options.mouse;
    this.onSelectBlock = options.onSelectBlock || null;
    this.lookSensitivity = options.lookSensitivity ?? 0.0035;

    this.enabled = false;
    this._lookTouchId = null;
    this._lookLastX = 0;
    this._lookLastY = 0;
    this._joyTouchId = null;
    this._joyActive = false;

    // Ensure YXZ euler order for FPS look
    this.camera.rotation.order = 'YXZ';

    this.base = rootEl.querySelector('#joystick-base');
    this.knob = rootEl.querySelector('#joystick-knob');
    this.joyZone = rootEl.querySelector('#joystick-zone');
    this.btnJump = rootEl.querySelector('#btn-jump');
    this.btnSprint = rootEl.querySelector('#btn-sprint');
    this.btnBreak = rootEl.querySelector('#btn-break');
    this.btnPlace = rootEl.querySelector('#btn-place');
    this.btnPrev = rootEl.querySelector('#btn-prev-block');
    this.btnNext = rootEl.querySelector('#btn-next-block');

    this._bindButtons();
    this._bindJoystick();
    this._bindLook();
    this._preventGestures();
  }

  enable() {
    this.enabled = true;
    this.root.classList.add('active');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mobile-mode');
    // Fade the center hint after a few seconds so it doesn't clutter the view
    const hint = this.root.querySelector('.mobile-hint');
    if (hint) {
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => {
        hint.style.opacity = '0';
        setTimeout(() => { hint.style.display = 'none'; }, 600);
      }, 4000);
    }
  }

  disable() {
    this.enabled = false;
    this.root.classList.remove('active');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mobile-mode');
    this._resetMovement();
    this.mouse.break = false;
    this.mouse.place = false;
  }

  /** Call once per frame if needed (currently a no-op reserved for future smoothing). */
  update() {}

  // --- private --------------------------------------------------------------

  _preventGestures() {
    // Stop pinch-zoom / overscroll while playing on mobile
    const block = (e) => {
      if (!this.enabled) return;
      // Allow default on actual form controls if any; we have none
      if (e.cancelable) e.preventDefault();
    };
    document.addEventListener('gesturestart', block, { passive: false });
    document.addEventListener('gesturechange', block, { passive: false });
    // Prevent double-tap zoom
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      if (!this.enabled) return;
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        if (e.cancelable) e.preventDefault();
      }
      lastTouchEnd = now;
    }, { passive: false });
  }

  _bindButtons() {
    const hold = (el, onDown, onUp) => {
      if (!el) return;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('pressed');
        onDown();
      };
      const up = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        el.classList.remove('pressed');
        onUp();
      };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
      // Mouse fallback (desktop testing with ?mobile=1)
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', up);
    };

    hold(this.btnJump, () => { this.keys.jump = true; }, () => { this.keys.jump = false; });
    hold(this.btnSprint, () => { this.keys.sprint = true; }, () => { this.keys.sprint = false; });
    hold(this.btnBreak, () => { this.mouse.break = true; }, () => { this.mouse.break = false; });
    hold(this.btnPlace, () => { this.mouse.place = true; }, () => { this.mouse.place = false; });

    if (this.btnPrev) {
      this.btnPrev.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onSelectBlock) this.onSelectBlock(-1);
      }, { passive: false });
      this.btnPrev.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.onSelectBlock) this.onSelectBlock(-1);
      });
    }
    if (this.btnNext) {
      this.btnNext.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.onSelectBlock) this.onSelectBlock(1);
      }, { passive: false });
      this.btnNext.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.onSelectBlock) this.onSelectBlock(1);
      });
    }
  }

  _bindJoystick() {
    if (!this.joyZone || !this.base || !this.knob) return;

    const maxRadius = () => {
      const r = this.base.clientWidth / 2;
      return Math.max(36, r - 8);
    };

    const setKnob = (dx, dy) => {
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };

    const applyVector = (dx, dy, radius) => {
      const mag = Math.hypot(dx, dy);
      if (mag < radius * 0.12) {
        this._resetMovement();
        setKnob(0, 0);
        return;
      }
      const nx = dx / radius;
      const ny = dy / radius;
      // Dead-zone + digital keys with analog feel via thresholds
      this.keys.right = nx > 0.25;
      this.keys.left = nx < -0.25;
      this.keys.forward = ny < -0.25;
      this.keys.backward = ny > 0.25;
      // Outer ring auto-sprint when pushing hard forward
      if (mag > radius * 0.85 && this.keys.forward) {
        // don't force sprint off when sprint button is held — only auto-on
        // leave keys.sprint alone if already true from button
      }
      setKnob(dx, dy);
    };

    const onStart = (e) => {
      if (!this.enabled) return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      if (this._joyTouchId !== null && e.changedTouches) return;
      this._joyTouchId = t.identifier ?? 'mouse';
      this._joyActive = true;
      this.base.classList.add('active');
      // Center joystick under finger optionally — keep fixed base, move knob
      const rect = this.base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = t.clientX - cx;
      let dy = t.clientY - cy;
      const max = maxRadius();
      const mag = Math.hypot(dx, dy);
      if (mag > max) {
        dx = (dx / mag) * max;
        dy = (dy / mag) * max;
      }
      applyVector(dx, dy, max);
      if (e.cancelable) e.preventDefault();
    };

    const onMove = (e) => {
      if (!this._joyActive) return;
      const touches = e.changedTouches || [e];
      for (const t of touches) {
        const id = t.identifier ?? 'mouse';
        if (id !== this._joyTouchId) continue;
        const rect = this.base.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = t.clientX - cx;
        let dy = t.clientY - cy;
        const max = maxRadius();
        const mag = Math.hypot(dx, dy);
        if (mag > max) {
          dx = (dx / mag) * max;
          dy = (dy / mag) * max;
        }
        applyVector(dx, dy, max);
        if (e.cancelable) e.preventDefault();
      }
    };

    const onEnd = (e) => {
      const touches = e.changedTouches || [e];
      for (const t of touches) {
        const id = t.identifier ?? 'mouse';
        if (id !== this._joyTouchId) continue;
        this._joyTouchId = null;
        this._joyActive = false;
        this.base.classList.remove('active');
        this._resetMovement();
        setKnob(0, 0);
      }
    };

    this.joyZone.addEventListener('touchstart', onStart, { passive: false });
    this.joyZone.addEventListener('touchmove', onMove, { passive: false });
    this.joyZone.addEventListener('touchend', onEnd, { passive: false });
    this.joyZone.addEventListener('touchcancel', onEnd, { passive: false });
    // Desktop testing
    this.joyZone.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  }

  _resetMovement() {
    this.keys.forward = false;
    this.keys.backward = false;
    this.keys.left = false;
    this.keys.right = false;
  }

  _bindLook() {
    // Drag anywhere on the screen that is NOT a control UI element to look around
    const isControlTarget = (target) => {
      if (!target || !target.closest) return false;
      return !!(
        target.closest('#mobile-controls') ||
        target.closest('#hotbar') ||
        target.closest('#hud-right') ||
        target.closest('#debug') ||
        target.closest('#help')
      );
    };

    const onStart = (e) => {
      if (!this.enabled) return;
      const t = e.changedTouches ? e.changedTouches[0] : null;
      if (!t) return;
      if (isControlTarget(e.target)) return;
      if (this._lookTouchId !== null) return;
      this._lookTouchId = t.identifier;
      this._lookLastX = t.clientX;
      this._lookLastY = t.clientY;
    };

    const onMove = (e) => {
      if (!this.enabled || this._lookTouchId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this._lookTouchId) continue;
        const dx = t.clientX - this._lookLastX;
        const dy = t.clientY - this._lookLastY;
        this._lookLastX = t.clientX;
        this._lookLastY = t.clientY;
        this._applyLook(dx, dy);
        if (e.cancelable) e.preventDefault();
      }
    };

    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookTouchId) {
          this._lookTouchId = null;
        }
      }
    };

    // Attach to document so look works over the canvas
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
  }

  _applyLook(dx, dy) {
    // Yaw (Y) and pitch (X) — same convention as PointerLockControls
    this.camera.rotation.y -= dx * this.lookSensitivity;
    this.camera.rotation.x -= dy * this.lookSensitivity;
    const lim = Math.PI / 2 - 0.01;
    this.camera.rotation.x = Math.max(-lim, Math.min(lim, this.camera.rotation.x));

    // Hide look hint on first real look gesture
    const hint = this.root.querySelector('.mobile-hint');
    if (hint && hint.style.display !== 'none' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      hint.style.opacity = '0';
      clearTimeout(this._hintTimer);
      setTimeout(() => { hint.style.display = 'none'; }, 400);
    }
  }
}
