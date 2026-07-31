(() => {
  'use strict';

  const canvas = document.querySelector('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const ui = {
    start: document.querySelector('#startScreen'), end: document.querySelector('#endScreen'),
    startButton: document.querySelector('#startButton'), restartButton: document.querySelector('#restartButton'),
    time: document.querySelector('#timeValue'), score: document.querySelector('#scoreValue'), combo: document.querySelector('#comboValue'), speed: document.querySelector('#speedValue'),
    nitro: document.querySelector('#nitroValue'), nitroFill: document.querySelector('#nitroFill'), startBest: document.querySelector('#startBest'),
    finalScore: document.querySelector('#finalScore'), finalCombo: document.querySelector('#finalCombo'), finalCheckpoints: document.querySelector('#finalCheckpoints')
  };
  const W = canvas.width, H = canvas.height;
  const track = { outer: { x: 70, y: 55, w: 1140, h: 610, r: 195 }, inner: { x: 272, y: 205, w: 736, h: 310, r: 90 } };
  const checkpoints = [
    { x: 610, y: 568, angle: 0, label: '01' }, { x: 1083, y: 438, angle: Math.PI / 2, label: '02' },
    { x: 770, y: 152, angle: 0, label: '03' }, { x: 198, y: 300, angle: Math.PI / 2, label: '04' }
  ];
  const pickupSpots = [{ x: 458, y: 568 }, { x: 1080, y: 548 }, { x: 880, y: 152 }, { x: 200, y: 422 }];
  const keys = new Set();
  let state, lastTime = 0, animationId = 0;

  function getBest() { try { return Number(localStorage.getItem('driftRushBest')) || 0; } catch { return 0; } }
  function saveBest(score) { try { localStorage.setItem('driftRushBest', String(score)); } catch { /* File mode may block storage. */ } }
  function resetGame() {
    state = {
      running: false, ended: false, time: 60, score: 0, best: getBest(), checkpointCount: 0, nextCheckpoint: 0,
      maxCombo: 1, driftBank: 0, driftTime: 0, wasDrifting: false, nitro: 22, turbo: false,
      skidMarks: [], particles: [], pickups: pickupSpots.map((p, index) => ({ ...p, index, cooldown: index * 1.2 })),
      flash: 0, shake: 0, message: 'READY?', messageTime: .8, collisionCooldown: 0, streakOffset: 0,
      car: { x: 350, y: 568, vx: 0, vy: 0, angle: 0, radius: 19 }
    };
    ui.startBest.textContent = state.best.toLocaleString();
    updateHud();
  }
  function startGame() {
    resetGame(); state.running = true;
    ui.start.classList.remove('visible'); ui.end.classList.remove('visible');
    lastTime = performance.now(); cancelAnimationFrame(animationId); animationId = requestAnimationFrame(loop);
  }
  function isDown(...names) { return names.some(name => keys.has(name)); }
  function roundedContains(rect, x, y) {
    const nx = Math.max(rect.x + rect.r, Math.min(x, rect.x + rect.w - rect.r));
    const ny = Math.max(rect.y + rect.r, Math.min(y, rect.y + rect.h - rect.r));
    return (x - nx) ** 2 + (y - ny) ** 2 <= rect.r ** 2;
  }
  function isOnTrack(x, y) { return roundedContains(track.outer, x, y) && !roundedContains(track.inner, x, y); }
  function carHitsWall(car) {
    return [[0, 0], [20, 0], [-17, 0], [0, 15], [0, -15]].some(([lx, ly]) => !isOnTrack(car.x + lx * Math.cos(car.angle) - ly * Math.sin(car.angle), car.y + lx * Math.sin(car.angle) + ly * Math.cos(car.angle)));
  }
  function currentCombo() { return 1 + Math.min(7, Math.floor(state.driftTime / 1.05)); }

  function update(dt) {
    const s = state, car = s.car;
    s.time = Math.max(0, s.time - dt); s.flash = Math.max(0, s.flash - dt); s.shake = Math.max(0, s.shake - dt); s.messageTime = Math.max(0, s.messageTime - dt); s.collisionCooldown = Math.max(0, s.collisionCooldown - dt); s.streakOffset += dt * 700;
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle), lx = -fy, ly = fx;
    let forwardSpeed = car.vx * fx + car.vy * fy;
    let lateralSpeed = car.vx * lx + car.vy * ly;
    const throttle = isDown('KeyW', 'ArrowUp'), reverse = isDown('KeyS', 'ArrowDown');
    const steer = (isDown('KeyD', 'ArrowRight') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const drifting = isDown('Space') && steer !== 0 && Math.abs(forwardSpeed) > 95;
    s.turbo = isDown('ShiftLeft', 'ShiftRight') && s.nitro > 1 && forwardSpeed > 90 && !reverse;

    if (throttle) forwardSpeed += 600 * dt;
    if (reverse) forwardSpeed -= 380 * dt;
    if (!throttle && !reverse) forwardSpeed *= Math.pow(.974, dt * 60);
    if (s.turbo) { forwardSpeed += 820 * dt; s.nitro = Math.max(0, s.nitro - 30 * dt); s.shake = Math.max(s.shake, .07); if (Math.random() < .82) addParticle(car, lx, ly, 0, '#65f4ff', 1.1); }
    forwardSpeed = Math.max(-170, Math.min(s.turbo ? 685 : 490, forwardSpeed));

    if (steer && Math.abs(forwardSpeed) > 13) {
      const turnRate = (drifting ? 2.85 : 2.1) * Math.min(1, Math.abs(forwardSpeed) / 170) * (s.turbo ? .82 : 1);
      car.angle += steer * Math.sign(forwardSpeed) * turnRate * dt;
    }
    if (drifting) {
      lateralSpeed += steer * 255 * dt; lateralSpeed *= Math.pow(.962, dt * 60);
      s.driftTime += dt; s.driftBank += Math.abs(forwardSpeed) * dt * .48; s.nitro = Math.min(100, s.nitro + Math.abs(forwardSpeed) * dt * .018); s.maxCombo = Math.max(s.maxCombo, currentCombo());
      if (Math.random() < .75) addSkid(car, fx, fy); if (Math.random() < .48) addParticle(car, lx, ly, steer, '#f4f7ff');
    } else {
      lateralSpeed *= Math.pow(.56, dt * 60); if (s.wasDrifting) settleDrift();
    }
    s.wasDrifting = drifting;
    forwardSpeed *= Math.pow(s.turbo ? .994 : (drifting ? .989 : .981), dt * 60);
    car.vx = fx * forwardSpeed + lx * lateralSpeed; car.vy = fy * forwardSpeed + ly * lateralSpeed; car.x += car.vx * dt; car.y += car.vy * dt;

    if (carHitsWall(car)) {
      car.x -= car.vx * dt * 2.2; car.y -= car.vy * dt * 2.2; car.vx *= -.2; car.vy *= -.2;
      if (s.collisionCooldown <= 0) {
        s.collisionCooldown = .38; s.flash = .18; s.shake = .18; s.message = 'WALL HIT!'; s.messageTime = .55; s.driftBank = 0; s.driftTime = 0; s.wasDrifting = false; s.nitro = Math.max(0, s.nitro - 12);
      }
    }
    testCheckpoint(drifting); testPickups();
    s.pickups.forEach(p => p.cooldown = Math.max(0, p.cooldown - dt));
    s.skidMarks = s.skidMarks.filter(mark => (mark.life -= dt) > 0);
    s.particles = s.particles.filter(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; return p.life > 0; });
    if (s.time <= 0) endGame(); updateHud();
  }
  function settleDrift() {
    const s = state;
    if (s.driftBank >= 20) { const multiplier = currentCombo(), earned = Math.round(s.driftBank * multiplier); s.score += earned; s.maxCombo = Math.max(s.maxCombo, multiplier); s.message = `DRIFT BANK +${earned}`; s.messageTime = .68; }
    s.driftBank = 0; s.driftTime = 0;
  }
  function testCheckpoint(drifting) {
    const s = state, cp = checkpoints[s.nextCheckpoint], dx = s.car.x - cp.x, dy = s.car.y - cp.y;
    if (dx * dx + dy * dy < 44 ** 2) {
      let points = 350 + s.nextCheckpoint * 50;
      if (drifting) { points += 250; s.nitro = Math.min(100, s.nitro + 12); s.message = 'DRIFT GATE +250'; } else s.message = `CHECKPOINT ${cp.label} +${points}`;
      s.score += points; s.checkpointCount++; s.nextCheckpoint = (s.nextCheckpoint + 1) % checkpoints.length;
      if (s.nextCheckpoint === 0) { s.score += 700; s.nitro = Math.min(100, s.nitro + 20); s.message = 'LAP LINK +700'; }
      s.messageTime = .8;
    }
  }
  function testPickups() {
    const s = state;
    s.pickups.forEach(p => {
      if (!p.cooldown && (s.car.x - p.x) ** 2 + (s.car.y - p.y) ** 2 < 31 ** 2) { p.cooldown = 7; s.nitro = Math.min(100, s.nitro + 28); s.score += 125; s.message = 'NITRO CELL +28%'; s.messageTime = .65; s.shake = .07; }
    });
  }
  function addSkid(car, fx, fy) {
    const side = Math.random() > .5 ? 12 : -12;
    state.skidMarks.push({ x: car.x - fx * 15 - fy * side, y: car.y - fy * 15 + fx * side, angle: car.angle, life: 1.2 }); if (state.skidMarks.length > 180) state.skidMarks.shift();
  }
  function addParticle(car, lx, ly, steer, color = '#effaff', scale = 1) {
    state.particles.push({ x: car.x - Math.cos(car.angle) * 18 + lx * (steer || (Math.random() - .5)) * 13, y: car.y - Math.sin(car.angle) * 18 + ly * (steer || (Math.random() - .5)) * 13, vx: -car.vx * (.1 + scale * .06) + (Math.random() - .5) * 36, vy: -car.vy * (.1 + scale * .06) + (Math.random() - .5) * 36, life: .35 + Math.random() * .35, color, scale });
  }

  function drawRounded(rect, fill, stroke) { ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } }
  function draw() {
    const s = state, car = s.car, speed = Math.hypot(car.vx, car.vy);
    ctx.clearRect(0, 0, W, H); ctx.save();
    if (s.shake) ctx.translate((Math.random() - .5) * s.shake * 24, (Math.random() - .5) * s.shake * 24);
    ctx.fillStyle = '#101a2b'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(91,139,188,.12)'; ctx.lineWidth = 1;
    for (let x = -20; x < W; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 180, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 46) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y - 80); ctx.stroke(); }
    if (speed > 300) drawSpeedLines(speed);
    drawRounded(track.outer, '#26313b', 'rgba(111,211,255,.25)');
    drawRounded({ ...track.outer, x: track.outer.x + 13, y: track.outer.y + 13, w: track.outer.w - 26, h: track.outer.h - 26, r: track.outer.r - 13 }, '#353b42');
    drawRounded(track.inner, '#152534', 'rgba(125,219,255,.17)');
    ctx.setLineDash([16, 20]); ctx.lineDashOffset = -s.streakOffset; ctx.lineWidth = 2; drawRounded({ x: 190, y: 132, w: 900, h: 455, r: 140 }, null, 'rgba(228,244,255,.4)'); ctx.setLineDash([]);
    s.skidMarks.forEach(mark => { ctx.save(); ctx.globalAlpha = mark.life * .34; ctx.translate(mark.x, mark.y); ctx.rotate(mark.angle); ctx.fillStyle = '#050608'; ctx.fillRect(-8, -2, 18, 4); ctx.restore(); });
    s.particles.forEach(p => { ctx.globalAlpha = p.life * 1.3; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 2 * p.scale, 2 * p.scale); }); ctx.globalAlpha = 1;
    s.pickups.forEach(drawPickup); checkpoints.forEach((cp, index) => drawCheckpoint(cp, index === s.nextCheckpoint)); drawStartLine(); drawCar(car, s.turbo);
    if (s.messageTime > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, s.messageTime * 2); ctx.textAlign = 'center'; ctx.font = '900 italic 24px Arial'; ctx.fillStyle = s.message === 'WALL HIT!' ? '#ff6f83' : '#f3fbff'; ctx.fillText(s.message, W / 2, H / 2 - 5); ctx.restore(); }
    ctx.restore(); if (s.flash) { ctx.fillStyle = `rgba(255,52,86,${s.flash * 1.5})`; ctx.fillRect(0, 0, W, H); }
  }
  function drawSpeedLines(speed) {
    ctx.save(); ctx.globalAlpha = Math.min(.3, (speed - 300) / 900); ctx.strokeStyle = '#9eefff'; ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) { const x = (i * 131 + state.streakOffset * 1.8) % (W + 200) - 100, y = (i * 73) % H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 65, y + 18); ctx.stroke(); } ctx.restore();
  }
  function drawPickup(p) {
    if (p.cooldown) return;
    const pulse = 1 + Math.sin(state.streakOffset * .012 + p.index) * .18;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(state.streakOffset * .004); ctx.shadowColor = '#65efff'; ctx.shadowBlur = 18; ctx.fillStyle = '#7af4ff'; ctx.beginPath(); ctx.moveTo(0, -13 * pulse); ctx.lineTo(10 * pulse, 0); ctx.lineTo(0, 13 * pulse); ctx.lineTo(-10 * pulse, 0); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#113b54'; ctx.fillRect(-3, -7, 6, 14); ctx.restore();
  }
  function drawCheckpoint(cp, active) {
    ctx.save(); ctx.translate(cp.x, cp.y); ctx.rotate(cp.angle); const color = active ? '#ff4aac' : '#4b7691'; ctx.globalAlpha = active ? .92 : .4; ctx.fillStyle = color; ctx.fillRect(-5, -65, 10, 130); ctx.shadowColor = color; ctx.shadowBlur = active ? 20 : 0; ctx.fillRect(-2, -65, 4, 130); ctx.globalAlpha = 1; ctx.fillStyle = '#e9f8ff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText(cp.label, 0, -78); ctx.restore();
  }
  function drawStartLine() { ctx.save(); ctx.translate(350, 568); for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#e9eff2' : '#20262d'; ctx.fillRect(i * 8 - 32, j * 10 - 10, 8, 10); } ctx.restore(); }
  function drawCar(car, turbo) {
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.angle);
    if (turbo) { ctx.shadowColor = '#4bf5ff'; ctx.shadowBlur = 18; ctx.fillStyle = '#b5fbff'; ctx.beginPath(); ctx.moveTo(-18, -9); ctx.lineTo(-48 - Math.random() * 14, 0); ctx.lineTo(-18, 9); ctx.closePath(); ctx.fill(); }
    ctx.shadowColor = turbo ? '#65efff' : '#58eaff'; ctx.shadowBlur = turbo ? 28 : 17; ctx.fillStyle = turbo ? '#70e9ff' : '#40b9e8'; ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(11, 14); ctx.lineTo(-20, 13); ctx.lineTo(-27, 0); ctx.lineTo(-20, -13); ctx.lineTo(11, -14); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#101729'; ctx.fillRect(-9, -9, 17, 18); ctx.fillStyle = '#e7faff'; ctx.fillRect(13, -9, 6, 5); ctx.fillRect(13, 4, 6, 5); ctx.fillStyle = '#ff4b9d'; ctx.fillRect(-22, -9, 5, 4); ctx.fillRect(-22, 5, 5, 4); ctx.restore();
  }
  function updateHud() {
    const s = state, speed = Math.round(Math.hypot(s.car.vx, s.car.vy) * .56), combo = currentCombo();
    ui.time.textContent = s.time.toFixed(1); ui.score.textContent = Math.round(s.score + s.driftBank * combo).toLocaleString(); ui.combo.textContent = `x${combo}`; ui.speed.innerHTML = `${speed} <i>KM/H</i>`; ui.nitro.textContent = `${Math.round(s.nitro)}%`; ui.nitroFill.style.width = `${s.nitro}%`;
  }
  function endGame() {
    if (state.ended) return; if (state.wasDrifting) settleDrift(); state.running = false; state.ended = true;
    state.best = Math.max(state.best, Math.round(state.score)); saveBest(state.best); ui.startBest.textContent = state.best.toLocaleString();
    ui.finalScore.textContent = Math.round(state.score).toLocaleString(); ui.finalCombo.textContent = `x${state.maxCombo}`; ui.finalCheckpoints.textContent = state.checkpointCount; ui.end.classList.add('visible');
  }
  function loop(now) { const dt = Math.min(.033, (now - lastTime) / 1000 || 0); lastTime = now; if (state.running) update(dt); draw(); if (!state.ended) animationId = requestAnimationFrame(loop); }
  window.addEventListener('keydown', event => { if (['Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault(); keys.add(event.code); });
  window.addEventListener('keyup', event => keys.delete(event.code)); window.addEventListener('blur', () => keys.clear());
  ui.startButton.addEventListener('click', startGame); ui.restartButton.addEventListener('click', startGame); resetGame(); draw();
})();
