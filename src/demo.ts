import './style.css'
import type { GestureState } from './handTracking.ts'
import { SaturnScene } from './saturnScene.ts'

interface DemoStage {
  name: string
  description: string
  openness: number
  hold: number
}

const demoStages: DemoStage[] = [
  {
    name: '收束静息',
    description: '土星保持低亮度和紧致轨道，适合展示小暗的物理状态。',
    openness: 0.12,
    hold: 2.2,
  },
  {
    name: '稳定扩张',
    description: '模拟手掌张开到中段，核心增亮，环带半径开始拉伸。',
    openness: 0.48,
    hold: 2.6,
  },
  {
    name: '高亮巡航',
    description: '进入明亮大态，粒子仍保持开普勒轨道，具有明显层次感。',
    openness: 0.72,
    hold: 2.4,
  },
  {
    name: '临界混沌',
    description: '接近屏幕极限，叠加高频扰动，轨道出现无规则漂移。',
    openness: 0.88,
    hold: 2.1,
  },
  {
    name: '爆散峰值',
    description: '粒子向外炸开，打破原始轨道，形成强临场混沌。',
    openness: 1,
    hold: 1.8,
  },
  {
    name: '回落重聚',
    description: '模拟手掌重新合拢，土星亮度回落并重新收束到环带。',
    openness: 0.26,
    hold: 2.3,
  },
]

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root element')
}

app.innerHTML = `
  <div class="experience-shell demo-shell">
    <canvas class="experience-canvas" aria-hidden="true"></canvas>

    <div class="ambient ambient-left"></div>
    <div class="ambient ambient-right"></div>

    <header class="hud-card hud-header">
      <div>
        <p class="eyebrow">Showcase Mode</p>
        <h1>土星粒子场 Demo</h1>
      </div>

      <div class="header-actions">
        <a class="ghost-link" href="/">摄像头实机页</a>
        <button id="fullscreenButton" class="fullscreen-button" type="button">进入全屏</button>
      </div>
    </header>

    <section class="hud-card hud-panel demo-panel">
      <div class="metric-grid">
        <article>
          <span class="metric-label">模拟张合</span>
          <strong id="opennessValue">0%</strong>
        </article>
        <article>
          <span class="metric-label">混沌强度</span>
          <strong id="chaosValue">0%</strong>
        </article>
      </div>

      <div class="demo-controls">
        <label class="slider-block" for="opennessSlider">
          <span class="metric-label">手势滑杆</span>
          <input id="opennessSlider" type="range" min="0" max="100" value="12" />
        </label>

        <div class="button-row">
          <button id="toggleAutoplay" class="pill-button" type="button">暂停自动巡演</button>
          <button id="replayButton" class="pill-button pill-button-secondary" type="button">重新播放</button>
          <button id="triggerExplosionButton" class="pill-button pill-button-secondary" type="button">触发爆炸</button>
        </div>
      </div>

      <p id="trackingStatus" class="status-line">自动巡演已启动，正在模拟完整手势轨迹</p>
    </section>

    <section class="hud-card hud-footer demo-footer">
      <div>
        <p class="hint-title">演示章节</p>
        <div id="stageList" class="stage-list"></div>
      </div>

      <div class="demo-side-panel">
        <div class="camera-chip palm-chip">
          <div class="camera-header">
            <span class="camera-indicator"></span>
            <span>Simulated palm aperture</span>
          </div>
          <div class="palm-visual">
            <div id="palmAura" class="palm-aura"></div>
            <div id="palmCore" class="palm-core"></div>
          </div>
        </div>

        <article class="stage-card">
          <p class="metric-label">当前阶段</p>
          <h2 id="stageName">收束静息</h2>
          <p id="stageDescription" class="hint-text">土星保持低亮度和紧致轨道，适合展示小暗的物理状态。</p>
          <div class="progress-track">
            <span id="progressFill" class="progress-fill"></span>
          </div>
        </article>
      </div>
    </section>
  </div>
`

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`)
  }

  return element
}

const canvas = getElement<HTMLCanvasElement>('.experience-canvas')
const fullscreenButton = getElement<HTMLButtonElement>('#fullscreenButton')
const opennessValue = getElement<HTMLElement>('#opennessValue')
const chaosValue = getElement<HTMLElement>('#chaosValue')
const trackingStatus = getElement<HTMLElement>('#trackingStatus')
const opennessSlider = getElement<HTMLInputElement>('#opennessSlider')
const toggleAutoplay = getElement<HTMLButtonElement>('#toggleAutoplay')
const replayButton = getElement<HTMLButtonElement>('#replayButton')
const triggerExplosionButton = getElement<HTMLButtonElement>('#triggerExplosionButton')
const stageName = getElement<HTMLElement>('#stageName')
const stageDescription = getElement<HTMLElement>('#stageDescription')
const stageList = getElement<HTMLElement>('#stageList')
const progressFill = getElement<HTMLElement>('#progressFill')
const palmAura = getElement<HTMLElement>('#palmAura')
const palmCore = getElement<HTMLElement>('#palmCore')

const saturnScene = new SaturnScene(canvas)

let autoplay = true
let currentOpenness = demoStages[0].openness
let currentStageIndex = 0
let currentStageElapsed = 0
let lastTimestamp = performance.now()
let explosionStatusUntil = 0

stageList.innerHTML = demoStages
  .map(
    (stage, index) => `
      <button class="stage-pill${index === 0 ? ' is-active' : ''}" data-stage-index="${index}" type="button">
        <span>${stage.name}</span>
      </button>
    `,
  )
  .join('')

function makeGestureState(openness: number): GestureState {
  return {
    openness,
    confidence: 1,
    handDetected: true,
    snapDetected: false,
  }
}

function updateStageUI(openness: number, stageIndex: number, stageProgress: number) {
  const safeOpenness = Math.min(1, Math.max(0, openness))
  const chaos = Math.min(1, Math.max(0, (safeOpenness - 0.74) / 0.26))
  const activeStage = demoStages[stageIndex]

  opennessValue.textContent = `${Math.round(safeOpenness * 100)}%`
  chaosValue.textContent = `${Math.round(chaos * 100)}%`
  stageName.textContent = activeStage.name
  stageDescription.textContent = activeStage.description
  progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0.02, stageProgress))})`
  opennessSlider.value = String(Math.round(safeOpenness * 100))

  palmAura.style.setProperty('--demo-openness', safeOpenness.toFixed(3))
  palmCore.style.setProperty('--demo-openness', safeOpenness.toFixed(3))

  for (const item of stageList.querySelectorAll<HTMLButtonElement>('.stage-pill')) {
    item.classList.toggle('is-active', Number(item.dataset.stageIndex) === stageIndex)
  }

  if (explosionStatusUntil > performance.now()) {
    trackingStatus.textContent = '已手动触发爆炸，粒子正从中心高速外飞并逐步回收'
    return
  }

  if (!autoplay) {
    trackingStatus.textContent = '手动预览中，你可以拖动滑杆查看任意阶段'
    return
  }

  if (safeOpenness >= 0.88) {
    trackingStatus.textContent = '自动巡演进入爆散段，混沌噪点和轨道破裂同时抬升'
    return
  }

  if (safeOpenness >= 0.55) {
    trackingStatus.textContent = '自动巡演处于扩张高亮段，环带保持开普勒有序流动'
    return
  }

  trackingStatus.textContent = '自动巡演处于收束段，亮度压低以强调小态物理感'
}

