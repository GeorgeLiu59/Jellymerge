import Matter from "matter-js";
import { jellycatSprites } from "./jellycatSprites.js";
import "./styles.css";

const { Engine, World, Bodies, Body, Events, Composite } = Matter;

const radii = [18, 24, 31, 40, 50, 70, 80, 108, 120, 142, 164];
const evolutionAngles = [20, 52, 84, 116, 148, 180, 212, 244, 276, 308, 340];
const flowerChain = jellycatSprites.map((sprite, index) => ({
  ...sprite,
  radius: radii[index]
}));
const finalFlower = flowerChain[flowerChain.length - 1];
const spriteImages = new Map();

for (const sprite of flowerChain) {
  const image = new Image();
  image.src = sprite.src;
  spriteImages.set(sprite.src, image);
}

const app = document.querySelector("#app");
app.innerHTML = `
  <main class="shell">
    <div class="quick-controls" aria-label="Quick controls">
      <button id="musicButton" type="button">Music Off</button>
      <button id="restartButton" type="button">Reset</button>
    </div>

    <section class="arcade-layout" aria-label="Full Bloom Suika game">
      <aside class="left-rail" aria-label="Score and controls">
        <div class="score-bubble" aria-live="polite">
          <span class="bubble-title">Score</span>
          <strong id="score">0</strong>
          <span class="best-label">Best Score</span>
          <b id="best">0</b>
        </div>

        <div class="love-board">
          <details class="love-envelope">
            <summary aria-label="Open or close message envelope"></summary>
            <div class="envelope-letter">
              <p>
                Happy 4 Years, Babe! I know you always want to know which Jellycat you're getting, so I'm letting you
                reveal it yourself. There's just one catch: you have to win the game first... Goodluck!
                <br /><br />
                Love,<br />
                George
              </p>
            </div>
          </details>
        </div>
      </aside>

      <div class="center-rig">
        <div class="stage-wrap">
          <canvas id="game" aria-label="Flower merge game canvas"></canvas>
        </div>
      </div>

      <aside class="right-rail" aria-label="Next plush and evolution">
        <div class="next-bubble">
          <span class="bubble-title">Next</span>
          <canvas id="next" width="112" height="112" aria-label="Next flower preview"></canvas>
        </div>

        <div class="evolution-panel">
          <h2>Jellycat Evolution</h2>
          <div class="evolution-path" aria-label="Jellycat evolution chain">
            ${flowerChain
              .map(
                (sprite, index) => `
                  <span class="evolution-step ${index === flowerChain.length - 1 ? "evolution-final is-hidden" : ""}" style="--angle: ${evolutionAngles[index]}deg;" title="${index + 1}. ${index === flowerChain.length - 1 ? "Mystery Gift" : sprite.name}">
                    <img src="${sprite.src}" alt="${sprite.name}" />
                    ${index === flowerChain.length - 1 ? '<span class="mystery-mark" aria-hidden="true">?</span>' : ""}
                  </span>
                `
              )
              .join("")}
          </div>
        </div>
      </aside>
    </section>

    <div class="card-backdrop" id="winCard" hidden>
      <div class="anniversary-card">
        <p class="eyebrow">Gift Revealed</p>
        <img class="final-gift" src="${finalFlower.src}" alt="${finalFlower.name}" />
        <p>You did it! I love you so much, 4 years down and so many years to go! Can't wait to create more memories (and get more Jellycats) with you!</p>
        <div class="win-actions">
          <button id="continueButton" type="button">Continue</button>
          <button id="winRestartButton" type="button">Restart</button>
        </div>
      </div>
    </div>

    <div class="card-backdrop" id="gameOverCard" hidden>
      <div class="anniversary-card game-over-card">
        <p class="eyebrow">Almost There</p>
        <h2>Game Over</h2>
        <p>So close babe, good things don't come easy...</p>
        <button id="gameOverRestartButton" type="button">Try Again</button>
      </div>
    </div>
  </main>
`;

