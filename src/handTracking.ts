import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const MEDIAPIPE_WASM_PATH = `${import.meta.env.BASE_URL}mediapipe`
const HAND_LANDMARKER_MODEL_PATH = `${import.meta.env.BASE_URL}hand_landmarker.task`

export interface GestureState {
  openness: number
  confidence: number
  handDetected: boolean
  snapDetected: boolean
}

interface HandTrackerOptions {
  video: HTMLVideoElement
  onUpdate: (state: GestureState) => void
  onStatusChange?: (status: string) => void
}

interface Landmark {
  x: number
  y: number
  z: number
}

export class HandTracker {
  private readonly video: HTMLVideoElement
  private readonly onUpdate: (state: GestureState) => void
  private readonly onStatusChange?: (status: string) => void
  private handLandmarker: HandLandmarker | null = null
  private stream: MediaStream | null = null
  private animationFrameId = 0
  private destroyed = false
  private lastVideoTime = -1
  private smoothedOpenness = 0
  private previousOpenness = 0
  private lastDetectionTimestamp = 0
  private suddenOpenPrimedAt = -1
  private suddenOpenLowestOpenness = 1
  private suddenOpenCooldownUntil = 0

  constructor(options: HandTrackerOptions) {
    this.video = options.video
    this.onUpdate = options.onUpdate
    this.onStatusChange = options.onStatusChange
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头访问')
    }

    this.onStatusChange?.('正在连接前置摄像头')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
    } catch (error: unknown) {
      throw new Error(describeCameraAccessError(error))
    }

    this.video.srcObject = this.stream

    try {
      await this.video.play()
    } catch {
      this.stopStream()
      throw new Error('摄像头已连接，但视频流启动失败，请刷新页面后重试')
    }

    this.onStatusChange?.('正在加载手势模型')
    try {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH)
      this.handLandmarker = await createHandLandmarker(vision)
    } catch {
      this.stopStream()
      throw new Error('手势模型加载失败，请检查网络连接后重试')
    }

    this.onStatusChange?.('挥动手掌开始驱动土星')
    this.loop()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.animationFrameId)
    this.handLandmarker?.close()
    this.stopStream()
  }

  private stopStream() {
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop()
    }

    this.stream = null
  }

  private loop = () => {
    if (this.destroyed) {
      return
    }

    if (!this.handLandmarker || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.animationFrameId = requestAnimationFrame(this.loop)
      return
    }

    if (this.video.currentTime === this.lastVideoTime) {
      this.animationFrameId = requestAnimationFrame(this.loop)
      return
    }

    this.lastVideoTime = this.video.currentTime
    const now = performance.now()
    const results = this.handLandmarker.detectForVideo(this.video, now)
    const landmarks = results.landmarks[0] as Landmark[] | undefined

    if (!landmarks) {
      this.resetBurstTracking()
      this.smoothedOpenness = lerp(this.smoothedOpenness, 0, 0.18)
      this.onUpdate({
        openness: this.smoothedOpenness,
        confidence: 0,
        handDetected: false,
        snapDetected: false,
      })
      this.animationFrameId = requestAnimationFrame(this.loop)
      return
    }

    const openness = measureHandOpenness(landmarks)
    const snapDetected = this.detectSuddenOpenGesture(openness, now)
    this.smoothedOpenness = lerp(this.smoothedOpenness, openness, 0.32)

    this.onUpdate({
      openness: this.smoothedOpenness,
      confidence: results.handednesses[0]?.[0]?.score ?? 0.9,
      handDetected: true,
      snapDetected,
    })

    this.animationFrameId = requestAnimationFrame(this.loop)
  }

  private detectSuddenOpenGesture(openness: number, timestamp: number) {
    const deltaSeconds = Math.max((timestamp - this.lastDetectionTimestamp) / 1000, 1 / 240)
    const opennessVelocity = (openness - this.previousOpenness) / deltaSeconds

    if (openness < 0.58) {
      if (this.suddenOpenPrimedAt < 0) {
        this.suddenOpenPrimedAt = timestamp
        this.suddenOpenLowestOpenness = openness
      } else {
        this.suddenOpenLowestOpenness = Math.min(this.suddenOpenLowestOpenness, openness)
      }
    }

    const recentlyPrimed = this.suddenOpenPrimedAt > 0 && timestamp - this.suddenOpenPrimedAt < 280
    const opennessRise = openness - this.suddenOpenLowestOpenness
    const snapDetected =
      timestamp > this.suddenOpenCooldownUntil &&
      recentlyPrimed &&
      this.suddenOpenLowestOpenness < 0.58 &&
      openness > 0.84 &&
      opennessRise > 0.26 &&
      opennessVelocity > 2.2

    if (snapDetected) {
      this.clearBurstPriming()
      this.suddenOpenCooldownUntil = timestamp + 850
    } else if (this.suddenOpenPrimedAt > 0 && timestamp - this.suddenOpenPrimedAt >= 320) {
      this.clearBurstPriming()
    }

    this.previousOpenness = openness
    this.lastDetectionTimestamp = timestamp

    return snapDetected
  }

  private clearBurstPriming() {
    this.suddenOpenPrimedAt = -1
    this.suddenOpenLowestOpenness = 1
  }

  private resetBurstTracking() {
    this.previousOpenness = 0
    this.lastDetectionTimestamp = 0
    this.clearBurstPriming()
    this.suddenOpenCooldownUntil = 0
  }
}

