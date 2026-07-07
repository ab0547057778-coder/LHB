'use strict';

/* ============================================================
   MELODY OF THE FALM (LHB)
   Pure Canvas + JS endless climber.
   Classes: Game, Player, Platform, Lava, Camera, UI, Input, ParticleSystem, Background
   ============================================================ */

// ---------- Utility ----------
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));

// ============================================================
// CHARACTERS + WALLET (persistent progression)
// ============================================================
const CHARACTERS = [
  {
    id: 'ninja', name: 'النينجا', desc: 'متوازن، مثالي للبداية',
    price: 0, passive: 'balanced',
    bodyColor: '#22262e', bodyShade: '#13161b', accent: '#d9432b',
  },
  {
    id: 'shadow', name: 'نينجا الظل', desc: 'قفزة مزدوجة دائمة في الهواء',
    price: 150, passive: 'doubleJump',
    bodyColor: '#241a33', bodyShade: '#160f20', accent: '#9b6bff',
  },
  {
    id: 'phoenix', name: 'نينجا اللهب', desc: 'يمتص أول لمسة حمم كل جولة',
    price: 250, passive: 'shield',
    bodyColor: '#3a1810', bodyShade: '#26100a', accent: '#ff8c3c',
  },
  {
    id: 'frost', name: 'نينجا الجليد', desc: 'الحمم ترتفع أبطأ بنسبة 15%',
    price: 300, passive: 'slowLava',
    bodyColor: '#122530', bodyShade: '#0b1820', accent: '#5fd4ff',
  },
];

class Wallet {
  static getCoins() { return parseInt(localStorage.getItem('ninjaEscapeCoins') || '0', 10); }
  static addCoins(n) { const c = Wallet.getCoins() + n; localStorage.setItem('ninjaEscapeCoins', String(c)); return c; }
  static spendCoins(n) {
    const c = Wallet.getCoins();
    if (c < n) return false;
    localStorage.setItem('ninjaEscapeCoins', String(c - n));
    return true;
  }
  static getOwned() {
    try { return JSON.parse(localStorage.getItem('ninjaEscapeOwned') || '["ninja"]'); }
    catch (e) { return ['ninja']; }
  }
  static addOwned(id) {
    const owned = Wallet.getOwned();
    if (!owned.includes(id)) owned.push(id);
    localStorage.setItem('ninjaEscapeOwned', JSON.stringify(owned));
  }
  static getSelected() { return localStorage.getItem('ninjaEscapeSelected') || 'ninja'; }
  static setSelected(id) { localStorage.setItem('ninjaEscapeSelected', id); }

  static getLeaderboard() {
    try { return JSON.parse(localStorage.getItem('ninjaEscapeLeaderboard') || '[]'); }
    catch (e) { return []; }
  }
  static submitScore(score) {
    const board = Wallet.getLeaderboard();
    board.push({ score, date: Date.now() });
    board.sort((a, b) => b.score - a.score);
    const trimmed = board.slice(0, 10);
    localStorage.setItem('ninjaEscapeLeaderboard', JSON.stringify(trimmed));
    return trimmed;
  }

  static getHaptics() { return localStorage.getItem('ninjaEscapeHaptics') !== 'off'; }
  static setHaptics(v) { localStorage.setItem('ninjaEscapeHaptics', v ? 'on' : 'off'); }
  static getEasyMode() { return localStorage.getItem('ninjaEscapeEasyMode') === 'on'; }
  static setEasyMode(v) { localStorage.setItem('ninjaEscapeEasyMode', v ? 'on' : 'off'); }
}

// ============================================================
// INPUT
// ============================================================
class Input {
  constructor() {
    this.left = false;
    this.right = false;
    this.jumpHeld = false;
    this.jumpPressedTime = -999; // for jump buffering
    this._bindKeyboard();
    this._bindTouch();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.left = true;
      if (['ArrowRight', 'KeyD'].includes(e.code)) this.right = true;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        if (!this.jumpHeld) this.jumpPressedTime = performance.now();
        this.jumpHeld = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.left = false;
      if (['ArrowRight', 'KeyD'].includes(e.code)) this.right = false;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') this.jumpHeld = false;
    });
  }

  _bindTouch() {
    const bindBtn = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const down = (e) => { e.preventDefault(); el.classList.add('pressed'); onDown(); };
      const up = (e) => { if (e) e.preventDefault(); el.classList.remove('pressed'); onUp(); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
      el.addEventListener('mousedown', down);
      window.addEventListener('mouseup', up);
    };

    bindBtn('btn-left', () => this.left = true, () => this.left = false);
    bindBtn('btn-right', () => this.right = true, () => this.right = false);
    bindBtn('btn-jump', () => {
      if (!this.jumpHeld) this.jumpPressedTime = performance.now();
      this.jumpHeld = true;
    }, () => this.jumpHeld = false);
  }

  // Consume the buffered jump press (used by jump buffering)
  consumeJumpBuffer(windowMs) {
    if (performance.now() - this.jumpPressedTime <= windowMs) {
      this.jumpPressedTime = -999;
      return true;
    }
    return false;
  }
}