const canvas = document.querySelector("#game");
let ctx = canvas.getContext("2d");
const nextCanvas = document.querySelector("#next");
const nextCtx = nextCanvas.getContext("2d");
const scoreEl = document.querySelector("#score");
const bestEl = document.querySelector("#best");
const musicButton = document.querySelector("#musicButton");
const restartButton = document.querySelector("#restartButton");
const continueButton = document.querySelector("#continueButton");
const winRestartButton = document.querySelector("#winRestartButton");
const winCard = document.querySelector("#winCard");
const gameOverCard = document.querySelector("#gameOverCard");
const gameOverRestartButton = document.querySelector("#gameOverRestartButton");
const stageWrap = document.querySelector(".stage-wrap");
const finalEvolutionStep = document.querySelector(".evolution-final");

let engine;
let walls = [];
let width = 420;
let height = 680;
let dpr = 1;
let raf = 0;
let score = 0;
let best = Number(localStorage.getItem("flowerSuikaBest") || 0);
let cursorX = width / 2;
let currentLevel = 0;
let nextLevel = 0;
let canDrop = true;
let won = false;
let lost = false;
let gameOverTimer = 0;
let lastFrame = performance.now();
const merging = new Set();
const floorInset = 8;
const floorThickness = 44;
/** Top chrome: carrier rides along the bottom edge of this bar. */
const RAIL_TOP = 20;
const RAIL_HEIGHT = 26;
const RAIL_BOTTOM = RAIL_TOP + RAIL_HEIGHT;
const PLAY_DEPTH_SKEW = 24;
const suikaPhysics = {
  friction: 0.032,
  frictionStatic: 0.04,
  frictionAir: 0.006,
  restitution: 0.01,
  slop: 0.05
};
const DEBUG_HITBOXES = new URLSearchParams(window.location.search).has("hitboxes");

for (const image of spriteImages.values()) {
  image.addEventListener("load", updateNextPreview);
}

bestEl.textContent = best;
setFinalEvolutionReveal(false);

function setFinalEvolutionReveal(revealed) {
  if (!finalEvolutionStep) return;
  finalEvolutionStep.classList.toggle("is-hidden", !revealed);
  finalEvolutionStep.title = `${flowerChain.length}. ${revealed ? finalFlower.name : "Mystery Gift"}`;
}

function pickNextLevel() {
  return Math.floor(Math.random() * 5);
}

function createEngine() {
  engine = Engine.create({
    gravity: { x: 0, y: 1.05 }
  });
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  addWalls();

  Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const a = getFlowerBody(pair.bodyA);
      const b = getFlowerBody(pair.bodyB);
      if (a === b) continue;
      if (!a.flower || !b.flower || a.flower.level !== b.flower.level) continue;
      if (a.flower.level >= flowerChain.length - 1) continue;
      if (merging.has(a.id) || merging.has(b.id)) continue;
      mergeFlowers(a, b);
    }
  });
}

function addWalls() {
  if (!engine) return;
  World.remove(engine.world, walls);
  const wallOptions = {
    isStatic: true,
    render: { visible: false },
    ...suikaPhysics
  };
  const floorY = height - floorInset;
  walls = [
    Bodies.rectangle(-18, height / 2, 36, height * 2, wallOptions),
    Bodies.rectangle(width + 18, height / 2, 36, height * 2, wallOptions),
    Bodies.rectangle(width / 2, floorY + floorThickness / 2, width + 80, floorThickness, wallOptions)
  ];
  World.add(engine.world, walls);
}

function makeFlower(level, x, y) {
  const flower = flowerChain[level];
  const parts = createSpriteHitbox(flower.parts, x, y, flower.radius);
  const body = Body.create({
    parts,
    ...suikaPhysics,
    density: 0.0014 + level * 0.00013,
    label: flower.name
  });
  Body.setPosition(body, { x, y });
  Body.setInertia(body, body.inertia * 2.2);
  body.flower = { level, bornAt: performance.now() };
  for (const part of body.parts) part.flower = body.flower;
  return body;
}

function getFlowerBody(body) {
  return body.parent && body.parent.flower ? body.parent : body;
}

function createSpriteHitbox(spriteParts, x, y, radius) {
  const scale = radius <= 50 ? 0.82 : radius <= 101 ? 0.88 : 0.92;
  const partOptions = {
    ...suikaPhysics,
    render: { visible: false }
  };
  return spriteParts.map((part) =>
    Bodies.circle(
      x + part.x * radius,
      y + part.y * radius,
      Math.max(3.2, part.r * radius * 2 * scale),
      partOptions
    )
  );
}

