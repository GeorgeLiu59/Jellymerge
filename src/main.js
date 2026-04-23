import Matter from "matter-js";
import { jellycatSprites } from "./jellycatSprites.js";
import "./styles.css";

const { Engine, World, Bodies, Body, Events, Composite } = Matter;
const isDev = import.meta.env.DEV;

const baseRadii = [25.725, 27.938, 35.154, 49.896, 62.37, 87.318, 84.5, 119, 132.5, 156.5, 181];
const radii = baseRadii.map((radius) => radius);
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
      ${isDev ? '<button id="debugWinButton" type="button">Debug Win</button><button id="debugLoseButton" type="button">Debug Lose</button>' : ""}
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
            Happy 4 Years, Babe! I saw that the traditional themes for a 4th anniversary are fruits and flowers, but real ones felt a bit too ordinary. I figured a Jellycat version would be much more exciting.
            <br /><br />
            I know you always want to know which one you're getting, so I'm letting you reveal it yourself. There's just one catch: you have to win the game first. Your gift will be revealed once you successfully unlock the final Jellycat... Good luck!
            <br /><br />
            Love,
            <br />
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
const debugWinButton = document.querySelector("#debugWinButton");
const debugLoseButton = document.querySelector("#debugLoseButton");
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
let highestLevelReached = 0;
let canDrop = true;
let won = false;
let lost = false;
let gameOverTimer = 0;
let lastFrame = performance.now();
let physicsAccumulator = 0;
let clawOpenAmount = 0.2;
const merging = new Set();
const flowerRenderBuckets = baseRadii.map(() => []);
const floorInset = 8;
const floorThickness = 44;
const FIXED_TIMESTEP = 1000 / 60;
const MAX_PHYSICS_STEPS = 4;
/** Top chrome: carrier rides along the bottom edge of this bar. */
const RAIL_TOP = 20;
const RAIL_HEIGHT = 26;
const RAIL_BOTTOM = RAIL_TOP + RAIL_HEIGHT;
const PLAY_DEPTH_SKEW = 24;
const suikaPhysics = {
  friction: 0.032,
  frictionStatic: 0.04,
  frictionAir: 0.0096,
  restitution: 0.0015,
  slop: 0.055
};
const DEBUG_HITBOXES = new URLSearchParams(window.location.search).has("hitboxes");

function syncRadiiToStageWidth() {
  const stageWidth = Math.max(300, Math.floor(stageWrap?.clientWidth || 740));
  const defaultStageWidth = 740;
  const shouldScaleByStageWidth = window.innerWidth <= 820;
  const stageRadiusScale = shouldScaleByStageWidth
    ? Math.min(1, (stageWidth / defaultStageWidth) * 1.4)
    : 1;
  for (let i = 0; i < baseRadii.length; i += 1) {
    const scaled = Number((baseRadii[i] * stageRadiusScale).toFixed(3));
    radii[i] = scaled;
    flowerChain[i].radius = scaled;
  }
}

function waitForImage(image) {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => resolve();
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
  });
}

async function preloadSpriteImages() {
  await Promise.all([...spriteImages.values()].map(waitForImage));
}

bestEl.textContent = best;
setFinalEvolutionReveal(false);

function setFinalEvolutionReveal(revealed) {
  if (!finalEvolutionStep) return;
  finalEvolutionStep.classList.toggle("is-hidden", !revealed);
  finalEvolutionStep.title = `${flowerChain.length}. ${revealed ? finalFlower.name : "Mystery Gift"}`;
}

function pickNextLevel() {
  const spawnProfiles = [
    { minReached: 10, levels: [1, 2, 3, 4], weights: [8, 24, 34, 34] },
    { minReached: 9, levels: [1, 2, 3, 4], weights: [10, 26, 34, 30] },
    { minReached: 8, levels: [0, 1, 2, 3, 4], weights: [3, 13, 30, 31, 23] },
    { minReached: 7, levels: [0, 1, 2, 3, 4], weights: [10, 18, 26, 26, 20] },
    { minReached: 6, levels: [0, 1, 2, 3, 4], weights: [14, 20, 24, 23, 19] },
    { minReached: 0, levels: [0, 1, 2, 3, 4], weights: [20, 20, 20, 20, 20] }
  ];
  const profile = spawnProfiles.find((entry) => highestLevelReached >= entry.minReached) || spawnProfiles.at(-1);
  const totalWeight = profile.weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < profile.weights.length; i += 1) {
    roll -= profile.weights[i];
    if (roll <= 0) return profile.levels[i];
  }
  return profile.levels[profile.levels.length - 1];
}

