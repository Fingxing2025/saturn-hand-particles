import './style.css'
import { HandTracker, type GestureState } from './handTracking.ts'
import { SaturnScene } from './saturnScene.ts'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root element')
}

const demoPagePath = `${import.meta.env.BASE_URL}demo.html`

app.innerHTML = `
  <div class="experience-shell">
    <canvas class="experience-canvas" aria-hidden="true"></canvas>

    <div class="ambient ambient-left"></div>
    <div class="ambient ambient-right"></div>

    <header class="hud-card hud-header">
      <div>
        <p class="eyebrow">Gesture Orbit</p>
        <h1>土星粒子场</h1>
      </div>
      <div class="header-actions">
        <a class="ghost-link" href="${demoPagePath}">观察页面</a>
        <button id="fullscreenButton" class="fullscreen-button" type="button">进入全屏</button>
      </div>
    </header>

    <section class="hud-card hud-panel">
      <div class="metric-grid">
        <article>
          <span class="metric-label">手掌张合</span>
          <strong id="opennessValue">0%</strong>
        </article>
        <article>
          <span class="metric-label">混沌强度</span>
          <strong id="chaosValue">0%</strong>
        </article>
      </div>
      <p id="trackingStatus" class="status-line">请求摄像头权限中</p>
    </section>

    <section class="hud-card hud-footer">
      <div>
        <p class="hint-title">交互方式</p>
        <p class="hint-text">手掌持续张开会让土星放大、增亮并逐步失稳；某一刻快速张开手掌会触发整体爆炸。按住鼠标拖拽可旋转土星，滚轮可缩放视角。</p>
      </div>

      <div class="camera-chip">
        <div class="camera-header">
          <span class="camera-indicator"></span>
          <span>Live camera</span>
        </div>
        <video id="cameraFeed" autoplay muted playsinline></video>
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
const video = getElement<HTMLVideoElement>('#cameraFeed')
const fullscreenButton = getElement<HTMLButtonElement>('#fullscreenButton')
const opennessValue = getElement<HTMLElement>('#opennessValue')
const chaosValue = getElement<HTMLElement>('#chaosValue')
const trackingStatus = getElement<HTMLElement>('#trackingStatus')

const saturnScene = new SaturnScene(canvas)
let snapStatusUntil = 0

function renderGestureState(state: GestureState) {
  if (state.snapDetected) {
    snapStatusUntil = performance.now() + 1400
  }

  const openness = Math.round(state.openness * 100)
  const chaos = Math.round(Math.max(0, (state.openness - 0.74) / 0.26) * 100)

  opennessValue.textContent = `${openness}%`
  chaosValue.textContent = `${Math.min(100, chaos)}%`
  saturnScene.setGestureState(state)

  if (snapStatusUntil > performance.now()) {
    trackingStatus.textContent = '检测到手掌瞬时张开，模型正从中心爆开并向外飞散'
    return
  }

  if (!state.handDetected) {
    trackingStatus.textContent = '未检测到手掌，场景保持呼吸态'
    return
  }

  if (state.openness > 0.82) {
    trackingStatus.textContent = '轨道进入混沌临界，粒子开始爆散'
    return
  }

  if (state.openness > 0.45) {
    trackingStatus.textContent = '手势已锁定，土星正在扩张增亮'
    return
  }

  trackingStatus.textContent = '手势已锁定，轨道保持稳定收束'
}

const handTracker = new HandTracker({
  video,
  onStatusChange: (status) => {
    trackingStatus.textContent = status
  },
  onUpdate: renderGestureState,
})

void handTracker.start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '摄像头初始化失败'
  trackingStatus.textContent = message
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
  handTracker.destroy()
  saturnScene.destroy()
})
