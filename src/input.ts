export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  clicked = false;
  locked = false;
  sensitivity = 0.0022;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', () => {
      if (this.locked) this.clicked = true;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
  }

  lock(): void {
    if (!this.locked) void this.canvas.requestPointerLock()?.catch?.(() => undefined);
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  axis(): { x: number; y: number } {
    const x = (this.held('KeyD') || this.held('ArrowRight') ? 1 : 0) - (this.held('KeyA') || this.held('ArrowLeft') ? 1 : 0);
    const y = (this.held('KeyW') || this.held('ArrowUp') ? 1 : 0) - (this.held('KeyS') || this.held('ArrowDown') ? 1 : 0);
    return { x, y };
  }

  mouse(): { dx: number; dy: number } {
    const r = { dx: this.dx * this.sensitivity, dy: this.dy * this.sensitivity };
    this.dx = this.dy = 0;
    return r;
  }

  endFrame(): void {
    this.pressed.clear();
    this.clicked = false;
  }
}