// ============================================================
// PARTICLE SYSTEM
// ============================================================
class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  spawn(opts) {
    this.particles.push({
      x: opts.x, y: opts.y,
      vx: opts.vx || 0, vy: opts.vy || 0,
      life: opts.life || 1, maxLife: opts.life || 1,
      size: opts.size || 3,
      color: opts.color || '#fff',
      gravity: opts.gravity || 0,
      drag: opts.drag !== undefined ? opts.drag : 0.98,
      shape: opts.shape || 'circle',
      fade: opts.fade !== undefined ? opts.fade : true,
      shrink: opts.shrink !== undefined ? opts.shrink : true,
    });
  }

  spawnSpark(x, y, count = 6) {
    for (let i = 0; i < count; i++) {
      const angle = rand(-Math.PI, 0) - Math.PI / 2;
      const speed = rand(60, 180);
      this.spawn({
        x, y,
        vx: Math.cos(angle) * speed * rand(0.3, 1),
        vy: Math.sin(angle) * speed - rand(40, 100),
        life: rand(0.4, 0.9),
        size: rand(1.5, 3),
        color: Math.random() > 0.5 ? '#ffb347' : '#ffe08a',
        gravity: 400,
        drag: 0.96,
      });
    }
  }

  spawnSmoke(x, y, count = 3) {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: x + rand(-8, 8), y: y + rand(-4, 4),
        vx: rand(-15, 15), vy: rand(-40, -15),
        life: rand(0.8, 1.6),
        size: rand(6, 14),
        color: 'rgba(90,80,80,0.5)',
        gravity: -10,
        drag: 0.98,
      });
    }
  }

  spawnDust(x, y, count = 5) {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x, y,
        vx: rand(-60, 60), vy: rand(-30, -5),
        life: rand(0.25, 0.5),
        size: rand(2, 4),
        color: 'rgba(230,220,210,0.7)',
        gravity: 200,
        drag: 0.9,
      });
    }
  }

  spawnFire(x, y, count = 4) {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: x + rand(-10, 10), y,
        vx: rand(-20, 20), vy: rand(-90, -30),
        life: rand(0.4, 0.8),
        size: rand(3, 7),
        color: Math.random() > 0.5 ? '#ff5b1c' : '#ffb347',
        gravity: -60,
        drag: 0.97,
      });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  draw(ctx, camera) {
    for (const p of this.particles) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = p.fade ? t : 1;
      const size = p.shrink ? p.size * t : p.size;
      ctx.fillStyle = p.color;
      const sx = p.x - camera.x;
      const sy = p.y - camera.y;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(0.5, size), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// CAMERA
// ============================================================
class Camera {
  constructor(viewW, viewH) {
    this.x = 0;
    this.y = 0;
    this.viewW = viewW;
    this.viewH = viewH;
    this.targetY = 0;
    this.shakeAmount = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
  }

  resize(w, h) {
    this.viewW = w;
    this.viewH = h;
  }

  follow(playerY) {
    // camera only moves up; keeps player roughly in lower-middle third
    const desired = playerY - this.viewH * 0.6;
    this.targetY = Math.min(this.targetY, desired);
  }

  addShake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  update(dt) {
    this.y = lerp(this.y, this.targetY, clamp(dt * 6, 0, 1));
    if (this.shakeAmount > 0) {
      this.shakeOffsetX = rand(-1, 1) * this.shakeAmount;
      this.shakeOffsetY = rand(-1, 1) * this.shakeAmount;
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 40);
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
    this.x = this.shakeOffsetX;
  }

  get renderY() {
    return this.y + this.shakeOffsetY;
  }
}

// ============================================================
// PLATFORM
// ============================================================
const PLATFORM_TYPES = { NORMAL: 'normal', MOVING: 'moving', CRUMBLE: 'crumble' };

class Platform {
  constructor(x, y, w, type) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = 14;
    this.type = type;
    this.dead = false;

    // moving platform
    this.moveDir = Math.random() > 0.5 ? 1 : -1;
    this.moveSpeed = rand(35, 65);
    this.moveRange = rand(40, 90);
    this.originX = x;

    // crumble platform
    this.touched = false;
    this.crumbleTimer = 0;
    this.crumbleDelay = 0.5; // starts shaking, then falls after ~2s total
    this.fallSpeed = 0;
    this.shakeSeed = Math.random() * 100;
  }

  update(dt) {
    if (this.type === PLATFORM_TYPES.MOVING) {
      this.x += this.moveDir * this.moveSpeed * dt;
      if (Math.abs(this.x - this.originX) > this.moveRange) {
        this.moveDir *= -1;
        this.x = this.originX + this.moveRange * Math.sign(this.x - this.originX);
      }
    } else if (this.type === PLATFORM_TYPES.CRUMBLE && this.touched) {
      this.crumbleTimer += dt;
      if (this.crumbleTimer > 2.0) {
        this.fallSpeed += 900 * dt;
        this.y += this.fallSpeed * dt;
        if (this.crumbleTimer > 3.2) this.dead = true;
      }
    }
  }

  getRenderX(t) {
    if (this.type === PLATFORM_TYPES.CRUMBLE && this.touched && this.crumbleTimer < 2.0) {
      const shake = Math.sin((t + this.shakeSeed) * 60) * 2;
      return this.x + shake;
    }
    return this.x;
  }

  draw(ctx, camera, t) {
    const sx = this.getRenderX(t) - camera.x;
    const sy = this.y - camera.renderY;
    if (sy < -40 || sy > camera.viewH + 40) return;

    let fade = 1;
    if (this.type === PLATFORM_TYPES.CRUMBLE && this.touched) {
      fade = 1 - clamp((this.crumbleTimer - 2.0) / 1.2, 0, 1);
    }
    ctx.globalAlpha = fade;

    // base rock color per type
    let topColor = '#8a6a52';
    let bodyColor = '#4a3625';
    if (this.type === PLATFORM_TYPES.MOVING) { topColor = '#7a8a6a'; bodyColor = '#3a4a30'; }
    if (this.type === PLATFORM_TYPES.CRUMBLE) { topColor = '#9a6a55'; bodyColor = '#5a3520'; }

    ctx.fillStyle = bodyColor;
    ctx.fillRect(sx, sy, this.w, this.h);
    ctx.fillStyle = topColor;
    ctx.fillRect(sx, sy, this.w, 4);

    // small texture speckles
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let i = 0; i < this.w; i += 10) {
      ctx.fillRect(sx + i + 3, sy + 6, 3, 3);
    }
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// LAVA
// ============================================================
class Lava {
  constructor(startY, speedMult = 1) {
    this.y = startY;
    this.baseSpeed = 22 * speedMult;
    this.growthRate = 0.9 * speedMult;
    this.speed = this.baseSpeed;
    this.time = 0;
  }

  update(dt, particles, camera, slowActive) {
    this.time += dt;
    const activeMult = slowActive ? 0.55 : 1;
    // speed ramps up gradually, capped
    this.speed = clamp(
      (this.baseSpeed + this.time * this.growthRate) * activeMult,
      this.baseSpeed * 0.3,
      130
    );
    this.y -= this.speed * dt;

    // ambient particles near surface
    if (Math.random() < 0.6) {
      particles.spawnFire(rand(camera.x - 20, camera.x + camera.viewW + 20), this.y, 1);
    }
    if (Math.random() < 0.3) {
      particles.spawnSmoke(rand(camera.x, camera.x + camera.viewW), this.y - 10, 1);
    }
  }

  distanceTo(playerY) {
    // positive = lava is still below the player (safe); shrinks toward 0 as it catches up
    return this.y - playerY;
  }

  draw(ctx, camera) {
    const sy = this.y - camera.renderY;
    if (sy > camera.viewH + 60) return;

    const grad = ctx.createLinearGradient(0, sy, 0, sy + 400);
    grad.addColorStop(0, '#fff3b0');
    grad.addColorStop(0.08, '#ffb347');
    grad.addColorStop(0.3, '#ff4d1c');
    grad.addColorStop(1, '#5a0f06');
    ctx.fillStyle = grad;

    // wavy top surface
    ctx.beginPath();
    ctx.moveTo(0, sy + 400);
    ctx.lineTo(0, sy + 12);
    const waveH = 6;
    for (let x = 0; x <= camera.viewW; x += 10) {
      const wy = sy + Math.sin((x + this.time * 80) * 0.045) * waveH + Math.sin((x + this.time * 140) * 0.09) * 3;
      ctx.lineTo(x, wy);
    }
    ctx.lineTo(camera.viewW, sy + 400);
    ctx.closePath();
    ctx.fill();

    // glow above surface
    const glow = ctx.createLinearGradient(0, sy - 60, 0, sy + 10);
    glow.addColorStop(0, 'rgba(255,120,40,0)');
    glow.addColorStop(1, 'rgba(255,140,50,0.35)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, sy - 60, camera.viewW, 70);
  }
}

// ============================================================
// COIN & POWERUP PICKUPS
// ============================================================
class Coin {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = 7;
    this.collected = false;
    this.bobSeed = Math.random() * 10;
    this.spin = Math.random() * 10;
  }

  update(dt, magnetTarget) {
    this.spin += dt * 4;
    if (magnetTarget) {
      const dx = magnetTarget.x - this.x;
      const dy = magnetTarget.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 150 && d > 1) {
        const pull = 280;
        this.x += (dx / d) * pull * dt;
        this.y += (dy / d) * pull * dt;
      }
    }
  }

  draw(ctx, camera, t) {
    const sx = this.x - camera.x;
    const sy = this.y - camera.renderY + Math.sin(t * 3 + this.bobSeed) * 3;
    if (sy < -30 || sy > camera.viewH + 30) return;
    ctx.save();
    ctx.translate(sx, sy);
    const squish = Math.max(0.25, Math.abs(Math.cos(this.spin)));
    ctx.scale(squish, 1);
    const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, this.r);
    grad.addColorStop(0, '#fff6c8');
    grad.addColorStop(0.55, '#ffcf4d');
    grad.addColorStop(1, '#c9860f');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

const POWERUP_TYPES = { SHIELD: 'shield', MAGNET: 'magnet', SLOW: 'slow', DOUBLE: 'double' };
const POWERUP_COLORS = { shield: '#5fd4ff', magnet: '#ff5b9c', slow: '#7ee787', double: '#ffd166' };
const POWERUP_GLYPH = { shield: '🛡', magnet: '🧲', slow: '❄', double: '⏫' };

class Powerup {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.r = 11;
    this.collected = false;
    this.bobSeed = Math.random() * 10;
  }

  draw(ctx, camera, t) {
    const sx = this.x - camera.x;
    const sy = this.y - camera.renderY + Math.sin(t * 2.4 + this.bobSeed) * 3;
    if (sy < -30 || sy > camera.viewH + 30) return;
    const color = POWERUP_COLORS[this.type] || '#ffffff';
    ctx.save();
    ctx.translate(sx, sy);

    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
    glow.addColorStop(0, color + 'aa');
    glow.addColorStop(1, color + '00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(15,10,10,0.78)';
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWERUP_GLYPH[this.type] || '?', 0, 1);
    ctx.restore();
  }
}