function dropFlower() {
  if (!canDrop || won || lost) return;
  startAudio();
  const level = currentLevel;
  const x = clamp(cursorX, 10, width - 10);
  const flower = makeFlower(level, x, RAIL_BOTTOM + 40);
  World.add(engine.world, flower);
  currentLevel = nextLevel;
  nextLevel = pickNextLevel();
  updateNextPreview();
  playDropSound();
  canDrop = false;
  setTimeout(() => {
    canDrop = true;
  }, 520);
}

function mergeFlowers(a, b) {
  merging.add(a.id);
  merging.add(b.id);
  const level = a.flower.level + 1;
  const x = (a.position.x + b.position.x) / 2;
  const y = (a.position.y + b.position.y) / 2;
  const vx = (a.velocity.x + b.velocity.x) / 2;
  const vy = (a.velocity.y + b.velocity.y) / 2;
  const created = makeFlower(level, x, y);
  Body.setVelocity(created, { x: vx * 0.22, y: vy * 0.22 - 0.7 });

  setTimeout(() => {
    World.remove(engine.world, [a, b]);
    World.add(engine.world, created);
    score += (level + 1) * 44;
    best = Math.max(best, score);
    localStorage.setItem("flowerSuikaBest", String(best));
    scoreEl.textContent = score;
    bestEl.textContent = best;
    playMergeSound(level);
    if (level === flowerChain.length - 1) fullBloom();
    setTimeout(() => {
      merging.delete(a.id);
      merging.delete(b.id);
    }, 120);
  }, 18);
}

function fullBloom() {
  if (won) return;
  won = true;
  setFinalEvolutionReveal(true);
  playWinSound();
  launchPetals(110);
  setTimeout(() => {
    winCard.hidden = false;
  }, 780);
}

function continueAfterWin() {
  winCard.hidden = true;
  won = false;
}

function showGameOver() {
  if (lost || won) return;
  lost = true;
  canDrop = false;
  setTimeout(() => {
    gameOverCard.hidden = false;
  }, 260);
}

function restartGame() {
  won = false;
  lost = false;
  canDrop = true;
  setFinalEvolutionReveal(false);
  winCard.hidden = true;
  gameOverCard.hidden = true;
  score = 0;
  scoreEl.textContent = "0";
  gameOverTimer = 0;
  merging.clear();
  cancelAnimationFrame(raf);
  Engine.clear(engine);
  Composite.clear(engine.world, false);
  addWalls();
  currentLevel = pickNextLevel();
  nextLevel = pickNextLevel();
  updateNextPreview();
  lastFrame = performance.now();
  loop(lastFrame);
}

function resizeCanvas() {
  width = Math.max(300, Math.floor(stageWrap.clientWidth));
  height = Math.max(320, Math.floor(stageWrap.clientHeight));
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cursorX = clamp(cursorX, 20, width - 20);
  addWalls();
}

function loop(now) {
  const delta = Math.min(now - lastFrame, 32);
  lastFrame = now;
  Engine.update(engine, Math.min(delta, 1000 / 60));
  checkGameOver(delta);
  draw();
  raf = requestAnimationFrame(loop);
}

function checkGameOver(delta) {
  if (won || lost) return;
  const flowers = Composite.allBodies(engine.world).filter((body) => body.flower);
  const dangerY = RAIL_BOTTOM + 6;
  const crowded = flowers.some(
    (body) =>
      body.position.y - flowerChain[body.flower.level].radius < dangerY && performance.now() - body.flower.bornAt > 1500
  );
  gameOverTimer = crowded ? gameOverTimer + delta : 0;
  if (gameOverTimer > 1200) {
    showGameOver();
    gameOverTimer = 0;
  }
}

function draw() {
  drawBackground();
  drawDropper();

  const flowers = Composite.allBodies(engine.world)
    .filter((body) => body.flower)
    .sort((a, b) => a.flower.level - b.flower.level);

  for (const body of flowers) drawFlowerBody(body);
  drawPetals();
}