function measureHandOpenness(landmarks: Landmark[]) {
  const palmCenter = averagePoint([
    landmarks[0],
    landmarks[5],
    landmarks[9],
    landmarks[13],
    landmarks[17],
  ])

  const palmSpan = Math.max(distance(landmarks[5], landmarks[17]), 0.001)
  const fingerTips = [4, 8, 12, 16, 20]
  const averageReach =
    fingerTips.reduce((sum, index) => sum + distance(landmarks[index], palmCenter), 0) /
    fingerTips.length
  const fanOut = distance(landmarks[8], landmarks[20]) / palmSpan
  const curlSuppression = distance(landmarks[8], landmarks[5]) / palmSpan

  const rawOpenness =
    ((averageReach / palmSpan - 0.65) / 0.85) * 0.82 +
    ((fanOut - 0.7) / 1.2) * 0.12 +
    ((curlSuppression - 0.8) / 1.1) * 0.06

  return clamp(rawOpenness, 0, 1)
}

function averagePoint(points: Landmark[]): Landmark {
  const total = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
      z: sum.z + point.z,
    }),
    { x: 0, y: 0, z: 0 },
  )

  return {
    x: total.x / points.length,
    y: total.y / points.length,
    z: total.z / points.length,
  }
}

function distance(first: Landmark, second: Landmark) {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function lerp(start: number, end: number, alpha: number) {
  return start + (end - start) * alpha
}

function describeCameraAccessError(error: unknown) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return '摄像头权限被拒绝，请在浏览器地址栏允许摄像头访问'
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return '未检测到可用摄像头设备'
      case 'NotReadableError':
      case 'TrackStartError':
        return '摄像头被其他应用占用，请关闭微信、QQ、会议软件后重试'
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return '当前摄像头不支持请求的视频分辨率'
      case 'SecurityError':
        return '当前页面环境禁止访问摄像头，请使用 localhost 或 https'
      default:
        return error.message || '摄像头初始化失败'
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return '摄像头初始化失败'
}

async function createHandLandmarker(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
  const sharedOptions = {
    baseOptions: {
      modelAssetPath: HAND_LANDMARKER_MODEL_PATH,
    },
    numHands: 1,
    runningMode: 'VIDEO' as const,
  }

  try {
    return await HandLandmarker.createFromOptions(vision, {
      ...sharedOptions,
      baseOptions: {
        ...sharedOptions.baseOptions,
        delegate: 'GPU',
      },
    })
  } catch {
    return HandLandmarker.createFromOptions(vision, {
      ...sharedOptions,
      baseOptions: {
        ...sharedOptions.baseOptions,
        delegate: 'CPU',
      },
    })
  }
}