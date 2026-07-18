// Client-side multiplayer networking (WebSocket)
// Works on localhost and via Cloudflare Tunnel (https → wss on same host).

export class Network {
  constructor() {
    this.ws = null;
    this.id = null;
    this.username = null;
    this.color = null;
    this.connected = false;
    this.handlers = {};
    this._reconnectTimer = null;
    this._moveThrottle = 0;
    this._clientPingTimer = null;
  }

  on(event, fn) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
  }

  emit(event, data) {
    const list = this.handlers[event];
    if (!list) return;
    for (const fn of list) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }

  /** Resolve WebSocket URL — same host as the page (works with CF Tunnel HTTPS). */
  wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const url = this.wsUrl();
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._startClientPing();
      this.emit('open');
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || !msg.type) return;

      // Reply to server heartbeats (keeps CF Tunnel / proxies happy)
      if (msg.type === 'ping') {
        this.send({ type: 'pong', t: msg.t || Date.now() });
        return;
      }
      if (msg.type === 'pong') return;

      if (msg.type === 'welcome') {
        this.id = msg.id;
        this.username = msg.username;
        this.color = msg.color;
      }

      this.emit(msg.type, msg);
      this.emit('message', msg);
    };

    ws.onclose = () => {
      this.connected = false;
      this._stopClientPing();
      this.emit('close');
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    ws.onerror = () => {
      // onclose will fire after
    };
  }

  _startClientPing() {
    this._stopClientPing();
    // Client→server data every 25s as backup keepalive (CF idle limit ~100s)
    this._clientPingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', t: Date.now() });
      }
    }, 25_000);
  }

  _stopClientPing() {
    if (this._clientPingTimer) {
      clearInterval(this._clientPingTimer);
      this._clientPingTimer = null;
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendMove(x, y, z, yaw, pitch) {
    const now = performance.now();
    if (now - this._moveThrottle < 50) return; // ~20 Hz
    this._moveThrottle = now;
    this.send({ type: 'move', x, y, z, yaw, pitch });
  }

  sendBreak(x, y, z) {
    this.send({ type: 'break', x, y, z });
  }

  sendPlace(x, y, z, block) {
    this.send({ type: 'place', x, y, z, block });
  }

  sendChat(text) {
    this.send({ type: 'chat', text: String(text || '').slice(0, 200) });
  }

  /** Yell — nearby players (within radius) hear it; the yeller hears it too. */
  sendYell(radius = 20) {
    this.send({ type: 'yell', radius: radius | 0 });
  }

  sendSign(x, y, z, text, facing = 0) {
    this.send({ type: 'sign', x, y, z, text, facing: facing | 0 });
  }

  /**
   * Persist full world snapshot on the server (blocks, signs, toads, time).
   * Client sends complete override list so builds survive even if a place packet was lost.
   */
  sendWorldState(critters, time, edits) {
    this.send({
      type: 'world_state',
      critters,
      time,
      blocks: edits?.blocks || [],
      signs: edits?.signs || [],
      chests: edits?.chests || [],
    });
  }

  /** Tell the server a player used a bed — skip night for everyone */
  sendSkipNight() {
    this.send({ type: 'skip_night' });
  }

  /**
   * Publish shared chest inventory at a block (server broadcasts to all players + persists).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {Record<string, number>} items
   */
  sendChestSet(x, y, z, items) {
    this.send({
      type: 'chest_set',
      x: x | 0,
      y: y | 0,
      z: z | 0,
      items: items && typeof items === 'object' ? items : {},
    });
  }

  /** Save Python source for a Code Block and (re)start its script on the server */
  sendCodeSet(x, y, z, code) {
    this.send({
      type: 'code_set',
      x: x | 0,
      y: y | 0,
      z: z | 0,
      code: String(code ?? '').slice(0, 20000),
    });
  }

  /** Set LED Block color (0xRRGGBB or '#rrggbb') */
  sendLedSet(x, y, z, color) {
    this.send({
      type: 'led_set',
      x: x | 0,
      y: y | 0,
      z: z | 0,
      color,
    });
  }

  /**
   * Request a dimension change (portal use).
   * @param {'earth'|'mars'} dimension
   */
  sendChangeDimension(dimension) {
    this.send({
      type: 'change_dimension',
      dimension: dimension === 'mars' ? 'mars' : 'earth',
    });
  }
}