function drawBackground() {
  const floorY = height - floorInset;
  const playTop = RAIL_BOTTOM;
  const skew = Math.min(PLAY_DEPTH_SKEW, width * 0.065);
  const floorPlateTop = floorY - floorThickness * 0.55;

  const chamberBg = ctx.createLinearGradient(0, playTop, 0, floorY);
  chamberBg.addColorStop(0, "#fffdf8");
  chamberBg.addColorStop(0.55, "#fff9f0");
  chamberBg.addColorStop(1, "#fdf6eb");
  ctx.fillStyle = chamberBg;
  ctx.fillRect(0, 0, width, height);

  drawTopRail();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, playTop);
  ctx.lineTo(width, playTop);
  ctx.lineTo(width, floorY);
  ctx.lineTo(0, floorY);
  ctx.closePath();
  ctx.clip();

  const backShade = ctx.createLinearGradient(0, playTop, width, playTop);
  backShade.addColorStop(0, "rgba(255, 252, 246, 0.35)");
  backShade.addColorStop(0.5, "rgba(245, 236, 220, 0.12)");
  backShade.addColorStop(1, "rgba(255, 252, 246, 0.35)");
  ctx.fillStyle = backShade;
  ctx.fillRect(0, playTop, width, floorY - playTop);

  const leftWall = ctx.createLinearGradient(0, playTop, skew * 2.2, playTop);
  leftWall.addColorStop(0, "rgba(255, 255, 255, 0.5)");
  leftWall.addColorStop(1, "rgba(230, 218, 200, 0.08)");
  ctx.fillStyle = leftWall;
  ctx.beginPath();
  ctx.moveTo(0, playTop);
  ctx.lineTo(skew, playTop + 6);
  ctx.lineTo(skew * 0.92, floorPlateTop);
  ctx.lineTo(0, floorY);
  ctx.closePath();
  ctx.fill();

  const rightWall = ctx.createLinearGradient(width, playTop, width - skew * 2.2, playTop);
  rightWall.addColorStop(0, "rgba(255, 255, 255, 0.38)");
  rightWall.addColorStop(1, "rgba(200, 186, 168, 0.12)");
  ctx.fillStyle = rightWall;
  ctx.beginPath();
  ctx.moveTo(width, playTop);
  ctx.lineTo(width - skew, playTop + 6);
  ctx.lineTo(width - skew * 0.92, floorPlateTop);
  ctx.lineTo(width, floorY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0.5, playTop + 0.5);
  ctx.lineTo(width - 0.5, playTop + 0.5);
  ctx.stroke();

  const floorGrad = ctx.createLinearGradient(0, floorPlateTop, 0, floorY);
  floorGrad.addColorStop(0, "#fbf4e8");
  floorGrad.addColorStop(0.45, "#f5ead8");
  floorGrad.addColorStop(1, "#ead9c4");
  ctx.fillStyle = floorGrad;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(width, floorY);
  ctx.lineTo(width - skew * 0.35, floorPlateTop + 4);
  ctx.lineTo(skew * 0.35, floorPlateTop + 4);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(skew * 0.35, floorPlateTop + 4);
  ctx.lineTo(width - skew * 0.35, floorPlateTop + 4);
  ctx.stroke();

  ctx.restore();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, playTop + 0.5, width - 1, floorY - playTop - 1);
}

function drawTopRail() {
  const railGrad = ctx.createLinearGradient(0, RAIL_TOP, 0, RAIL_BOTTOM);
  railGrad.addColorStop(0, "#fffefb");
  railGrad.addColorStop(0.45, "#f3ebe0");
  railGrad.addColorStop(1, "#e8dfd4");
  ctx.fillStyle = railGrad;
  ctx.fillRect(0, RAIL_TOP, width, RAIL_HEIGHT);

  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillRect(0, RAIL_TOP, width, Math.max(2, RAIL_HEIGHT * 0.22));

  ctx.strokeStyle = "rgba(200, 182, 160, 0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, RAIL_TOP + 0.5, width - 1, RAIL_HEIGHT - 1);

  const grooveY = RAIL_BOTTOM - 5;
  ctx.strokeStyle = "rgba(160, 140, 120, 0.2)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(14, grooveY);
  ctx.lineTo(width - 14, grooveY);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(14, grooveY - 2);
  ctx.lineTo(width - 14, grooveY - 2);
  ctx.stroke();
}

function drawDropper() {
  const level = currentLevel;
  const radius = flowerChain[level].radius;
  const x = clamp(cursorX, 10, width - 10);
  const heldRadius = radius;
  ctx.save();
  ctx.globalAlpha = canDrop ? 1 : 0.45;
  ctx.translate(x, RAIL_BOTTOM - 1);
  ctx.shadowColor = "rgba(55, 45, 40, 0.14)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  drawCloudCarrier(heldRadius, flowerChain[level]);
  ctx.shadowColor = "transparent";
  ctx.restore();
}

