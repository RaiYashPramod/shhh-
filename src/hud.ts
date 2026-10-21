const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface KidStatus {
  name: string;
  color: number;
  caught: boolean;
  isPlayer: boolean;
  seeker: boolean;
}

export class Hud {
  private root = $('hud');
  private timer = $('timer');
  private phase = $('phase');
  private kids = $('kids');
  private promptEl = $('prompt');
  private msg = $('message');
  private dangerEl = $('danger');
  private peekEl = $('peek');
  private sneakEl = $('sneak');
  private lanternEl = $('lantern');
  private blindEl = $('blind');
  private blindNum = $('blind-num');
  private msgTimer = 0;
  private lastKids = '';

  show(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  setClock(seconds: number, label: string, urgent: boolean): void {
    const s = Math.max(0, Math.ceil(seconds));
    const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (this.timer.textContent !== txt) this.timer.textContent = txt;
    if (this.phase.textContent !== label) this.phase.textContent = label;
    this.timer.classList.toggle('urgent', urgent);
  }

  setKids(list: KidStatus[]): void {
    const key = list.map((k) => `${k.name}${k.caught}`).join('|');
    if (key === this.lastKids) return;
    this.lastKids = key;
    this.kids.innerHTML = list
      .map(
        (k) =>
          `<div class="kid ${k.caught ? 'caught' : ''} ${k.isPlayer ? 'me' : ''} ${k.seeker ? 'seeker' : ''}"><span class="dot" style="--c:#${k.color.toString(16).padStart(6, '0')}"></span>${escapeHtml(k.name)}</div>`,
      )
      .join('');
  }

  prompt(text: string | null): void {
    const t = text ?? '';
    if (this.promptEl.textContent !== t) {
      this.promptEl.textContent = t;
      this.promptEl.classList.toggle('on', !!text);
    }
  }

  message(text: string, seconds = 2.2, big = false): void {
    this.msg.textContent = text;
    this.msg.classList.toggle('big', big);
    this.msg.classList.add('on');
    this.msgTimer = seconds;
  }

  danger(v: number): void {
    this.dangerEl.style.opacity = v.toFixed(3);
  }

  peek(kind: string | null): void {
    this.peekEl.className = kind ?? '';
  }

  setRole(seeker: boolean): void {
    this.root.classList.toggle('seeker', seeker);
    this.lantern(true);
  }

  lantern(on: boolean): void {
    this.lanternEl.textContent = on ? 'F · Lantern on' : 'F · Lantern off (stealthy)';
    this.lanternEl.classList.toggle('off', !on);
  }

  // Seeker's eyes-closed screen during the countdown. null hides it.
  blind(seconds: number | null): void {
    this.blindEl.classList.toggle('on', seconds !== null);
    if (seconds !== null && this.blindNum.textContent !== String(seconds)) this.blindNum.textContent = String(seconds);
  }

  sneak(on: boolean): void {
    this.sneakEl.classList.toggle('on', on);
  }

  update(dt: number): void {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.classList.remove('on');
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