function createEngine() {
  engine = Engine.create({
    gravity: { x: 0, y: 1.5 },
    enableSleeping: true
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
  highestLevelReached = Math.max(highestLevelReached, level);
  const flower = flowerChain[level];
  const parts = createSpriteHitbox(flower.parts, x, y, flower.radius, level);
  const body = Body.create({
    parts,
    ...suikaPhysics,
    density: 0.0014 + level * 0.00013,
    label: flower.name
  });
  Body.setPosition(body, { x, y });
  Body.setInertia(body, body.inertia * 2.2);
  body.sleepThreshold = 40;
  body.flower = { level, bornAt: performance.now() };
  for (const part of body.parts) part.flower = body.flower;
  return body;
}

function getFlowerBody(body) {
  return body.parent && body.parent.flower ? body.parent : body;
}

function createSpriteHitbox(spriteParts, x, y, radius, level) {
  const spreadScale = radius <= 50 ? 0.99 : radius <= 101 ? 0.97 : 0.94;
  const radiusScale = radius <= 50 ? 0.8 : radius <= 101 ? 0.76 : 0.7;
  const levelTighten = 1;
  const dragonfruitColliderBoost = level === 5 ? 1.04 : 1;
  const partOptions = {
    ...suikaPhysics,
    render: { visible: false }
  };
  return spriteParts.map((part) =>
    Bodies.circle(
      x + part.x * radius * spreadScale * levelTighten * dragonfruitColliderBoost,
      y + part.y * radius * spreadScale * levelTighten * dragonfruitColliderBoost,
      Math.max(3, part.r * radius * 2 * radiusScale * levelTighten * dragonfruitColliderBoost),
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
  Body.setVelocity(created, { x: vx * 0.16, y: vy * 0.2 - 0.45 });

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
  highestLevelReached = Math.max(highestLevelReached, flowerChain.length - 1);
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

function debugTriggerWin() {
  lost = false;
  gameOverCard.hidden = true;
  fullBloom();
}

function debugTriggerLose() {
  won = false;
  winCard.hidden = true;
  showGameOver();
}

function restartGame() {
  won = false;
  lost = false;
  canDrop = true;
  highestLevelReached = 0;
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
  syncRadiiToStageWidth();
  addWalls();
  currentLevel = pickNextLevel();
  nextLevel = pickNextLevel();
  updateNextPreview();
  lastFrame = performance.now();
  physicsAccumulator = 0;
  loop(lastFrame);
}

function resizeCanvas() {
  width = Math.max(300, Math.floor(stageWrap.clientWidth));
  height = Math.max(320, Math.floor(stageWrap.clientHeight));
  const maxDpr = width <= 430 ? 1.5 : 2;
  dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cursorX = clamp(cursorX, 20, width - 20);
  if (!engine || !engine.world.bodies.some((body) => body.flower)) syncRadiiToStageWidth();
  addWalls();
}

function loop(now) {
  const delta = Math.min(now - lastFrame, 100);
  lastFrame = now;
  physicsAccumulator += delta;
  let steps = 0;
  while (physicsAccumulator >= FIXED_TIMESTEP && steps < MAX_PHYSICS_STEPS) {
    Engine.update(engine, FIXED_TIMESTEP);
    checkGameOver(FIXED_TIMESTEP);
    physicsAccumulator -= FIXED_TIMESTEP;
    steps += 1;
  }
  draw();
  raf = requestAnimationFrame(loop);
}

function checkGameOver(delta) {
  if (won || lost) return;
  const flowers = engine.world.bodies;
  const now = performance.now();
  const dangerY = RAIL_BOTTOM - 24;
  let crowded = false;
  for (const body of flowers) {
    if (!body.flower) continue;
    if (body.position.y - flowerChain[body.flower.level].radius < dangerY && now - body.flower.bornAt > 1500) {
      crowded = true;
      break;
    }
  }
  gameOverTimer = crowded ? gameOverTimer + delta : 0;
  if (gameOverTimer > 1200) {
    showGameOver();
    gameOverTimer = 0;
  }
}

function draw() {
  drawBackground();
  drawDropper();

  for (const bucket of flowerRenderBuckets) bucket.length = 0;
  for (const body of engine.world.bodies) {
    if (!body.flower) continue;
    flowerRenderBuckets[body.flower.level].push(body);
  }
  for (const bucket of flowerRenderBuckets) {
    for (const body of bucket) drawFlowerBody(body);
  }
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
  const heldRadius = canDrop ? radius : 26;
  const heldData = canDrop ? flowerChain[level] : null;
  const targetOpenAmount = canDrop ? 0.04 : 1;
  clawOpenAmount += (targetOpenAmount - clawOpenAmount) * 0.28;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.translate(x, RAIL_BOTTOM - 1);
  ctx.shadowColor = "rgba(55, 45, 40, 0.14)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  drawCloudCarrier(heldRadius, heldData, clawOpenAmount);
  ctx.shadowColor = "transparent";
  ctx.restore();
}

function drawFlowerBody(body) {
  const level = body.flower.level;
  const data = flowerChain[level];
  const visualLift = level === 5 ? Math.max(2, data.radius * 0.04) : 0;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  drawPlush(0, -visualLift, data.radius, data);
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
  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, -radius, -radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

function drawCloudCarrier(heldRadius, data, openAmount) {
  ctx.save();
  const scale = Math.min(1, 102 / (heldRadius + 38));
  ctx.scale(scale, scale);
  const peachLift = data?.name === "Peach" ? 12 : 0;
  const dropY = heldRadius + 10 - peachLift;
  const mastTop = -48;
  const hubY = -9;
  const clawLength = 34;
  const armSpread = 9 + openAmount * 24;
  const armDrop = 12 + openAmount * 10;
  const pivotY = hubY + 10;

  ctx.strokeStyle = "rgba(168, 178, 191, 0.95)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, mastTop);
  ctx.lineTo(0, hubY - 12);
  ctx.stroke();

  const housingGrad = ctx.createLinearGradient(0, hubY - 18, 0, hubY + 10);
  housingGrad.addColorStop(0, "#f7faff");
  housingGrad.addColorStop(0.52, "#c7d0db");
  housingGrad.addColorStop(1, "#8f9baa");
  ctx.fillStyle = housingGrad;
  ctx.strokeStyle = "rgba(82, 94, 110, 0.7)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-20, hubY - 18, 40, 26, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
  ctx.beginPath();
  ctx.roundRect(-16, hubY - 14, 32, 5, 4);
  ctx.fill();

  ctx.strokeStyle = "rgba(121, 132, 147, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-11, hubY - 2);
  ctx.lineTo(11, hubY - 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(88, 101, 118, 0.85)";
  ctx.beginPath();
  ctx.roundRect(-9, pivotY - 6, 18, 7, 3);
  ctx.fill();

  const drawClawArm = (side) => {
    const pivotX = side * 7;
    const tipX = side * armSpread;
    const tipY = pivotY + armDrop;
    const clawTipX = tipX + side * (2 + openAmount * 6);
    const clawTipY = tipY + clawLength * (0.32 + openAmount * 0.08);
    ctx.strokeStyle = "rgba(104, 116, 132, 0.95)";
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(clawTipX, clawTipY);
    ctx.stroke();

    ctx.strokeStyle = "rgba(232, 238, 246, 0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pivotX + side * 0.6, pivotY + 0.5);
    ctx.lineTo(tipX + side * 0.5, tipY + 0.5);
    ctx.stroke();
  };
  drawClawArm(-1);
  drawClawArm(1);

  if (data) {
    drawPlush(0, dropY, heldRadius, data);
  }
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
let musicEnabled = true;
const musicTrack = new Audio(new URL("../assets/audio/suika_ost.mp3", import.meta.url));
const dropSfxTrack = new Audio(new URL("../assets/audio/drop.wav", import.meta.url));
const mergeSfxTrack = new Audio(new URL("../assets/audio/remove.wav", import.meta.url));
musicTrack.loop = true;
musicTrack.preload = "auto";
musicTrack.volume = 0.5;
dropSfxTrack.preload = "auto";
mergeSfxTrack.preload = "auto";
dropSfxTrack.volume = 0.45;
mergeSfxTrack.volume = 0.52;
musicButton.textContent = "Music On";

function unlockAudioOnFirstInteraction() {
  startAudio();
  if (musicEnabled) startMusic();
}

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

function playSfx(track, volumeMultiplier = 1) {
  const instance = track.cloneNode();
  instance.currentTime = 0;
  instance.volume = Math.max(0, Math.min(1, track.volume * volumeMultiplier));
  const attempt = instance.play();
  if (attempt?.catch) attempt.catch(() => {});
}

function playDropSound() {
  playSfx(dropSfxTrack);
}

function playMergeSound(level) {
  playSfx(mergeSfxTrack, 1 + Math.min(level * 0.02, 0.12));
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
if (isDev) {
  debugWinButton.addEventListener("click", debugTriggerWin);
  debugLoseButton.addEventListener("click", debugTriggerLose);
}
continueButton.addEventListener("click", continueAfterWin);
winRestartButton.addEventListener("click", restartGame);
gameOverRestartButton.addEventListener("click", restartGame);
window.addEventListener("resize", resizeCanvas);
window.addEventListener("click", unlockAudioOnFirstInteraction, { once: true });

async function init() {
  await preloadSpriteImages();
  syncRadiiToStageWidth();
  createEngine();
  currentLevel = pickNextLevel();
  nextLevel = pickNextLevel();
  resizeCanvas();
  updateNextPreview();
  loop(performance.now());
}

init();