function renderState(openness: number, stageIndex: number, stageProgress: number) {
  const safeOpenness = Math.min(1, Math.max(0, openness))
  currentOpenness = safeOpenness
  saturnScene.setGestureState(makeGestureState(safeOpenness))
  updateStageUI(safeOpenness, stageIndex, stageProgress)
}

function restartAutoplay(startIndex = 0) {
  autoplay = true
  toggleAutoplay.textContent = '暂停自动巡演'
  currentStageIndex = startIndex
  currentStageElapsed = 0
  renderState(demoStages[startIndex].openness, startIndex, 0.02)
}

function animate(now: number) {
  const delta = Math.min(0.05, (now - lastTimestamp) / 1000)
  lastTimestamp = now

  if (autoplay) {
    const stage = demoStages[currentStageIndex]
    const nextStage = demoStages[(currentStageIndex + 1) % demoStages.length]

    currentStageElapsed += delta
    const progress = Math.min(1, currentStageElapsed / stage.hold)
    const eased = easeInOutCubic(progress)
    const openness = lerp(stage.openness, nextStage.openness, eased)

    renderState(openness, currentStageIndex, progress)

    if (progress >= 1) {
      currentStageIndex = (currentStageIndex + 1) % demoStages.length
      currentStageElapsed = 0
    }
  }

  requestAnimationFrame(animate)
}

opennessSlider.addEventListener('input', () => {
  autoplay = false
  toggleAutoplay.textContent = '恢复自动巡演'

  const openness = Number(opennessSlider.value) / 100
  const nearestStageIndex = findNearestStageIndex(openness)
  renderState(openness, nearestStageIndex, openness)
})

toggleAutoplay.addEventListener('click', () => {
  autoplay = !autoplay
  toggleAutoplay.textContent = autoplay ? '暂停自动巡演' : '恢复自动巡演'

  if (autoplay) {
    currentStageIndex = findNearestStageIndex(currentOpenness)
    currentStageElapsed = 0
  } else {
    trackingStatus.textContent = '自动巡演已暂停，你可以拖动滑杆观察每个态的细节'
  }
})

replayButton.addEventListener('click', () => {
  restartAutoplay(0)
  trackingStatus.textContent = '已从收束段重新开始整段演示'
})

triggerExplosionButton.addEventListener('click', () => {
  saturnScene.triggerSnapExplosion()
  explosionStatusUntil = performance.now() + 1500
  trackingStatus.textContent = '已手动触发爆炸，粒子正从中心高速外飞并逐步回收'
})

stageList.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null
  const button = target?.closest<HTMLButtonElement>('.stage-pill')

  if (!button) {
    return
  }

  const index = Number(button.dataset.stageIndex)
  autoplay = false
  toggleAutoplay.textContent = '恢复自动巡演'
  renderState(demoStages[index].openness, index, 1)
})

function updateFullscreenButton() {
  fullscreenButton.textContent = document.fullscreenElement ? '退出全屏' : '进入全屏'
}

fullscreenButton.addEventListener('click', async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await document.documentElement.requestFullscreen()
  }

  updateFullscreenButton()
})

document.addEventListener('fullscreenchange', updateFullscreenButton)
window.addEventListener('beforeunload', () => {
  saturnScene.destroy()
})

renderState(demoStages[0].openness, 0, 0.02)
requestAnimationFrame(animate)

function findNearestStageIndex(openness: number) {
  let bestIndex = 0
  let smallestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < demoStages.length; index += 1) {
    const distance = Math.abs(demoStages[index].openness - openness)

    if (distance < smallestDistance) {
      smallestDistance = distance
      bestIndex = index
    }
  }

  return bestIndex
}

function lerp(start: number, end: number, alpha: number) {
  return start + (end - start) * alpha
}

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2
}