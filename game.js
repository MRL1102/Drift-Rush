(() => {
  'use strict';

  const canvas = document.querySelector('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const ui = {
    start: document.querySelector('#startScreen'), end: document.querySelector('#endScreen'),
    startButton: document.querySelector('#startButton'), restartButton: document.querySelector('#restartButton'),
    time: document.querySelector('#timeValue'), score: document.querySelector('#scoreValue'), combo: document.querySelector('#comboValue'), speed: document.querySelector('#speedValue'),
    finalScore: document.querySelector('#finalScore'), finalCombo: document.querySelector('#finalCombo'), finalCheckpoints: document.querySelector('#finalCheckpoints')
  };

  // Logical resolution remains fixed, CSS scales the canvas to the available browser space.
  const W = canvas.width, H = canvas.height;
  const track = { outer: { x: 70, y: 55, w: 1140, h: 610, r: 195 }, inner: { x: 272, y: 205, w: 736, h: 310, r: 90 } };
  const checkpoints = [
    { x: 610, y: 568, angle: 0, label: '01' },
    { x: 1083, y: 438, angle: Math.PI / 2, label: '02' },
    { x: 770, y: 152, angle: 0, label: '03' },
    { x: 198, y: 300, angle: Math.PI / 2, label: '04' }
  ];
  const keys = new Set();
  let state, lastTime = 0, animationId = 0;

  function resetGame() {
    state = {
      running: false, ended: false, time: 60, score: 0, checkpointCount: 0, nextCheckpoint: 0,
      maxCombo: 1, driftBank: 0, driftTime: 0, wasDrifting: false, skidMarks: [], particles: [],
      flash: 0, message: 'READY?', messageTime: .8, collisionCooldown: 0,
      car: { x: 350, y: 568, vx: 0, vy: 0, angle: 0, radius: 19 }
    };
    updateHud();
  }

  function startGame() {
    resetGame();
    state.running = true;
    ui.start.classList.remove('visible'); ui.end.classList.remove('visible');
    lastTime = performance.now();
    cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(loop);
  }

  function isDown(...names) { return names.some(name => keys.has(name)); }
  function roundedContains(rect, x, y) {
    const nx = Math.max(rect.x + rect.r, Math.min(x, rect.x + rect.w - rect.r));
    const ny = Math.max(rect.y + rect.r, Math.min(y, rect.y + rect.h - rect.r));
    return (x - nx) ** 2 + (y - ny) ** 2 <= rect.r ** 2;
  }
  function isOnTrack(x, y) { return roundedContains(track.outer, x, y) && !roundedContains(track.inner, x, y); }
  function carHitsWall(car) {
    const samples = [[0,0], [20,0], [-17,0], [0,15], [0,-15]];
    return samples.some(([lx, ly]) => !isOnTrack(car.x + lx * Math.cos(car.angle) - ly * Math.sin(car.angle), car.y + lx * Math.sin(car.angle) + ly * Math.cos(car.angle)));
  }

  function update(dt) {
    const s = state, car = s.car;
    s.time = Math.max(0, s.time - dt); s.flash = Math.max(0, s.flash - dt); s.messageTime = Math.max(0, s.messageTime - dt); s.collisionCooldown = Math.max(0, s.collisionCooldown - dt);
    const forwardX = Math.cos(car.angle), forwardY = Math.sin(car.angle);
    const leftX = -forwardY, leftY = forwardX;
    let forwardSpeed = car.vx * forwardX + car.vy * forwardY;
    let lateralSpeed = car.vx * leftX + car.vy * leftY;
    const throttle = isDown('KeyW', 'ArrowUp'), reverse = isDown('KeyS', 'ArrowDown');
    const steer = (isDown('KeyD', 'ArrowRight') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const drifting = isDown('Space') && steer !== 0 && Math.abs(forwardSpeed) > 95;

    if (throttle) forwardSpeed += 590 * dt;
    if (reverse) forwardSpeed -= 370 * dt;
    if (!throttle && !reverse) forwardSpeed *= Math.pow(.975, dt * 60);
    forwardSpeed = Math.max(-170, Math.min(490, forwardSpeed));

    if (steer && Math.abs(forwardSpeed) > 13) {
      const turnRate = (drifting ? 2.75 : 2.05) * Math.min(1, Math.abs(forwardSpeed) / 170);
      car.angle += steer * Math.sign(forwardSpeed) * turnRate * dt;
    }
    if (drifting) {
      lateralSpeed += steer * 245 * dt;
      lateralSpeed *= Math.pow(.962, dt * 60); // letting the rear slide creates the drift arc
      s.driftTime += dt;
      s.driftBank += Math.abs(forwardSpeed) * dt * .44;
      s.maxCombo = Math.max(s.maxCombo, currentCombo());
      if (Math.random() < .72) addSkid(car, forwardX, forwardY);
      if (Math.random() < .4) addParticle(car, leftX, leftY, steer);
    } else {
      lateralSpeed *= Math.pow(.56, dt * 60); // strong grip when the handbrake is released
      if (s.wasDrifting) settleDrift();
    }
    s.wasDrifting = drifting;

    const friction = drifting ? .989 : .981;
    forwardSpeed *= Math.pow(friction, dt * 60);
    car.vx = forwardX * forwardSpeed + leftX * lateralSpeed;
    car.vy = forwardY * forwardSpeed + leftY * lateralSpeed;
    car.x += car.vx * dt; car.y += car.vy * dt;

    if (carHitsWall(car)) {
      car.x -= car.vx * dt * 2.1; car.y -= car.vy * dt * 2.1;
      car.vx *= -.18; car.vy *= -.18;
      if (s.collisionCooldown <= 0) {
        s.collisionCooldown = .38; s.flash = .18; s.message = 'WALL HIT!'; s.messageTime = .55;
        s.driftBank = 0; s.driftTime = 0; s.wasDrifting = false;
      }
    }
    testCheckpoint();
    s.skidMarks = s.skidMarks.filter(mark => (mark.life -= dt) > 0);
    s.particles = s.particles.filter(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; return p.life > 0; });
    if (s.time <= 0) endGame();
    updateHud();
  }

  function currentCombo() { return 1 + Math.min(7, Math.floor(state.driftTime / 1.15)); }
  function settleDrift() {
    if (state.driftBank >= 20) {
      const multiplier = currentCombo();
      state.score += Math.round(state.driftBank * multiplier);
      state.maxCombo = Math.max(state.maxCombo, multiplier);
      state.message = `DRIFT BANKED  x${multiplier}`; state.messageTime = .7;
    }
    state.driftBank = 0; state.driftTime = 0;
  }
  function testCheckpoint() {
    const s = state, cp = checkpoints[s.nextCheckpoint], dx = s.car.x - cp.x, dy = s.car.y - cp.y;
    if (dx * dx + dy * dy < 44 * 44) {
      s.score += 350 + s.nextCheckpoint * 50; s.checkpointCount++; s.nextCheckpoint = (s.nextCheckpoint + 1) % checkpoints.length;
      s.message = s.nextCheckpoint === 0 ? 'LAP LINK +600' : `CHECKPOINT ${cp.label} +${350 + ((s.nextCheckpoint + 3) % 4) * 50}`;
      if (s.nextCheckpoint === 0) s.score += 600;
      s.messageTime = .8;
    }
  }
  function addSkid(car, fx, fy) {
    const side = Math.random() > .5 ? 12 : -12;
    state.skidMarks.push({ x: car.x - fx * 15 - fy * side, y: car.y - fy * 15 + fx * side, angle: car.angle, life: 1.15 });
    if (state.skidMarks.length > 160) state.skidMarks.shift();
  }
  function addParticle(car, lx, ly, steer) {
    state.particles.push({ x: car.x - Math.cos(car.angle) * 16 + lx * steer * 13, y: car.y - Math.sin(car.angle) * 16 + ly * steer * 13, vx: -car.vx * .12 + (Math.random() - .5) * 30, vy: -car.vy * .12 + (Math.random() - .5) * 30, life: .4 + Math.random() * .35 });
  }

  function drawRounded(rect, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r); if (fill) ctx.fillStyle = fill, ctx.fill(); if (stroke) ctx.strokeStyle = stroke, ctx.stroke();
  }
  function draw() {
    const s = state, car = s.car;
    ctx.clearRect(0, 0, W, H);
    // City-grid backdrop.
    ctx.fillStyle = '#101a2b'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(91,139,188,.12)'; ctx.lineWidth = 1;
    for (let x = -20; x < W; x += 38) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+180,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 46) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y-80); ctx.stroke(); }
    drawRounded(track.outer, '#26313b', 'rgba(111,211,255,.25)');
    drawRounded({ ...track.outer, x: track.outer.x + 13, y: track.outer.y + 13, w: track.outer.w - 26, h: track.outer.h - 26, r: track.outer.r - 13 }, '#353b42');
    drawRounded(track.inner, '#152534', 'rgba(125,219,255,.17)');
    // Road markings travel around the ring as segmented edge guide lines.
    ctx.setLineDash([16, 20]); ctx.lineDashOffset = -s.time * 80; ctx.lineWidth = 2; drawRounded({ x: 190, y: 132, w: 900, h: 455, r: 140 }, null, 'rgba(228,244,255,.38)'); ctx.setLineDash([]);
    s.skidMarks.forEach(mark => { ctx.save(); ctx.globalAlpha = mark.life * .35; ctx.translate(mark.x, mark.y); ctx.rotate(mark.angle); ctx.fillStyle = '#090b0d'; ctx.fillRect(-8, -2, 18, 4); ctx.restore(); });
    s.particles.forEach(p => { ctx.globalAlpha = p.life * 1.3; ctx.fillStyle = '#d7f8ff'; ctx.fillRect(p.x, p.y, 2, 2); }); ctx.globalAlpha = 1;
    checkpoints.forEach((cp, i) => drawCheckpoint(cp, i === s.nextCheckpoint));
    drawStartLine(); drawCar(car);
    if (s.messageTime > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, s.messageTime * 2); ctx.textAlign = 'center'; ctx.font = '900 italic 24px Arial'; ctx.fillStyle = s.message === 'WALL HIT!' ? '#ff6f83' : '#f3fbff'; ctx.fillText(s.message, W / 2, H / 2 - 5); ctx.restore(); }
    if (s.flash) { ctx.fillStyle = `rgba(255,52,86,${s.flash * 1.5})`; ctx.fillRect(0, 0, W, H); }
  }
  function drawCheckpoint(cp, active) {
    ctx.save(); ctx.translate(cp.x, cp.y); ctx.rotate(cp.angle); const color = active ? '#ff4aac' : '#4b7691';
    ctx.globalAlpha = active ? .9 : .4; ctx.fillStyle = color; ctx.fillRect(-5, -65, 10, 130); ctx.shadowColor = color; ctx.shadowBlur = active ? 20 : 0; ctx.fillRect(-2, -65, 4, 130); ctx.globalAlpha = 1; ctx.fillStyle = '#e9f8ff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText(cp.label, 0, -78); ctx.restore();
  }
  function drawStartLine() { ctx.save(); ctx.translate(350, 568); for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#e9eff2' : '#20262d'; ctx.fillRect(i * 8 - 32, j * 10 - 10, 8, 10); } ctx.restore(); }
  function drawCar(car) {
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.angle); ctx.shadowColor = '#58eaff'; ctx.shadowBlur = 17; ctx.fillStyle = '#40b9e8'; ctx.beginPath(); ctx.moveTo(25,0); ctx.lineTo(11,14); ctx.lineTo(-20,13); ctx.lineTo(-27,0); ctx.lineTo(-20,-13); ctx.lineTo(11,-14); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#101729'; ctx.fillRect(-9,-9,17,18); ctx.fillStyle = '#e7faff'; ctx.fillRect(13,-9,6,5); ctx.fillRect(13,4,6,5); ctx.fillStyle = '#ff4b9d'; ctx.fillRect(-22,-9,5,4); ctx.fillRect(-22,5,5,4); ctx.restore();
  }
  function updateHud() {
    const s = state, speed = Math.round(Math.hypot(s.car.vx, s.car.vy) * .56);
    ui.time.textContent = s.time.toFixed(1); ui.score.textContent = Math.round(s.score + s.driftBank * currentCombo()).toLocaleString(); ui.combo.textContent = `x${currentCombo()}`; ui.speed.innerHTML = `${speed} <i>KM/H</i>`;
  }
  function endGame() {
    if (state.ended) return;
    if (state.wasDrifting) settleDrift();
    state.running = false; state.ended = true;
    ui.finalScore.textContent = Math.round(state.score).toLocaleString(); ui.finalCombo.textContent = `x${state.maxCombo}`; ui.finalCheckpoints.textContent = state.checkpointCount; ui.end.classList.add('visible');
  }
  function loop(now) { const dt = Math.min(.033, (now - lastTime) / 1000 || 0); lastTime = now; if (state.running) update(dt); draw(); if (!state.ended) animationId = requestAnimationFrame(loop); }

  window.addEventListener('keydown', event => { if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) event.preventDefault(); keys.add(event.code); });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  ui.startButton.addEventListener('click', startGame); ui.restartButton.addEventListener('click', startGame);
  resetGame(); draw();
})();