class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.w = 20;
    this.h = 28;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.grounded = false;
    this.dead = false;

    // tuning
    this.accel = 1500;
    this.decel = 1700;
    this.airAccel = 1100;
    this.maxSpeed = 200;
    this.gravity = 1450;
    this.fallGravityMult = 1.2;
    this.jumpVelocity = -580;
    this.jumpCutMult = 0.45;
    this.coyoteTime = 0.13;
    this.jumpBufferWindow = 160; // ms

    this.coyoteTimer = 0;
    this.state = 'idle'; // idle, run, jump, fall, death
    this.animTime = 0;
    this.squash = 1;
    this.stretch = 1;
    this.currentPlatform = null;

    // character skin + passive (defaults = base ninja)
    this.bodyColor = '#22262e';
    this.bodyShade = '#13161b';
    this.scarfColor = '#d9432b';
    this.hasInnateDoubleJump = false;
    this.usedAirJump = false;
    this.hapticsEnabled = true;
  }

  applyCharacter(char) {
    if (!char) return;
    this.character = char;
    this.bodyColor = char.bodyColor;
    this.bodyShade = char.bodyShade;
    this.scarfColor = char.accent;
    this.hasInnateDoubleJump = char.passive === 'doubleJump';
  }

  update(dt, input, platforms, particles, camera, powerups) {
    if (this.dead) {
      this.vy += this.gravity * dt;
      this.y += this.vy * dt;
      this.animTime += dt;
      return;
    }

    const prevFeetY = this.y + this.h;

    // --- horizontal movement ---
    const wantLeft = input.left;
    const wantRight = input.right;
    const dir = (wantRight ? 1 : 0) - (wantLeft ? 1 : 0);

    const a = this.grounded ? this.accel : this.airAccel;
    if (dir !== 0) {
      this.vx += dir * a * dt;
      this.vx = clamp(this.vx, -this.maxSpeed, this.maxSpeed);
      this.facing = dir;
    } else {
      const d = this.grounded ? this.decel : this.decel * 0.5;
      if (this.vx > 0) this.vx = Math.max(0, this.vx - d * dt);
      else if (this.vx < 0) this.vx = Math.min(0, this.vx + d * dt);
    }

    // --- coyote time bookkeeping ---
    if (this.grounded) this.coyoteTimer = this.coyoteTime;
    else this.coyoteTimer -= dt;

    // --- jump (buffered + coyote) ---
    const wantsJump = input.consumeJumpBuffer(this.jumpBufferWindow);
    if (wantsJump && this.coyoteTimer > 0) {
      this.vy = this.jumpVelocity;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.squash = 1.3;
      this.stretch = 0.7;
      particles.spawnDust(this.x + this.w / 2, this.y + this.h, 8);
      camera.addShake(2);
      if (this.onJump) this.onJump();
    } else if (
      wantsJump && !this.grounded && !this.usedAirJump &&
      (this.hasInnateDoubleJump || (powerups && powerups.doubleJumpTimer > 0))
    ) {
      // mid-air double jump: innate (Shadow ninja) or from a temporary power-up
      this.vy = this.jumpVelocity * 0.88;
      this.usedAirJump = true;
      this.squash = 1.25;
      this.stretch = 0.75;
      particles.spawnSpark(this.x + this.w / 2, this.y + this.h / 2, 10);
      camera.addShake(3);
      if (this.onJump) this.onJump();
    }

    // variable jump height (short hop if released early)
    if (!input.jumpHeld && this.vy < 0) {
      this.vy *= Math.pow(this.jumpCutMult, dt * 8);
    }

    // --- gravity ---
    const g = this.vy > 0 ? this.gravity * this.fallGravityMult : this.gravity;
    this.vy += g * dt;
    this.vy = Math.min(this.vy, 900);

    // --- integrate ---
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // carry on moving platform
    if (this.grounded && this.currentPlatform && this.currentPlatform.type === PLATFORM_TYPES.MOVING) {
      this.x += this.currentPlatform.moveDir * this.currentPlatform.moveSpeed * dt;
    }

    // --- platform collision (only when falling) ---
    this.grounded = false;
    const prevPlatform = this.currentPlatform;
    this.currentPlatform = null;
    if (this.vy >= 0) {
      for (const p of platforms) {
        if (p.dead) continue;
        const feetY = this.y + this.h;
        const withinX = this.x + this.w * 0.2 < p.x + p.w && this.x + this.w * 0.8 > p.x;
        // swept check: did the feet cross the platform's surface this frame?
        const wasAbove = prevFeetY <= p.y + 6;
        const nowBelowTop = feetY >= p.y && feetY <= p.y + p.h + 16;
        if (withinX && wasAbove && nowBelowTop) {
          this.y = p.y - this.h;
          this.vy = 0;
          this.grounded = true;
          this.usedAirJump = false;
          this.currentPlatform = p;
          if (p.type === PLATFORM_TYPES.CRUMBLE && !p.touched) {
            p.touched = true;
          }
          if (prevPlatform !== p) {
            particles.spawnDust(this.x + this.w / 2, this.y + this.h, 5);
          }
          break;
        }
      }
    }

    // squash/stretch recovery
    this.squash = lerp(this.squash, 1, clamp(dt * 8, 0, 1));
    this.stretch = lerp(this.stretch, 1, clamp(dt * 8, 0, 1));
    if (!this.grounded && this.vy < -50) { this.stretch = 1.15; this.squash = 0.9; }

    // --- state machine ---
    if (!this.grounded) {
      this.state = this.vy < 0 ? 'jump' : 'fall';
    } else {
      this.state = Math.abs(this.vx) > 15 ? 'run' : 'idle';
    }
    this.animTime += dt;

    // run dust
    if (this.state === 'run' && this.grounded && Math.random() < 0.25) {
      particles.spawnDust(this.x + this.w / 2, this.y + this.h, 1);
    }
  }

  kill(particles, camera) {
    if (this.dead) return;
    this.dead = true;
    this.state = 'death';
    this.vy = -300;
    this.vx *= 0.3;
    particles.spawnFire(this.x + this.w / 2, this.y + this.h / 2, 20);
    particles.spawnSpark(this.x + this.w / 2, this.y + this.h / 2, 14);
    camera.addShake(10);
    if (navigator.vibrate && this.hapticsEnabled) navigator.vibrate([30, 40, 60]);
  }

  draw(ctx, camera) {
    const sx = this.x - camera.x;
    const sy = this.y - camera.renderY;
    ctx.save();
    ctx.translate(sx + this.w / 2, sy + this.h);
    ctx.scale(this.facing * this.squash, this.stretch);

    if (this.dead) {
      ctx.globalAlpha = 0.85;
      ctx.rotate(Math.sin(this.animTime * 6) * 0.3);
    }

    this._drawNinja(ctx);
    ctx.restore();
  }

  _drawNinja(ctx) {
    const w = this.w, h = this.h;
    const bob = (this.state === 'idle') ? Math.sin(this.animTime * 3) * 1 : 0;
    const runCycle = Math.sin(this.animTime * 14);

    const bodyColor = this.bodyColor;
    const bodyShade = this.bodyShade;
    const skinColor = '#e8b88a';
    const scarfColor = this.scarfColor;
    const eyeColor = '#ffffff';

    // legs
    ctx.fillStyle = bodyShade;
    if (this.state === 'run') {
      const legOffset = runCycle * 5;
      ctx.fillRect(-w / 2 + 3, -10, 5, 10 + legOffset * 0.2);
      ctx.fillRect(w / 2 - 8, -10, 5, 10 - legOffset * 0.2);
    } else if (this.state === 'jump' || this.state === 'fall') {
      ctx.fillRect(-w / 2 + 3, -12, 5, 9);
      ctx.fillRect(w / 2 - 8, -12, 5, 9);
    } else {
      ctx.fillRect(-w / 2 + 3, -10 + bob, 5, 10);
      ctx.fillRect(w / 2 - 8, -10 + bob, 5, 10);
    }

    // body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-w / 2, -h + 8 + bob, w, h - 16);

    // scarf (trails opposite facing when moving/jumping)
    ctx.fillStyle = scarfColor;
    const scarfWave = Math.sin(this.animTime * 10) * 3;
    ctx.fillRect(-w / 2 - 2, -h + 10 + bob, 6, 4);
    ctx.fillRect(-w / 2 - 6 - scarfWave * 0.3, -h + 13 + bob, 6, 3);

    // head
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-w / 2 + 1, -h + bob, w - 2, 12);
    // face strip
    ctx.fillStyle = skinColor;
    ctx.fillRect(-w / 2 + 3, -h + 5 + bob, w - 6, 5);
    // eyes
    ctx.fillStyle = eyeColor;
    if (this.state === 'death') {
      ctx.fillStyle = '#ff5b3d';
      ctx.fillRect(-2, -h + 6 + bob, 3, 2);
      ctx.fillRect(3, -h + 6 + bob, 3, 2);
    } else {
      ctx.fillRect(1, -h + 6 + bob, 4, 3);
    }

    // arms
    ctx.fillStyle = bodyColor;
    if (this.state === 'run') {
      const armOffset = -runCycle * 4;
      ctx.fillRect(-w / 2 - 2, -h + 14 + bob + armOffset * 0.3, 4, 8);
      ctx.fillRect(w / 2 - 2, -h + 14 + bob - armOffset * 0.3, 4, 8);
    } else if (this.state === 'jump') {
      ctx.fillRect(-w / 2 - 2, -h + 10 + bob, 4, 8);
      ctx.fillRect(w / 2 - 2, -h + 10 + bob, 4, 8);
    } else {
      ctx.fillRect(-w / 2 - 2, -h + 14 + bob, 4, 8);
      ctx.fillRect(w / 2 - 2, -h + 14 + bob, 4, 8);
    }
  }
}