function drawFlowerBody(body) {
  const level = body.flower.level;
  const data = flowerChain[level];
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  drawPlush(0, 0, data.radius, data);
  if (DEBUG_HITBOXES) drawBodyHitboxes(body);
  ctx.restore();
}

function drawBodyHitboxes(body) {
  ctx.strokeStyle = "rgba(79, 180, 244, 0.42)";
  ctx.lineWidth = 1.2;
  for (const part of body.parts) {
    if (part === body) continue;
    const dx = part.position.x - body.position.x;
    const dy = part.position.y - body.position.y;
    ctx.beginPath();
    ctx.arc(dx, dy, part.circleRadius || 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPlush(x, y, radius, data) {
  ctx.save();
  ctx.translate(x, y);
  const image = spriteImages.get(data.src);
  drawPlushShadow(radius);
  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, -radius, -radius, radius * 2, radius * 2);
  } else {
    drawLoadingPlush(radius);
  }
  ctx.restore();
}

function drawPlushShadow() {}

function drawLoadingPlush(radius) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.48, radius * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(214, 95, 145, 0.65)";
  ctx.beginPath();
  ctx.arc(-radius * 0.12, -radius * 0.06, radius * 0.035, 0, Math.PI * 2);
  ctx.arc(radius * 0.12, -radius * 0.06, radius * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

function plushGradient(radius, colors) {
  const gradient = ctx.createRadialGradient(-radius * 0.24, -radius * 0.42, radius * 0.08, 0, 0, radius * 0.95);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.48, colors[0]);
  gradient.addColorStop(1, colors[1]);
  return gradient;
}

function drawSoftEllipse(x, y, rx, ry, fill, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlushBody(radius, colors) {
  const fill = plushGradient(radius, colors);
  drawSoftEllipse(0, radius * 0.1, radius * 0.52, radius * 0.62, fill);
  drawSoftEllipse(0, -radius * 0.36, radius * 0.4, radius * 0.36, fill);
  drawSoftEllipse(-radius * 0.28, radius * 0.45, radius * 0.18, radius * 0.16, colors[0], -0.2);
  drawSoftEllipse(radius * 0.28, radius * 0.45, radius * 0.18, radius * 0.16, colors[0], 0.2);
  drawStitching(radius, colors);
}

function drawStitching(radius, colors) {
  ctx.strokeStyle = "rgba(113, 91, 120, 0.14)";
  ctx.lineWidth = Math.max(1, radius * 0.018);
  ctx.setLineDash([radius * 0.04, radius * 0.04]);
  ctx.beginPath();
  ctx.arc(0, radius * 0.1, radius * 0.42, Math.PI * 0.18, Math.PI * 0.82);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.beginPath();
  ctx.ellipse(-radius * 0.18, -radius * 0.46, radius * 0.12, radius * 0.05, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawBunnyPlush(radius, data) {
  const colors = data.colors;
  drawBunnyEars(radius, colors);
  drawPlushBody(radius, colors);
  drawPaws(radius, colors);
  drawFlowerAccent(radius, data.flower, colors[2], colors[3]);
  drawPlushFace(radius, "bunny");
}

function drawBunnyEars(radius, colors) {
  drawSoftEllipse(-radius * 0.22, -radius * 0.84, radius * 0.12, radius * 0.42, colors[1], -0.1);
  drawSoftEllipse(radius * 0.24, -radius * 0.84, radius * 0.12, radius * 0.42, colors[1], 0.12);
  drawSoftEllipse(-radius * 0.22, -radius * 0.84, radius * 0.06, radius * 0.3, "rgba(255, 190, 211, 0.62)", -0.1);
  drawSoftEllipse(radius * 0.24, -radius * 0.84, radius * 0.06, radius * 0.3, "rgba(255, 190, 211, 0.62)", 0.12);
}

function drawPuppyPlush(radius, data) {
  const colors = data.colors;
  drawSoftEllipse(-radius * 0.44, -radius * 0.24, radius * 0.18, radius * 0.34, colors[1], 0.34);
  drawSoftEllipse(radius * 0.44, -radius * 0.24, radius * 0.18, radius * 0.34, colors[1], -0.34);
  drawPlushBody(radius, colors);
  drawSoftEllipse(0, -radius * 0.2, radius * 0.18, radius * 0.12, "#fff8fb");
  drawPaws(radius, colors);
  drawFlowerAccent(radius, data.flower, colors[2], colors[3]);
  drawPlushFace(radius, "puppy");
}

function drawLambPlush(radius, data) {
  const colors = data.colors;
  drawSoftEllipse(-radius * 0.4, -radius * 0.52, radius * 0.17, radius * 0.14, colors[1]);
  drawSoftEllipse(0, -radius * 0.66, radius * 0.2, radius * 0.16, colors[1]);
  drawSoftEllipse(radius * 0.4, -radius * 0.52, radius * 0.17, radius * 0.14, colors[1]);
  drawSoftEllipse(-radius * 0.48, -radius * 0.16, radius * 0.14, radius * 0.2, colors[1], -0.24);
  drawSoftEllipse(radius * 0.48, -radius * 0.16, radius * 0.14, radius * 0.2, colors[1], 0.24);
  drawPlushBody(radius, colors);
  drawPaws(radius, colors);
  drawFlowerAccent(radius, data.flower, colors[2], colors[3]);
  drawPlushFace(radius, "lamb");
}

function drawBearPlush(radius, data) {
  const colors = data.colors;
  drawSoftEllipse(-radius * 0.34, -radius * 0.66, radius * 0.17, radius * 0.16, colors[1]);
  drawSoftEllipse(radius * 0.34, -radius * 0.66, radius * 0.17, radius * 0.16, colors[1]);
  drawPlushBody(radius, colors);
  drawSoftEllipse(-radius * 0.34, -radius * 0.66, radius * 0.08, radius * 0.07, "rgba(255, 200, 218, 0.62)");
  drawSoftEllipse(radius * 0.34, -radius * 0.66, radius * 0.08, radius * 0.07, "rgba(255, 200, 218, 0.62)");
  drawPaws(radius, colors);
  drawFlowerAccent(radius, data.flower, colors[2], colors[3]);
  drawPlushFace(radius, "bear");
}

function drawDuckPlush(radius, data) {
  const colors = data.colors;
  drawSoftEllipse(0, radius * 0.12, radius * 0.58, radius * 0.55, plushGradient(radius, colors));
  drawSoftEllipse(0.08 * radius, -radius * 0.42, radius * 0.38, radius * 0.35, plushGradient(radius, colors));
  drawSoftEllipse(-radius * 0.36, radius * 0.04, radius * 0.28, radius * 0.18, colors[1], -0.26);
  drawSoftEllipse(radius * 0.52, -radius * 0.42, radius * 0.18, radius * 0.1, colors[3], 0.08);
  drawPaws(radius, colors);
  drawFlowerAccent(radius, data.flower, colors[2], colors[3]);
  drawPlushFace(radius, "duck");
}

function drawDragonPlush(radius, data) {
  const colors = data.colors;
  drawSoftEllipse(-radius * 0.52, -radius * 0.04, radius * 0.28, radius * 0.42, colors[3], -0.42);
  drawSoftEllipse(radius * 0.52, -radius * 0.04, radius * 0.28, radius * 0.42, colors[3], 0.42);
  drawSoftEllipse(radius * 0.58, radius * 0.42, radius * 0.28, radius * 0.12, colors[1], 0.4);
  drawPlushBody(radius, colors);
  drawSoftEllipse(-radius * 0.2, -radius * 0.78, radius * 0.08, radius * 0.18, colors[2], -0.18);
  drawSoftEllipse(radius * 0.2, -radius * 0.78, radius * 0.08, radius * 0.18, colors[2], 0.18);
  drawPaws(radius, colors);
  drawFlowerAccent(radius, data.flower, colors[2], colors[3]);
  drawPlushFace(radius, "dragon");
}

function drawKittyPlush(radius, data) {
  const colors = data.colors;
  drawTriangleEar(-radius * 0.32, -radius * 0.72, radius * 0.22, colors[1], -0.1);
  drawTriangleEar(radius * 0.32, -radius * 0.72, radius * 0.22, colors[1], 0.1);
  drawPlushBody(radius, colors);
  drawPaws(radius, colors);
  drawFlowerAccent(radius, data.flower, colors[2], colors[3]);
  drawPlushFace(radius, "kitty");
}

function drawTriangleEar(x, y, size, fill, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.86, size * 0.62);
  ctx.lineTo(-size * 0.86, size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHydrangeaPlush(radius, data) {
  const colors = data.colors;
  drawBunnyEars(radius, [colors[0], colors[1]]);
  drawPlushBody(radius, colors);
  for (let i = 0; i < 24; i += 1) {
    const angle = i * 2.399 + 0.2;
    const dist = radius * (0.16 + (i % 6) * 0.09);
    ctx.save();
    ctx.translate(Math.cos(angle) * dist, -radius * 0.1 + Math.sin(angle) * dist);
    ctx.rotate(angle);
    drawTinyBlossom(radius * 0.07, i % 3 === 0 ? colors[1] : i % 2 ? colors[2] : colors[3]);
    ctx.restore();
  }
  drawPaws(radius, colors);
  drawPlushFace(radius, "bunny");
}

function drawPaws(radius, colors) {
  drawSoftEllipse(-radius * 0.22, radius * 0.56, radius * 0.13, radius * 0.09, colors[1], -0.08);
  drawSoftEllipse(radius * 0.22, radius * 0.56, radius * 0.13, radius * 0.09, colors[1], 0.08);
  ctx.fillStyle = "rgba(112, 87, 125, 0.24)";
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(side * radius * (0.18 + i * 0.035), radius * 0.55, Math.max(1.2, radius * 0.012), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlushFace(radius, kind) {
  const faceY = kind === "duck" ? -radius * 0.42 : -radius * 0.34;
  ctx.fillStyle = "rgba(73, 61, 82, 0.78)";
  ctx.beginPath();
  ctx.arc(-radius * 0.13, faceY, radius * 0.034, 0, Math.PI * 2);
  ctx.arc(radius * 0.13, faceY, radius * 0.034, 0, Math.PI * 2);
  ctx.fill();

  if (kind !== "duck") {
    ctx.fillStyle = "rgba(73, 61, 82, 0.68)";
    ctx.beginPath();
    ctx.ellipse(0, faceY + radius * 0.08, radius * 0.035, radius * 0.024, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(73, 61, 82, 0.62)";
  ctx.lineWidth = Math.max(1, radius * 0.018);
  ctx.beginPath();
  ctx.arc(0, faceY + radius * 0.1, radius * 0.1, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 151, 178, 0.25)";
  ctx.beginPath();
  ctx.ellipse(-radius * 0.27, faceY + radius * 0.1, radius * 0.08, radius * 0.04, 0, 0, Math.PI * 2);
  ctx.ellipse(radius * 0.27, faceY + radius * 0.1, radius * 0.08, radius * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlowerAccent(radius, flower, petalColor, centerColor) {
  ctx.save();
  const crown = flower === "hydrangea" || flower === "bouquet";
  const count = crown ? 9 : flower === "daisy" ? 7 : 5;
  const y = crown ? -radius * 0.72 : radius * 0.04;
  const spread = crown ? radius * 0.46 : radius * 0.22;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const px = crown ? -spread + t * spread * 2 : radius * 0.28;
    const py = crown ? y + Math.sin(t * Math.PI) * -radius * 0.08 : y;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(i * 0.7);
    drawTinyBlossom(radius * (crown ? 0.055 : 0.075), i % 2 ? petalColor : "#fff7fb", centerColor);
    ctx.restore();
    if (!crown) break;
  }
  ctx.restore();
}

function drawTinyBlossom(size, color, center = "#fff6ae") {
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i += 1) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -size, size * 0.62, size, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloudCarrier(heldRadius, data) {
  ctx.save();
  const scale = Math.min(1, 102 / (heldRadius + 38));
  ctx.scale(scale, scale);
  const dropY = heldRadius + 22;
  const cy = -14;

  ctx.fillStyle = "rgba(55, 45, 40, 0.08)";
  ctx.beginPath();
  ctx.ellipse(0, 4, 44, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  const puff = (px, py, r) => {
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.fillStyle = "#fdfcfa";
  puff(-24, cy, 13);
  puff(-10, cy - 7, 17);
  puff(8, cy - 6, 16);
  puff(26, cy, 12);
  puff(0, cy + 10, 23);
  puff(-18, cy + 6, 11);
  puff(18, cy + 5, 11);

  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.ellipse(-14, cy - 8, 9, 4, -0.35, 0, Math.PI * 2);
  ctx.ellipse(12, cy - 6, 7, 3.2, 0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(210, 195, 185, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(-10, cy - 3, 12, 0.8, 2.1);
  ctx.stroke();

  ctx.fillStyle = "#6b5d56";
  ctx.beginPath();
  ctx.arc(-8, cy - 1, 2.1, 0, Math.PI * 2);
  ctx.arc(8, cy - 1, 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#8a7a72";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, cy + 3, 5.5, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(190, 175, 165, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, cy + 20);
  ctx.quadraticCurveTo(1.5, cy + 30, 0, Math.max(cy + 36, dropY - heldRadius - 4));
  ctx.stroke();

  drawPlush(0, dropY, heldRadius, data);
  ctx.restore();
}

function updateNextPreview() {
  const data = flowerChain[nextLevel];
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  nextCtx.save();
  nextCtx.translate(nextCanvas.width / 2, nextCanvas.height / 2);
  drawPlushOnContext(nextCtx, 0, 5, 42, data);
  nextCtx.restore();
}

function drawPlushOnContext(targetCtx, x, y, radius, data) {
  const previous = ctx;
  ctx = targetCtx;
  drawPlush(x, y, radius, data);
  ctx = previous;
}

const petals = [];

function launchPetals(count) {
  for (let i = 0; i < count; i += 1) {
    petals.push({
      x: width / 2 + (Math.random() - 0.5) * width * 0.6,
      y: RAIL_BOTTOM + 36 + Math.random() * 100,
      vx: (Math.random() - 0.5) * 4,
      vy: 1 + Math.random() * 4,
      spin: (Math.random() - 0.5) * 0.2,
      angle: Math.random() * Math.PI * 2,
      size: 8 + Math.random() * 11,
      color: ["#ffc3d6", "#d7bcff", "#bde8d4", "#fff0a8"][Math.floor(Math.random() * 4)]
    });
  }
}

function drawPetals() {
  for (let i = petals.length - 1; i >= 0; i -= 1) {
    const petal = petals[i];
    petal.x += petal.vx;
    petal.y += petal.vy;
    petal.vy += 0.025;
    petal.angle += petal.spin;
    ctx.save();
    ctx.translate(petal.x, petal.y);
    ctx.rotate(petal.angle);
    ctx.fillStyle = petal.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, petal.size * 0.5, petal.size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (petal.y > height + 40) petals.splice(i, 1);
  }
}

let audioCtx;
let musicEnabled = false;
const musicTrack = new Audio(new URL("../suika_ost.mp3", import.meta.url));
musicTrack.loop = true;
musicTrack.preload = "auto";
musicTrack.volume = 0.5;

function startAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function toggleMusic() {
  musicEnabled = !musicEnabled;
  musicButton.textContent = musicEnabled ? "Music On" : "Music Off";
  if (musicEnabled) startMusic();
  else stopMusic();
}

function startMusic() {
  const attempt = musicTrack.play();
  if (attempt?.catch) {
    attempt.catch(() => {
      musicEnabled = false;
      musicButton.textContent = "Music Off";
    });
  }
}

function stopMusic() {
  musicTrack.pause();
}

function playDropSound() {
  playTone(520, 0.045, "sine", 0.025);
}

function playMergeSound(level) {
  playTone(640 + level * 24, 0.08, "triangle", 0.04);
  setTimeout(() => playTone(860 + level * 30, 0.07, "sine", 0.026), 55);
}

function playWinSound() {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
    setTimeout(() => playTone(freq, 0.28, "triangle", 0.052), index * 130);
  });
}

function playTone(freq, duration, type, volume) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration + 0.04);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  cursorX = ((event.clientX - rect.left) / rect.width) * width;
});

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  cursorX = ((event.clientX - rect.left) / rect.width) * width;
  dropFlower();
});

musicButton.addEventListener("click", toggleMusic);
restartButton.addEventListener("click", restartGame);
continueButton.addEventListener("click", continueAfterWin);
winRestartButton.addEventListener("click", restartGame);
gameOverRestartButton.addEventListener("click", restartGame);
window.addEventListener("resize", resizeCanvas);

createEngine();
currentLevel = pickNextLevel();
nextLevel = pickNextLevel();
resizeCanvas();
updateNextPreview();
loop(performance.now());
