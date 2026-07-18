// In-game multiplayer chat UI
export class Chat {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.panel
   * @param {HTMLElement} opts.log
   * @param {HTMLInputElement} opts.input
   * @param {() => string} opts.getUsername
   * @param {(text: string) => void} opts.onSend
   * @param {() => void} [opts.onOpen]
   * @param {() => void} [opts.onClose]
   */
  constructor(opts) {
    this.panel = opts.panel;
    this.log = opts.log;
    this.input = opts.input;
    this.getUsername = opts.getUsername;
    this.onSend = opts.onSend;
    this.onOpen = opts.onOpen || (() => {});
    this.onClose = opts.onClose || (() => {});
    this.open = false;
    this._maxLines = 80;

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    // Don't let game key handlers steal focus keys while typing
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('keypress', (e) => e.stopPropagation());
  }

  isOpen() {
    return this.open;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    this.open = true;
    this.panel.classList.add('open');
    this.input.value = '';
    // Defer focus so it wins over pointer-lock release timing
    setTimeout(() => this.input.focus(), 0);
    this.onOpen();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.panel.classList.remove('open');
    this.input.blur();
    this.onClose();
  }

  submit() {
    const text = this.input.value.trim().slice(0, 200);
    this.input.value = '';
    if (text) this.onSend(text);
    this.close();
  }

  /**
   * @param {{ username?: string, text: string, system?: boolean }} msg
   */
  append(msg) {
    const line = document.createElement('div');
    line.className = 'chat-line' + (msg.system ? ' system' : '');
    if (msg.system) {
      line.textContent = msg.text;
    } else {
      const name = document.createElement('span');
      name.className = 'chat-user';
      name.textContent = msg.username || '???';
      const body = document.createElement('span');
      body.className = 'chat-text';
      body.textContent = ': ' + msg.text;
      line.appendChild(name);
      line.appendChild(body);
    }
    this.log.appendChild(line);
    while (this.log.children.length > this._maxLines) {
      this.log.removeChild(this.log.firstChild);
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  system(text) {
    this.append({ text, system: true });
  }
}