// ============================================================
// BACKGROUND (parallax volcano scene)
// ============================================================
class Background {
  constructor() {
    this.stars = [];
    for (let i = 0; i < 40; i++) {
      this.stars.push({ x: Math.random(), y: Math.random() * 0.5, size: rand(1, 2.2), tw: Math.random() * 10 });
    }
    this.smokePuffs = [];
    for (let i = 0; i < 8; i++) {
      this.smokePuffs.push({ x: Math.random(), y: rand(0.1, 0.4), size: rand(60, 140), speed: rand(3, 8), seed: Math.random() * 100 });
    }
    this.time = 0;
  }

  update(dt) {
    this.time += dt;
  }

  draw(ctx, camera, viewW, viewH) {
    // sky gradient shifts with height (deeper = darker/redder, higher = calmer night)
    const heightFactor = clamp(-camera.renderY / 3000, 0, 1);
    const sky = ctx.createLinearGradient(0, 0, 0, viewH);
    const topColor = lerpColor([10, 5, 12], [8, 6, 20], heightFactor);
    const midColor = lerpColor([60, 20, 15], [30, 15, 30], heightFactor);
    const botColor = lerpColor([120, 40, 20], [50, 25, 45], heightFactor);
    sky.addColorStop(0, rgb(topColor));
    sky.addColorStop(0.55, rgb(midColor));
    sky.addColorStop(1, rgb(botColor));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, viewW, viewH);

    // stars (very slow parallax, fade in higher up)
    ctx.globalAlpha = heightFactor;
    for (const s of this.stars) {
      const tw = 0.6 + 0.4 * Math.sin(this.time * 2 + s.tw);
      ctx.fillStyle = `rgba(255,240,220,${tw})`;
      const px = s.x * viewW;
      const py = s.y * viewH + (camera.renderY * 0.02) % viewH;
      ctx.fillRect(px, py, s.size, s.size);
    }
    ctx.globalAlpha = 1;

    // far volcano silhouette layer (parallax 0.15)
    this._drawMountainLayer(ctx, camera, viewW, viewH, 0.15, '#3a1810', -0.55);
    // mid layer
    this._drawMountainLayer(ctx, camera, viewW, viewH, 0.3, '#5a2413', -0.4);
    // drifting smoke puffs
    for (const p of this.smokePuffs) {
      const py = (p.y * viewH - camera.renderY * 0.25 - this.time * p.speed) % (viewH + 200);
      const wrappedY = py < -200 ? py + viewH + 400 : py;
      ctx.fillStyle = 'rgba(60,45,45,0.18)';
      ctx.beginPath();
      ctx.ellipse(p.x * viewW + Math.sin(this.time * 0.3 + p.seed) * 20, wrappedY, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawMountainLayer(ctx, camera, viewW, viewH, parallax, color, baseYRatio) {
    const offset = -camera.renderY * parallax;
    const baseY = viewH * (1 - 0.15) + (offset % (viewH * 1.5));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, viewH);
    ctx.lineTo(0, baseY);
    ctx.lineTo(viewW * 0.25, baseY - viewH * 0.18);
    ctx.lineTo(viewW * 0.5, baseY - viewH * 0.05);
    ctx.lineTo(viewW * 0.75, baseY - viewH * 0.22);
    ctx.lineTo(viewW, baseY - viewH * 0.02);
    ctx.lineTo(viewW, viewH);
    ctx.closePath();
    ctx.fill();
  }
}

function lerpColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function rgb(c) {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

// ============================================================
// UI (DOM binding layer)
// ============================================================
class UI {
  constructor(game) {
    this.game = game;
    this.startScreen = document.getElementById('start-screen');
    this.pauseScreen = document.getElementById('pause-screen');
    this.gameoverScreen = document.getElementById('gameover-screen');
    this.hud = document.getElementById('hud');
    this.mobileControls = document.getElementById('mobile-controls');
    this.scoreDisplay = document.getElementById('score-display');
    this.hudBest = document.getElementById('hud-best');
    this.hudCoins = document.getElementById('hud-coins');
    this.hudBuffs = document.getElementById('hud-buffs');
    this.hudMultiplier = document.getElementById('hud-multiplier');
    this.milestoneFlash = document.getElementById('milestone-flash');
    this.startBestScore = document.getElementById('start-best-score');
    this.walletChip = document.getElementById('wallet-chip');
    this.walletChip2 = document.getElementById('wallet-chip-2');
    this.finalScore = document.getElementById('final-score');
    this.finalBest = document.getElementById('final-best');
    this.finalCoins = document.getElementById('final-coins');
    this.finalWallet = document.getElementById('final-wallet');
    this.newBestBadge = document.getElementById('new-best-badge');
    this.leaderboardList = document.getElementById('leaderboard-list');
    this.soundBtn = document.getElementById('sound-toggle-btn');

    this.characterScreen = document.getElementById('character-select-screen');
    this.characterList = document.getElementById('character-list');
    this.settingsScreen = document.getElementById('settings-screen');
    this.hapticsToggle = document.getElementById('haptics-toggle');
    this.easyModeToggle = document.getElementById('easymode-toggle');

    document.getElementById('play-btn').addEventListener('click', () => this.game.start());
    document.getElementById('pause-btn').addEventListener('click', () => this.game.togglePause());
    document.getElementById('resume-btn').addEventListener('click', () => this.game.togglePause());
    document.getElementById('restart-btn').addEventListener('click', () => this.game.start());
    document.getElementById('restart-from-pause-btn').addEventListener('click', () => this.game.start());
    this.soundBtn.addEventListener('click', () => this.game.toggleSound());

    document.getElementById('characters-btn').addEventListener('click', () => this.game.openCharacterSelect());
    document.getElementById('character-close-btn').addEventListener('click', () => this.game.closeCharacterSelect());
    document.getElementById('settings-btn').addEventListener('click', () => this.game.openSettings());
    document.getElementById('settings-close-btn').addEventListener('click', () => this.game.closeSettings());
    this.hapticsToggle.addEventListener('click', () => this.game.toggleHaptics());
    this.easyModeToggle.addEventListener('click', () => this.game.toggleEasyMode());

    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      this.mobileControls.classList.remove('hidden');
    } else {
      // still show on touch-capable
      if ('ontouchstart' in window) this.mobileControls.classList.remove('hidden');
    }
  }

  showStart(best) {
    this.startScreen.classList.remove('hidden');
    this.pauseScreen.classList.add('hidden');
    this.gameoverScreen.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.startBestScore.textContent = `BEST ${best}`;
  }

  showPlaying() {
    this.startScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.gameoverScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.hudBest.textContent = `BEST ${this.game.best}`;
    this.updateCoins(0);
    this.updateBuffs(0, { doubleJumpTimer: 0, magnetTimer: 0, slowTimer: 0 });
    this.updateMultiplier(false);
  }

  showPause(isPaused) {
    this.pauseScreen.classList.toggle('hidden', !isPaused);
  }

  showGameOver(score, best, isNewBest, coinsEarned, wallet, leaderboard) {
    this.gameoverScreen.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.finalScore.textContent = score;
    this.finalBest.textContent = best;
    this.finalCoins.textContent = `+${coinsEarned}`;
    this.finalWallet.textContent = wallet;
    this.newBestBadge.classList.toggle('hidden', !isNewBest);
    this.updateWalletDisplay(wallet);

    this.leaderboardList.innerHTML = '';
    (leaderboard || []).slice(0, 5).forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (entry.score === score ? ' lb-current' : '');
      row.innerHTML = `<span class="lb-rank">#${i + 1}</span><span class="lb-score">${entry.score}</span>`;
      this.leaderboardList.appendChild(row);
    });
  }

  updateScore(score) {
    this.scoreDisplay.textContent = score;
  }

  updateCoins(coins) {
    if (this.hudCoins) this.hudCoins.textContent = `🪙 ${coins}`;
  }

  updateBuffs(shieldCharges, buffs) {
    if (!this.hudBuffs) return;
    const chips = [];
    if (shieldCharges > 0) chips.push(`🛡×${shieldCharges}`);
    if (buffs.magnetTimer > 0) chips.push('🧲');
    if (buffs.slowTimer > 0) chips.push('❄');
    if (buffs.doubleJumpTimer > 0) chips.push('⏫');
    this.hudBuffs.textContent = chips.join('  ');
  }

  updateMultiplier(active) {
    if (!this.hudMultiplier) return;
    this.hudMultiplier.classList.toggle('hidden', !active);
  }

  flashMilestone(value) {
    if (!this.milestoneFlash) return;
    this.milestoneFlash.textContent = `${value}!`;
    this.milestoneFlash.classList.remove('play-flash');
    void this.milestoneFlash.offsetWidth; // restart animation
    this.milestoneFlash.classList.add('play-flash');
  }

  flashNearMiss() {
    if (!this.milestoneFlash) return;
    this.milestoneFlash.textContent = 'NEAR MISS! +5';
    this.milestoneFlash.classList.remove('play-flash');
    void this.milestoneFlash.offsetWidth;
    this.milestoneFlash.classList.add('play-flash');
  }

  flashInsufficientCoins() {
    const el = document.getElementById('char-insufficient');
    if (!el) return;
    el.classList.remove('play-flash');
    void el.offsetWidth;
    el.classList.add('play-flash');
  }

  updateSoundIcon(enabled) {
    this.soundBtn.textContent = enabled ? '🔊' : '🔇';
  }

  updateWalletDisplay(wallet) {
    if (this.walletChip) this.walletChip.textContent = `🪙 ${wallet}`;
    if (this.walletChip2) this.walletChip2.textContent = `🪙 ${wallet}`;
  }

  // --- character select ---
  showCharacterSelect(characters, owned, selectedId, wallet) {
    this.characterScreen.classList.remove('hidden');
    this.updateWalletDisplay(wallet);
    this.characterList.innerHTML = '';
    characters.forEach((c) => {
      const isOwned = owned.includes(c.id);
      const isSelected = c.id === selectedId;
      const card = document.createElement('div');
      card.className = 'char-card' + (isSelected ? ' selected' : '') + (!isOwned ? ' locked' : '');
      card.innerHTML = `
        <div class="char-swatch" style="background:${c.bodyColor}"><span style="background:${c.accent}"></span></div>
        <div class="char-name">${c.name}</div>
        <div class="char-desc">${c.desc}</div>
        <div class="char-footer">${isOwned ? (isSelected ? 'مُختار ✓' : 'اختيار') : `${c.price} 🪙`}</div>
      `;
      card.addEventListener('click', () => this.game.chooseCharacter(c.id));
      this.characterList.appendChild(card);
    });
  }

  hideCharacterSelect() {
    this.characterScreen.classList.add('hidden');
  }

  // --- settings ---
  showSettings(hapticsEnabled, easyMode) {
    this.settingsScreen.classList.remove('hidden');
    this.hapticsToggle.classList.toggle('on', hapticsEnabled);
    this.hapticsToggle.textContent = hapticsEnabled ? 'ON' : 'OFF';
    this.easyModeToggle.classList.toggle('on', easyMode);
    this.easyModeToggle.textContent = easyMode ? 'ON' : 'OFF';
  }

  hideSettings() {
    this.settingsScreen.classList.add('hidden');
  }
}

// ============================================================
// SIMPLE SOUND ENGINE (WebAudio synthesized, no external files)
// ============================================================
class SoundEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(freq, duration, type = 'square', volume = 0.08) {
    if (!this.enabled) return;
    this._ensureCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  jump() { this.play(440, 0.12, 'square', 0.06); }
  land() { this.play(180, 0.08, 'triangle', 0.05); }
  death() { this.play(120, 0.5, 'sawtooth', 0.08); }
  click() { this.play(600, 0.06, 'square', 0.05); }
}

// ============================================================
// GAME
// ============================================================
const STATE = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover' };

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.viewW = 400; // logical world width (mobile-first)
    this.viewH = 700;

    this.input = new Input();
    this.sound = new SoundEngine();
    this.ui = new UI(this);
    this.particles = new ParticleSystem();
    this.background = new Background();
    this.camera = new Camera(this.viewW, this.viewH);

    this.state = STATE.START;
    this.best = parseInt(localStorage.getItem('ninjaEscapeBest') || '0', 10);
    this.soundEnabled = localStorage.getItem('ninjaEscapeSound') !== 'off';
    this.sound.enabled = this.soundEnabled;
    this.ui.updateSoundIcon(this.soundEnabled);

    // --- progression / characters / settings ---
    this.characters = CHARACTERS;
    this.selectedCharacterId = Wallet.getSelected();
    this.wallet = Wallet.getCoins();
    this.hapticsEnabled = Wallet.getHaptics();
    this.easyMode = Wallet.getEasyMode();

    this._resize();
    window.addEventListener('resize', () => this._resize());

    // --- lobby / main-menu showcase state ---
    this.lobbyPlayer = new Player(this.viewW / 2 - 10, 0);
    this.lobbyPlayer.state = 'idle';
    this.lobbyPlayer.applyCharacter(this._currentCharacter());
    this.lobbyCamera = new Camera(this.viewW, this.viewH);
    this.lobbyParticles = new ParticleSystem();
    this.lobbyTime = 0;

    this.ui.showStart(this.best);
    this.ui.updateWalletDisplay(this.wallet);

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _resize() {
    const rect = document.getElementById('game-container').getBoundingClientRect();
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';

    // logical world height matches aspect but width fixed for consistent gameplay feel
    this.viewW = 400;
    this.viewH = this.viewW * (rect.height / rect.width);
    this.camera.resize(this.viewW, this.viewH);

    this.scaleX = this.canvas.width / this.viewW;
    this.scaleY = this.canvas.height / this.viewH;
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    this.sound.enabled = this.soundEnabled;
    localStorage.setItem('ninjaEscapeSound', this.soundEnabled ? 'on' : 'off');
    this.ui.updateSoundIcon(this.soundEnabled);
    this.sound.click();
  }

  _currentCharacter() {
    return this.characters.find(c => c.id === this.selectedCharacterId) || this.characters[0];
  }

  openCharacterSelect() {
    this.ui.showCharacterSelect(this.characters, Wallet.getOwned(), this.selectedCharacterId, this.wallet);
  }

  closeCharacterSelect() {
    this.ui.hideCharacterSelect();
  }

  chooseCharacter(id) {
    const char = this.characters.find(c => c.id === id);
    if (!char) return;
    const owned = Wallet.getOwned();

    if (owned.includes(id)) {
      this.selectedCharacterId = id;
      Wallet.setSelected(id);
      this.sound.click();
    } else if (Wallet.spendCoins(char.price)) {
      Wallet.addOwned(id);
      this.selectedCharacterId = id;
      Wallet.setSelected(id);
      this.wallet = Wallet.getCoins();
      this.sound.play(720, 0.18, 'square', 0.08);
    } else {
      this.ui.flashInsufficientCoins();
      this.sound.play(160, 0.15, 'sawtooth', 0.06);
      return;
    }

    this.wallet = Wallet.getCoins();
    this.lobbyPlayer.applyCharacter(this._currentCharacter());
    this.ui.updateWalletDisplay(this.wallet);
    this.ui.showCharacterSelect(this.characters, Wallet.getOwned(), this.selectedCharacterId, this.wallet);
  }

  openSettings() {
    this.ui.showSettings(this.hapticsEnabled, this.easyMode);
  }

  closeSettings() {
    this.ui.hideSettings();
  }

  toggleHaptics() {
    this.hapticsEnabled = !this.hapticsEnabled;
    Wallet.setHaptics(this.hapticsEnabled);
    this.ui.showSettings(this.hapticsEnabled, this.easyMode);
  }

  toggleEasyMode() {
    this.easyMode = !this.easyMode;
    Wallet.setEasyMode(this.easyMode);
    this.ui.showSettings(this.hapticsEnabled, this.easyMode);
  }

  togglePause() {
    if (this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      this.ui.showPause(true);
    } else if (this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      this.ui.showPause(false);
      this.lastTime = performance.now();
    }
  }

  start() {
    this.state = STATE.PLAYING;
    this.ui.showPlaying();

    const charData = this._currentCharacter();

    this.player = new Player(this.viewW / 2 - 10, this.viewH - 160);
    this.player.applyCharacter(charData);
    this.player.hapticsEnabled = this.hapticsEnabled;
    this.player.onJump = () => {
      this.sound.jump();
      if (navigator.vibrate && this.hapticsEnabled) navigator.vibrate(12);
    };
    this.camera.y = this.player.y - this.viewH * 0.6;
    this.camera.targetY = this.camera.y;

    this.platforms = [];
    this.coins = [];
    this.powerups = [];
    this.particles.particles.length = 0;
    this._generateInitialPlatforms();

    const speedMult = (charData.passive === 'slowLava' ? 0.85 : 1) * (this.easyMode ? 0.8 : 1);
    this.lava = new Lava(this.viewH + 40, speedMult);
    this.score = 0;
    this.maxHeightReached = this.player.y;

    // run economy + power-up state
    this.runCoins = 0;
    this.shieldCharges = charData.passive === 'shield' ? 1 : 0;
    this.buffs = { doubleJumpTimer: 0, magnetTimer: 0, slowTimer: 0 };
    this.multiplier = 1;
    this._nearDangerTime = 0;
    this.lastMilestone = 0;

    this.lastTime = performance.now();
  }

  _generateInitialPlatforms() {
    // Wide, centered safety platform under the player -- generous enough that
    // pressing a direction immediately after spawning can't walk you off the edge.
    const startX = this.viewW / 2 - 90;
    const startW = 180;
    this.platforms.push(new Platform(startX, this.viewH - 130, startW, PLATFORM_TYPES.NORMAL));
    this.highestPlatformY = this.viewH - 130;
    this.lastPlatformX = startX;
    this.lastPlatformW = startW;

    for (let i = 0; i < 14; i++) {
      const easy = i < 4; // short "tutorial" run: easy, wide, straight-up platforms
      const gap = easy ? rand(40, 56) : rand(48, 72);
      this.highestPlatformY -= gap;
      this._spawnPlatformAt(this.highestPlatformY, gap, easy);
    }
  }

  // Max horizontal distance the player can realistically cover while airborne,
  // given a vertical gap. Derived conservatively from the player's jump tuning
  // (with extra buffer for imperfect real-world input) so every generated
  // platform is always reachable.
  _maxHorizontalReach(gap) {
    const airTime = clamp(0.35 + gap / 260, 0.32, 0.85);
    return 110 + airTime * 100; // base reach + speed*time margin + safety buffer
  }

  _spawnPlatformAt(y, gap = 65, forceEasy = false) {
    const w = forceEasy ? rand(95, 135) : rand(65, 105);
    const prevX = this.lastPlatformX !== undefined ? this.lastPlatformX : this.viewW / 2 - 40;
    const prevW = this.lastPlatformW !== undefined ? this.lastPlatformW : 80;
    const reach = forceEasy ? 45 : this._maxHorizontalReach(gap);

    const prevCenter = prevX + prevW / 2;
    let minX = clamp(prevCenter - reach - w / 2, 10, this.viewW - w - 10);
    let maxX = clamp(prevCenter + reach - w / 2, 10, this.viewW - w - 10);
    if (minX > maxX) { const mid = (minX + maxX) / 2; minX = maxX = mid; }
    const x = rand(minX, maxX);

    let type = PLATFORM_TYPES.NORMAL;
    if (!forceEasy) {
      const roll = Math.random();
      // difficulty scaling by depth (more variety higher up)
      const difficulty = clamp(-(y) / 4000, 0, 1);
      if (roll < 0.15 + difficulty * 0.1) type = PLATFORM_TYPES.MOVING;
      else if (roll < 0.28 + difficulty * 0.15) type = PLATFORM_TYPES.CRUMBLE;
    }

    const p = new Platform(x, y, w, type);
    this.platforms.push(p);
    this.highestPlatformY = Math.min(this.highestPlatformY, y);
    this.lastPlatformX = x;
    this.lastPlatformW = w;

    if (!forceEasy) {
      const pickupRoll = Math.random();
      const cx = x + w / 2;
      const cy = y - 24;
      if (pickupRoll < 0.07) {
        const types = Object.values(POWERUP_TYPES);
        const type = types[randInt(0, types.length - 1)];
        this.powerups.push(new Powerup(cx, cy, type));
      } else if (pickupRoll < 0.42) {
        this.coins.push(new Coin(cx, cy));
      }
    }

    return p;
  }

  _maintainPlatforms() {
    // remove platforms far below camera
    const cutoff = this.camera.y + this.viewH + 200;
    this.platforms = this.platforms.filter(p => !p.dead && p.y < cutoff);
    this.coins = this.coins.filter(c => !c.collected && c.y < cutoff);
    this.powerups = this.powerups.filter(p => !p.collected && p.y < cutoff);

    // generate new platforms above the highest existing one, keeping reachable gaps
    while (this.highestPlatformY > this.camera.y - 300) {
      const gap = rand(48, 72); // within safe jump range given tuning
      this.highestPlatformY -= gap;
      this._spawnPlatformAt(this.highestPlatformY, gap);
    }
  }

  _updateLobby(dt) {
    this.lobbyTime += dt;
    this.background.update(dt);
    this.lobbyPlayer.animTime += dt;
    // slow ambient drift so the scene never feels static
    this.lobbyCamera.y = -40 + Math.sin(this.lobbyTime * 0.18) * 14;
    this.lobbyCamera.x = Math.sin(this.lobbyTime * 0.11) * 4;

    if (Math.random() < 0.45) {
      this.lobbyParticles.spawnFire(rand(0, this.viewW), this.viewH + 30, 1);
    }
    if (Math.random() < 0.25) {
      this.lobbyParticles.spawnSmoke(rand(0, this.viewW), this.viewH - 60, 1);
    }
    if (Math.random() < 0.12) {
      this.lobbyParticles.spawnSpark(this.lobbyPlayer.x + 10, this.viewH - 150, 2);
    }
    this.lobbyParticles.update(dt);
  }

  _renderLobby() {
    const ctx = this.ctx;
    // pedestal glow
    const px = this.lobbyPlayer.x + this.lobbyPlayer.w / 2 - this.lobbyCamera.x;
    const py = this.viewH - 118 - this.lobbyCamera.renderY;
    const glow = ctx.createRadialGradient(px, py, 4, px, py, 70);
    glow.addColorStop(0, 'rgba(255,150,60,0.45)');
    glow.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(px, py, 70, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    // pedestal platform
    ctx.fillStyle = '#2a1810';
    ctx.beginPath();
    ctx.ellipse(px, py, 46, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,179,71,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    this.lobbyParticles.draw(ctx, this.lobbyCamera);

    // showcase ninja, scaled up
    ctx.save();
    const sx = this.lobbyPlayer.x - this.lobbyCamera.x;
    const sy = this.viewH - 150 - this.lobbyCamera.renderY;
    ctx.translate(sx + this.lobbyPlayer.w / 2, sy + this.lobbyPlayer.h);
    ctx.scale(this.lobbyPlayer.facing * 2.1, 2.1);
    this.lobbyPlayer._drawNinja(ctx);
    ctx.restore();
  }

  _update(dt) {
    if (this.state !== STATE.PLAYING) return;

    // decay temporary power-up buffs
    this.buffs.doubleJumpTimer = Math.max(0, this.buffs.doubleJumpTimer - dt);
    this.buffs.magnetTimer = Math.max(0, this.buffs.magnetTimer - dt);
    this.buffs.slowTimer = Math.max(0, this.buffs.slowTimer - dt);

    this.player.update(dt, this.input, this.platforms, this.particles, this.camera, this.buffs);
    for (const p of this.platforms) p.update(dt);
    this.lava.update(dt, this.particles, this.camera, this.buffs.slowTimer > 0);
    this.particles.update(dt);
    this.background.update(dt);

    // --- coins & power-ups ---
    const magnetTarget = this.buffs.magnetTimer > 0
      ? { x: this.player.x + this.player.w / 2, y: this.player.y + this.player.h / 2 }
      : null;
    const pcx = this.player.x + this.player.w / 2;
    const pcy = this.player.y + this.player.h / 2;

    for (const c of this.coins) {
      if (c.collected) continue;
      c.update(dt, magnetTarget);
      if (Math.hypot(c.x - pcx, c.y - pcy) < c.r + 14) {
        c.collected = true;
        this.runCoins++;
        this.ui.updateCoins(this.runCoins);
        this.particles.spawnSpark(c.x, c.y, 5);
        this.sound.play(920, 0.06, 'square', 0.05);
      }
    }
    for (const pu of this.powerups) {
      if (pu.collected) continue;
      if (Math.hypot(pu.x - pcx, pu.y - pcy) < pu.r + 15) {
        pu.collected = true;
        this._applyPowerup(pu.type);
        this.particles.spawnSpark(pu.x, pu.y, 12);
        this.sound.play(500, 0.15, 'triangle', 0.07);
      }
    }
    this.ui.updateBuffs(this.shieldCharges, this.buffs);

    this.camera.follow(this.player.y);
    this.camera.update(dt);

    this._maintainPlatforms();

    // score based on height climbed
    if (this.player.y < this.maxHeightReached) {
      this.maxHeightReached = this.player.y;
      this.score = Math.max(0, Math.floor((this.viewH - 160 - this.maxHeightReached) / 10));
      this.ui.updateScore(this.score);

      // milestone celebration every 100 points
      const milestone = Math.floor(this.score / 100);
      if (milestone > this.lastMilestone) {
        this.lastMilestone = milestone;
        this.ui.flashMilestone(milestone * 100);
        this.particles.spawnSpark(this.player.x + this.player.w / 2, this.player.y, 18);
        this.sound.play(880, 0.15, 'sine', 0.07);
      }
    }

    // camera shake as lava approaches + risk multiplier / near-miss bonus
    const dist = this.lava.distanceTo(this.player.y);
    if (dist < 220) {
      this.camera.addShake(clamp((220 - dist) / 220, 0, 1) * 3);
    }
    if (dist < 150 && !this.player.dead) {
      this.multiplier = 2;
      this._nearDangerTime += dt;
      this.ui.updateMultiplier(true);
    } else {
      if (this.multiplier === 2 && this._nearDangerTime > 0.35) {
        this.runCoins += 5;
        this.ui.updateCoins(this.runCoins);
        this.ui.flashNearMiss();
      }
      this.multiplier = 1;
      this._nearDangerTime = 0;
      this.ui.updateMultiplier(false);
    }

    // death conditions
    if (!this.player.dead) {
      if (dist < this.player.h * 0.6) {
        if (this.shieldCharges > 0) {
          this.shieldCharges--;
          this.player.vy = -520;
          this.player.grounded = false;
          this.player.usedAirJump = false;
          this.particles.spawnSpark(pcx, pcy, 16);
          this.particles.spawnFire(pcx, this.player.y + this.player.h, 10);
          this.camera.addShake(8);
          if (navigator.vibrate && this.hapticsEnabled) navigator.vibrate(20);
          this.sound.play(300, 0.2, 'triangle', 0.08);
          this.ui.updateBuffs(this.shieldCharges, this.buffs);
        } else {
          this.player.kill(this.particles, this.camera);
          this.sound.death();
        }
      }
    } else {
      // after death animation plays briefly, show game over
      this._deathTimer = (this._deathTimer || 0) + dt;
      if (this._deathTimer > 0.7) {
        this._deathTimer = 0;
        this._endGame();
      }
    }

    // fallback: if player somehow falls below lava screen without collision flagged
    if (this.player.y - this.camera.y > this.viewH + 120 && !this.player.dead) {
      this.player.kill(this.particles, this.camera);
      this.sound.death();
    }
  }

  _applyPowerup(type) {
    if (type === POWERUP_TYPES.SHIELD) {
      this.shieldCharges = Math.min(this.shieldCharges + 1, 2);
    } else if (type === POWERUP_TYPES.MAGNET) {
      this.buffs.magnetTimer = 6;
    } else if (type === POWERUP_TYPES.SLOW) {
      this.buffs.slowTimer = 5;
    } else if (type === POWERUP_TYPES.DOUBLE) {
      this.buffs.doubleJumpTimer = 10;
    }
  }

  _endGame() {
    this.state = STATE.GAMEOVER;
    const isNewBest = this.score > this.best;
    if (isNewBest) {
      this.best = this.score;
      localStorage.setItem('ninjaEscapeBest', String(this.best));
    }
    const climbBonus = Math.floor(this.score / 15);
    const totalCoinsEarned = this.runCoins + climbBonus;
    this.wallet = Wallet.addCoins(totalCoinsEarned);
    const leaderboard = Wallet.submitScore(this.score);
    this.ui.showGameOver(this.score, this.best, isNewBest, totalCoinsEarned, this.wallet, leaderboard);
  }

  _render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.scaleX, this.scaleY);
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    if (this.state === STATE.START) {
      this.background.draw(ctx, this.lobbyCamera, this.viewW, this.viewH);
      this._renderLobby();
    } else {
      this.background.draw(ctx, this.camera, this.viewW, this.viewH);
    }

    if (this.player && this.state !== STATE.START) {
      for (const p of this.platforms) p.draw(ctx, this.camera, this.lava ? this.lava.time : 0);
      for (const c of this.coins) if (!c.collected) c.draw(ctx, this.camera, this.lava ? this.lava.time : 0);
      for (const pu of this.powerups) if (!pu.collected) pu.draw(ctx, this.camera, this.lava ? this.lava.time : 0);
      this.particles.draw(ctx, this.camera);
      this.player.draw(ctx, this.camera);

      if (this.shieldCharges > 0) {
        const sx = this.player.x + this.player.w / 2 - this.camera.x;
        const sy = this.player.y + this.player.h / 2 - this.camera.renderY;
        ctx.save();
        ctx.globalAlpha = 0.55 + Math.sin(this.lava.time * 6) * 0.15;
        ctx.strokeStyle = '#5fd4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      this.lava.draw(ctx, this.camera);

      // danger vignette as lava closes in
      const dist = this.lava ? this.lava.distanceTo(this.player.y) : 999;
      if (dist < 260) {
        const t = clamp((260 - dist) / 260, 0, 1);
        const vg = ctx.createRadialGradient(
          this.viewW / 2, this.viewH / 2, this.viewH * 0.3,
          this.viewW / 2, this.viewH / 2, this.viewH * 0.75
        );
        vg.addColorStop(0, 'rgba(255,60,20,0)');
        vg.addColorStop(1, `rgba(255,40,10,${t * 0.45})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, this.viewW, this.viewH);
      }
    }

    ctx.restore();
  }

  _loop(now) {
    let dt = (now - this.lastTime) / 1000;
    dt = Math.min(dt, 1 / 30); // clamp to avoid spiral of death
    this.lastTime = now;

    if (this.state === STATE.START) {
      this._updateLobby(dt);
    } else {
      this._update(dt);
    }
    this._render();

    requestAnimationFrame((t) => this._loop(t));
  }
}

// jump/land sound hooks via monkey-patching not needed; wire directly:
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  window.__ninjaGame = game;

  // light sound hooks
  const origKill = Player.prototype.kill;
  Player.prototype.kill = function (particles, camera) {
    const wasDead = this.dead;
    origKill.call(this, particles, camera);
    if (!wasDead && game.sound) game.sound.death();
  };
});