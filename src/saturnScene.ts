import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js'
import type { GestureState } from './handTracking.ts'

const SUN_DIRECTION = new THREE.Vector3(-0.65, 0.35, 0.68).normalize()
const SUN_COLOR = new THREE.Color(0xffd27a)
const SNAP_EXPLOSION_RAMP = 1.12
const SNAP_EXPLOSION_HOLD = 0.42
const SNAP_EXPLOSION_RECOVERY = 4.6
const SNAP_ANTICIPATION_DURATION = 0.16
const SNAP_IMPACT_FADE = 0.74
const SNAP_AFTERSHOCK_FADE = 2.6
const SNAP_TOTAL_DURATION = SNAP_EXPLOSION_RAMP + SNAP_EXPLOSION_HOLD + SNAP_EXPLOSION_RECOVERY

interface ParticleMaterialOptions {
  opacity?: number
  sizeFactor?: number
  blending?: THREE.Blending
  fieldWeight?: number
}

interface ExplosionUniformState {
  explosionProgress: number
  explosionForce: number
  explosionElapsed: number
  implosionProgress: number
  shockwaveProgress: number
  driftProgress: number
  returnProgress: number
  flashProgress: number
}

interface CoreField {
  geometry: THREE.BufferGeometry
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  glow: Float32Array
  pulse: Float32Array
  radius: Float32Array
  theta: Float32Array
  phi: Float32Array
  spin: Float32Array
  phase: Float32Array
  seed: Float32Array
  tint: Float32Array
}

interface RingField {
  geometry: THREE.BufferGeometry
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  glow: Float32Array
  pulse: Float32Array
  semiMajor: Float32Array
  eccentricity: Float32Array
  inclination: Float32Array
  node: Float32Array
  phase: Float32Array
  verticalAmplitude: Float32Array
  layerPhase: Float32Array
  bandMix: Float32Array
  layerMix: Float32Array
  brightnessBias: Float32Array
  seed: Float32Array
  tint: Float32Array
}

interface RingLayerDefinition {
  weight: number
  radiusMin: number
  radiusMax: number
  eccentricityMin: number
  eccentricityMax: number
  inclination: number
  verticalMin: number
  verticalMax: number
  bandMin: number
  bandMax: number
  brightness: number
  sizeMin: number
  sizeMax: number
  glowMin: number
  glowMax: number
  tintLow: [number, number, number]
  tintHigh: [number, number, number]
}

interface DustField {
  geometry: THREE.BufferGeometry
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  positions: Float32Array
  colors: Float32Array
  radius: Float32Array
  angle: Float32Array
  elevation: Float32Array
  speed: Float32Array
  phase: Float32Array
  seed: Float32Array
  tint: Float32Array
}

export class SaturnScene {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200)
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly composer: EffectComposer
  private readonly bloomPass: UnrealBloomPass
  private readonly rgbShiftPass: ShaderPass
  private readonly root = new THREE.Group()
  private readonly sunRig = new THREE.Group()
  private readonly sunCore: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly sunGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly sunStreak: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly planetOccluder: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private readonly planetBody: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private readonly atmosphereShell: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private readonly nebulaField: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly starField: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly coreField: CoreField
  private readonly ringField: RingField
  private readonly outerRingField: RingField
  private readonly dustField: DustField
  private animationFrameId = 0
  private currentOpenness = 0
  private targetOpenness = 0
  private lastTimestamp = performance.now()
  private rootSpin = 0
  private dragPointerId: number | null = null
  private dragStartX = 0
  private dragStartY = 0
  private dragStartYaw = 0
  private dragStartTilt = 0
  private rotationYaw = 0
  private targetRotationYaw = 0
  private rotationTilt = 0
  private targetRotationTilt = 0
  private zoomOffset = 0
  private targetZoomOffset = 0
  private snapExplosionElapsed = Number.POSITIVE_INFINITY

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: true,
      canvas,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x010102, 1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.84
    this.scene.background = new THREE.Color(0x010102)

    this.camera.position.set(0, 0.18, 14.4)
    this.root.rotation.z = 0.09
    this.root.rotation.x = -0.48
    this.scene.add(this.root)

    this.sunCore = this.createSunBillboard(6.1, 6.1, new THREE.Color(0xfff5d2), 0.98)
    this.sunGlow = this.createSunBillboard(12.8, 12.8, new THREE.Color(0x74e8ff), 0.58)
    this.sunStreak = this.createSunBillboard(25.5, 4.8, new THREE.Color(0xffcc74), 0.42)
    this.sunCore.renderOrder = -2
    this.sunGlow.renderOrder = -3
    this.sunStreak.renderOrder = -4
    this.sunRig.add(this.sunGlow)
    this.sunRig.add(this.sunStreak)
    this.sunRig.add(this.sunCore)
    this.scene.add(this.sunRig)

    this.planetOccluder = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 48, 48),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    )
    this.planetBody = this.createPlanetBody()
    this.planetBody.scale.set(1, 0.9, 1)
    this.planetBody.renderOrder = 0

    this.planetOccluder.scale.set(1, 0.9, 1)
    this.planetOccluder.renderOrder = 0.5
    this.root.add(this.planetOccluder)

    this.atmosphereShell = this.createAtmosphereShell()
    this.atmosphereShell.scale.set(1.04, 0.9, 1.04)
    this.atmosphereShell.renderOrder = 4

    this.nebulaField = this.createNebulaField()
    this.nebulaField.renderOrder = -8
    this.scene.add(this.nebulaField)

    this.starField = this.createStarField()
    this.starField.renderOrder = -7
    this.scene.add(this.starField)

    this.coreField = this.createCoreField(92000)
    this.ringField = this.createRingField(68000)
    this.outerRingField = this.createRingField(10800, 'outer')
    this.dustField = this.createDustField(16000)

    this.outerRingField.points.rotation.x = THREE.MathUtils.degToRad(10)
    this.outerRingField.points.rotation.z = THREE.MathUtils.degToRad(-12)
    this.outerRingField.points.position.y = 0.08
    this.outerRingField.points.position.x = -0.05

    this.root.add(this.outerRingField.points)
    this.root.add(this.ringField.points)
    this.root.add(this.coreField.points)
    this.root.add(this.dustField.points)
    this.outerRingField.points.renderOrder = 0.9
    this.ringField.points.renderOrder = 1
    this.coreField.points.renderOrder = 2
    this.dustField.points.renderOrder = 3

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3,
      0.22,
      0.42,
    )
    this.composer.addPass(this.bloomPass)
    this.rgbShiftPass = new ShaderPass(RGBShiftShader)
    this.rgbShiftPass.uniforms.amount.value = 0
    this.composer.addPass(this.rgbShiftPass)

    this.canvas.addEventListener('pointerdown', this.handlePointerDown)
    this.canvas.addEventListener('pointermove', this.handlePointerMove)
    this.canvas.addEventListener('pointerup', this.handlePointerUp)
    this.canvas.addEventListener('pointercancel', this.handlePointerUp)
    this.canvas.addEventListener('lostpointercapture', this.handlePointerUp)
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false })
    window.addEventListener('resize', this.handleResize)
    this.handleResize()
    this.animate()
  }

  setGestureState(state: GestureState) {
    const confidenceBias = THREE.MathUtils.lerp(0.45, 1, state.confidence)
    const openness = state.handDetected ? state.openness * confidenceBias : 0
    this.targetOpenness = THREE.MathUtils.clamp(openness, 0, 1)

    if (state.snapDetected) {
      this.triggerSnapExplosion()
    }
  }

  triggerSnapExplosion() {
    this.snapExplosionElapsed = 0
  }

  destroy() {
    cancelAnimationFrame(this.animationFrameId)
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    this.canvas.removeEventListener('pointermove', this.handlePointerMove)
    this.canvas.removeEventListener('pointerup', this.handlePointerUp)
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp)
    this.canvas.removeEventListener('lostpointercapture', this.handlePointerUp)
    this.canvas.removeEventListener('wheel', this.handleWheel)
    window.removeEventListener('resize', this.handleResize)
    this.renderer.dispose()
    this.composer.dispose()
    this.sunCore.geometry.dispose()
    this.sunCore.material.dispose()
    this.sunGlow.geometry.dispose()
    this.sunGlow.material.dispose()
    this.sunStreak.geometry.dispose()
    this.sunStreak.material.dispose()
    this.planetOccluder.geometry.dispose()
    this.planetOccluder.material.dispose()
    this.planetBody.geometry.dispose()
    this.planetBody.material.dispose()
    this.atmosphereShell.geometry.dispose()
    this.atmosphereShell.material.dispose()
    this.nebulaField.geometry.dispose()
    this.nebulaField.material.dispose()
    this.coreField.geometry.dispose()
    this.ringField.geometry.dispose()
    this.outerRingField.geometry.dispose()
    this.dustField.geometry.dispose()
    this.starField.geometry.dispose()
    this.starField.material.dispose()
    this.coreField.points.material.dispose()
    this.ringField.points.material.dispose()
    this.outerRingField.points.material.dispose()
    this.dustField.points.material.dispose()
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return
    }

    this.dragPointerId = event.pointerId
    this.dragStartX = event.clientX
    this.dragStartY = event.clientY
    this.dragStartYaw = this.targetRotationYaw
    this.dragStartTilt = this.targetRotationTilt
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.style.cursor = 'grabbing'
    event.preventDefault()
  }

  private handlePointerMove = (event: PointerEvent) => {
    if (this.dragPointerId !== event.pointerId) {
      return
    }

    const deltaX = (event.clientX - this.dragStartX) / Math.max(window.innerWidth, 1)
    const deltaY = (event.clientY - this.dragStartY) / Math.max(window.innerHeight, 1)

    this.targetRotationYaw = this.dragStartYaw + deltaX * Math.PI * 2.2
    this.targetRotationTilt = THREE.MathUtils.clamp(this.dragStartTilt + deltaY * 1.75, -0.78, 0.78)
    event.preventDefault()
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (this.dragPointerId !== null && event.pointerId !== this.dragPointerId) {
      return
    }

    if (this.dragPointerId !== null && this.canvas.hasPointerCapture(this.dragPointerId)) {
      this.canvas.releasePointerCapture(this.dragPointerId)
    }

    this.dragPointerId = null
    this.canvas.style.cursor = 'grab'
  }

  private handleWheel = (event: WheelEvent) => {
    this.targetZoomOffset = THREE.MathUtils.clamp(
      this.targetZoomOffset + event.deltaY * 0.0085,
      -7.2,
      11.2,
    )
    event.preventDefault()
  }

  private animate = () => {
    const now = performance.now()
    const delta = Math.min(0.05, (now - this.lastTimestamp) / 1000)
    const elapsed = now / 1000

    this.lastTimestamp = now
    this.currentOpenness = THREE.MathUtils.damp(
      this.currentOpenness,
      this.targetOpenness,
      3.6,
      delta,
    )

    const openness = this.currentOpenness
    const opennessChaos = smoothstep(0.74, 0.98, openness)
    const opennessExplosion = smoothstep(0.84, 1, openness)
    let snapExplosion = 0
    let snapAnticipation = 0
    let snapImpact = 0
    let snapAftershock = 0
    let snapShockwave = 0
    let snapDrift = 0
    let snapReturn = 0
    let snapFlash = 0
    let snapElapsed = 0

    if (Number.isFinite(this.snapExplosionElapsed)) {
      this.snapExplosionElapsed += delta
      snapElapsed = this.snapExplosionElapsed
      snapAnticipation =
        smoothstep(0, 0.026, snapElapsed) *
        (1 - smoothstep(0.026, SNAP_ANTICIPATION_DURATION, snapElapsed))
      snapImpact =
        smoothstep(SNAP_ANTICIPATION_DURATION * 0.9, SNAP_ANTICIPATION_DURATION + 0.06, snapElapsed) *
        (1 - smoothstep(SNAP_ANTICIPATION_DURATION + 0.06, SNAP_IMPACT_FADE, snapElapsed))
      snapAftershock =
        smoothstep(SNAP_ANTICIPATION_DURATION + 0.08, SNAP_ANTICIPATION_DURATION + 0.34, snapElapsed) *
        (1 - smoothstep(SNAP_ANTICIPATION_DURATION + 0.34, SNAP_AFTERSHOCK_FADE, snapElapsed))
      snapShockwave = smoothstep(SNAP_ANTICIPATION_DURATION * 0.92, SNAP_ANTICIPATION_DURATION + 0.52, snapElapsed)
      snapReturn = smoothstep(SNAP_EXPLOSION_RAMP + SNAP_EXPLOSION_HOLD * 0.55, SNAP_TOTAL_DURATION, snapElapsed)
      snapDrift = smoothstep(SNAP_ANTICIPATION_DURATION + 0.12, SNAP_ANTICIPATION_DURATION + 1.3, snapElapsed) * (1 - snapReturn * 0.48)
      snapFlash = THREE.MathUtils.clamp(snapImpact * 1.15 + snapAnticipation * 0.72, 0, 1)

      if (this.snapExplosionElapsed < SNAP_EXPLOSION_RAMP) {
        const rampProgress = this.snapExplosionElapsed / SNAP_EXPLOSION_RAMP
        snapExplosion = Math.pow(rampProgress, 3)
      } else if (this.snapExplosionElapsed < SNAP_EXPLOSION_RAMP + SNAP_EXPLOSION_HOLD) {
        snapExplosion = 1
      } else if (
        this.snapExplosionElapsed <
        SNAP_EXPLOSION_RAMP + SNAP_EXPLOSION_HOLD + SNAP_EXPLOSION_RECOVERY
      ) {
        const recoveryProgress =
          (this.snapExplosionElapsed - SNAP_EXPLOSION_RAMP - SNAP_EXPLOSION_HOLD) /
          SNAP_EXPLOSION_RECOVERY
        snapExplosion = 1 - smoothstep(0, 1, recoveryProgress)
      } else {
        this.snapExplosionElapsed = Number.POSITIVE_INFINITY
      }
    }

    const chaos = Math.max(opennessChaos, snapExplosion * 0.88)
    const explosion = Math.max(opennessExplosion, snapExplosion * 3.2)
    const brightness = THREE.MathUtils.lerp(0.1, 0.42, Math.pow(openness, 1.2)) + snapExplosion * 0.12
    const scale = THREE.MathUtils.lerp(0.62, 1.08, openness) + snapExplosion * 0.08
    const baseCameraDepth = THREE.MathUtils.lerp(15.1, 11.2, Math.pow(openness, 1.02))
    const impactShake = snapImpact * 0.18 + snapAftershock * 0.05
    const rootShakeX =
      Math.sin(elapsed * 47 + 0.35) * impactShake +
      Math.sin(elapsed * 73 + 1.1) * impactShake * 0.6
    const rootShakeY =
      Math.cos(elapsed * 54 + 0.6) * impactShake * 0.72 +
      Math.sin(elapsed * 81 + 0.2) * impactShake * 0.42
    const rootShakeZ =
      Math.sin(elapsed * 39 + 0.9) * impactShake * 0.44 +
      Math.cos(elapsed * 66 + 1.7) * impactShake * 0.28
    const cameraShakeX = rootShakeX * 0.42
    const cameraShakeY = rootShakeY * 0.36
    const cameraPunch = snapAnticipation * 0.62 - snapImpact * 2.2 - snapAftershock * 0.48
    const scaleXZ = scale * (1 - snapAnticipation * 0.14 + snapImpact * 0.2)
    const scaleY = scale * (1 - snapAnticipation * 0.26 + snapImpact * 0.08)
    const rotationKick = snapImpact * 0.09 + snapAftershock * 0.025

    this.rotationYaw = THREE.MathUtils.damp(this.rotationYaw, this.targetRotationYaw, 8.6, delta)
    this.rotationTilt = THREE.MathUtils.damp(this.rotationTilt, this.targetRotationTilt, 8.2, delta)
    this.zoomOffset = THREE.MathUtils.damp(this.zoomOffset, this.targetZoomOffset, 9.2, delta)
    this.rootSpin += delta * (0.08 + openness * 0.16)
    const cameraDepth = THREE.MathUtils.clamp(
      baseCameraDepth + this.zoomOffset - snapExplosion * 0.7 + cameraPunch,
      5.8,
      26.8,
    )

    this.root.scale.set(scaleXZ, scaleY, scaleXZ)
    this.root.rotation.y = this.rootSpin + this.rotationYaw + rootShakeX * 0.18
    this.root.rotation.x =
      -0.48 +
      Math.sin(elapsed * 0.18) * 0.035 +
      this.rotationTilt +
      rotationKick * Math.sin(elapsed * 32 + 0.4)
    this.root.rotation.z =
      0.09 +
      Math.sin(elapsed * 0.11) * 0.018 +
      rotationKick * Math.cos(elapsed * 28 + 1.2)
    this.root.position.x = -0.18 + Math.sin(elapsed * 0.07) * 0.08 + rootShakeX
    this.root.position.y = Math.sin(elapsed * 0.4) * 0.04 + snapExplosion * 0.06 + rootShakeY
    this.root.position.z = rootShakeZ
    this.outerRingField.points.rotation.x = THREE.MathUtils.degToRad(10) + Math.sin(elapsed * 0.21) * 0.025
    this.outerRingField.points.rotation.y = elapsed * THREE.MathUtils.lerp(0.08, 0.22, openness)
    this.outerRingField.points.rotation.z = THREE.MathUtils.degToRad(-12) + Math.sin(elapsed * 0.16 + 0.8) * 0.035
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, cameraDepth, 4.2, delta)
    this.camera.position.x = 0.74 + Math.sin(elapsed * 0.1) * 0.22 + cameraShakeX
    this.camera.position.y = 0.24 + Math.sin(elapsed * 0.15) * 0.08 + cameraShakeY
    const targetFov = 48 - snapAnticipation * 2.6 + snapImpact * 8.8 + snapAftershock * 1.4
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov
      this.camera.updateProjectionMatrix()
    }
    this.camera.lookAt(-0.16 + rootShakeX * 0.16, 0.03 + rootShakeY * 0.12, 0)

    const sunPulse =
      1 +
      Math.sin(elapsed * 1.4) * 0.05 +
      openness * 0.08 +
      snapExplosion * 0.1 +
      snapImpact * 0.18
    const sunStrength =
      THREE.MathUtils.lerp(0.55, 1.25, openness) +
      chaos * 0.12 +
      snapExplosion * 0.28 +
      snapImpact * 0.72 +
      snapAftershock * 0.18

    this.sunRig.position.copy(SUN_DIRECTION).multiplyScalar(17.5)
    this.sunRig.position.y += 2.6
    this.sunRig.lookAt(this.camera.position)
    this.sunRig.rotateZ(0.36)
    this.sunCore.scale.setScalar(sunPulse)
    this.sunGlow.scale.setScalar(1.18 + openness * 0.22 + snapFlash * 0.1)
    this.sunStreak.scale.set(1.26 + openness * 0.34 + snapFlash * 0.14, 1, 1)
    const sunCoreOpacity = this.sunCore.material.uniforms.uOpacity
    const sunGlowOpacity = this.sunGlow.material.uniforms.uOpacity
    const sunStreakOpacity = this.sunStreak.material.uniforms.uOpacity

    if (sunCoreOpacity) {
      sunCoreOpacity.value = THREE.MathUtils.lerp(0.52, 0.68, openness)
    }

    if (sunGlowOpacity) {
      sunGlowOpacity.value = THREE.MathUtils.lerp(0.16, 0.22, openness) + snapFlash * 0.035
    }

    if (sunStreakOpacity) {
      sunStreakOpacity.value = THREE.MathUtils.lerp(0.1, 0.16, openness) + snapFlash * 0.024
    }

    const nebulaMaterial = this.nebulaField.material
    nebulaMaterial.uniforms.uTime.value = elapsed
    nebulaMaterial.uniforms.uIntensity.value = 0.14 + openness * 0.035 + snapFlash * 0.05
    nebulaMaterial.uniforms.uOpacity.value = 0.032 + openness * 0.012 + snapFlash * 0.01
    nebulaMaterial.uniforms.uFlash.value = snapFlash * 0.28

    this.updateParticleMaterialUniforms(elapsed, sunStrength, {
      explosionProgress: snapExplosion,
      explosionForce: THREE.MathUtils.clamp(snapShockwave * 0.55 + snapImpact * 0.95 + snapExplosion * 0.42, 0, 1.75),
      explosionElapsed: snapElapsed,
      implosionProgress: snapAnticipation,
      shockwaveProgress: snapShockwave,
      driftProgress: snapDrift,
      returnProgress: snapReturn,
      flashProgress: snapFlash,
    })

    this.bloomPass.strength =
      THREE.MathUtils.lerp(0.28, 0.5, brightness + openness * 0.11 + chaos * 0.05 + snapExplosion * 0.22) +
      snapFlash * 0.88 +
      snapAftershock * 0.14
    this.bloomPass.radius =
      THREE.MathUtils.lerp(0.14, 0.28, chaos + openness * 0.06 + snapExplosion * 0.16) +
      snapFlash * 0.18 +
      snapAftershock * 0.05
    this.bloomPass.threshold = THREE.MathUtils.lerp(0.28, 0.08, snapFlash)
    this.renderer.toneMappingExposure =
      THREE.MathUtils.lerp(1.08, 1.22, brightness + openness * 0.08 + snapExplosion * 0.12) +
      snapFlash * 0.24 +
      snapAftershock * 0.03
    this.rgbShiftPass.uniforms.amount.value = snapFlash * 0.0032 + snapAftershock * 0.0008
    this.rgbShiftPass.uniforms.angle.value = elapsed * 0.3 + snapImpact * 1.8

    this.updateCoreField(elapsed, openness, chaos, explosion, brightness)
    this.updateRingField(this.outerRingField, elapsed, openness, chaos, explosion, brightness)
    this.updateRingField(this.ringField, elapsed, openness, chaos, explosion, brightness)
    this.updateDustField(elapsed, openness, chaos, explosion, brightness)

    this.nebulaField.rotation.y = elapsed * 0.005
    this.nebulaField.rotation.x = 0.16 + Math.sin(elapsed * 0.024) * 0.05
    this.nebulaField.rotation.z = Math.sin(elapsed * 0.018) * 0.035
    this.starField.rotation.y += delta * 0.014
    this.starField.rotation.x = Math.sin(elapsed * 0.05) * 0.08
    this.starField.rotation.z = Math.sin(elapsed * 0.028) * 0.03
    this.starField.material.opacity = THREE.MathUtils.lerp(0.82, 0.94, openness * 0.34 + snapFlash * 0.3)

    this.composer.render()
    this.animationFrameId = requestAnimationFrame(this.animate)
  }

  private updateParticleMaterialUniforms(
    elapsed: number,
    sunStrength: number,
    explosionState: ExplosionUniformState,
  ) {
    for (const material of [
      this.coreField.points.material,
      this.outerRingField.points.material,
      this.ringField.points.material,
      this.dustField.points.material,
    ]) {
      const sunStrengthUniform = material.uniforms.uSunStrength
      const sunDirectionUniform = material.uniforms.uSunDirection
      const sunColorUniform = material.uniforms.uSunColor
      const timeUniform = material.uniforms.uTime
      const explosionProgressUniform = material.uniforms.uExplosionProgress
      const explosionForceUniform = material.uniforms.uExplosionForce
      const explosionElapsedUniform = material.uniforms.uExplosionElapsed
      const implosionUniform = material.uniforms.uImplosionProgress
      const shockwaveUniform = material.uniforms.uShockwaveProgress
      const driftUniform = material.uniforms.uDriftProgress
      const returnUniform = material.uniforms.uReturnProgress
      const flashUniform = material.uniforms.uFlashProgress

      if (sunStrengthUniform) {
        sunStrengthUniform.value = sunStrength
      }

      if (timeUniform) {
        timeUniform.value = elapsed
      }

      if (sunDirectionUniform) {
        ;(sunDirectionUniform.value as THREE.Vector3).copy(SUN_DIRECTION)
      }

      if (sunColorUniform) {
        ;(sunColorUniform.value as THREE.Color).copy(SUN_COLOR)
      }

      if (explosionProgressUniform) {
        explosionProgressUniform.value = explosionState.explosionProgress
      }

      if (explosionForceUniform) {
        explosionForceUniform.value = explosionState.explosionForce
      }

      if (explosionElapsedUniform) {
        explosionElapsedUniform.value = explosionState.explosionElapsed
      }

      if (implosionUniform) {
        implosionUniform.value = explosionState.implosionProgress
      }

      if (shockwaveUniform) {
        shockwaveUniform.value = explosionState.shockwaveProgress
      }

      if (driftUniform) {
        driftUniform.value = explosionState.driftProgress
      }

      if (returnUniform) {
        returnUniform.value = explosionState.returnProgress
      }

      if (flashUniform) {
        flashUniform.value = explosionState.flashProgress
      }
    }
  }

  private createCoreField(count: number): CoreField {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const radius = new Float32Array(count)
    const theta = new Float32Array(count)
    const phi = new Float32Array(count)
    const spin = new Float32Array(count)
    const phase = new Float32Array(count)
    const seed = new Float32Array(count)
    const tint = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const glow = new Float32Array(count)
    const pulse = new Float32Array(count)

    for (let index = 0; index < count; index += 1) {
      const stride = index * 3
      const shellChoice = Math.random()
      const radiusSeed = Math.random()
      const inShell = shellChoice > 0.34

      radius[index] = inShell
        ? THREE.MathUtils.lerp(1.02, 1.074, Math.pow(radiusSeed, 4.6))
        : Math.cbrt(radiusSeed)
      theta[index] = Math.random() * Math.PI * 2
      phi[index] = Math.acos(THREE.MathUtils.randFloatSpread(2))
      spin[index] = inShell
        ? THREE.MathUtils.randFloat(0.03, 0.11)
        : THREE.MathUtils.randFloat(0.02, 0.08)
      phase[index] = Math.random() * Math.PI * 2
      seed[index] = Math.random()
      sizes[index] = inShell
        ? THREE.MathUtils.lerp(0.64, 1.16, Math.pow(Math.random(), 0.82))
        : THREE.MathUtils.lerp(0.42, 0.92, Math.pow(Math.random(), 0.74))
      glow[index] = inShell
        ? THREE.MathUtils.lerp(0.34, 0.9, Math.pow(Math.random(), 0.76))
        : THREE.MathUtils.lerp(0.24, 0.68, Math.pow(Math.random(), 0.7))
      pulse[index] = Math.random()
      const cyanBias = Math.pow(Math.random(), inShell ? 1.5 : 0.95)
      const goldRed = THREE.MathUtils.lerp(inShell ? 0.86 : 0.68, inShell ? 1.0 : 0.92, Math.random())
      const goldGreen = THREE.MathUtils.lerp(inShell ? 0.72 : 0.54, inShell ? 0.92 : 0.78, Math.random())
      const goldBlue = THREE.MathUtils.lerp(inShell ? 0.3 : 0.22, inShell ? 0.56 : 0.42, Math.random())
      const cyanRed = THREE.MathUtils.lerp(inShell ? 0.44 : 0.34, inShell ? 0.7 : 0.6, Math.random())
      const cyanGreen = THREE.MathUtils.lerp(inShell ? 0.84 : 0.74, inShell ? 0.98 : 0.92, Math.random())
      const cyanBlue = THREE.MathUtils.lerp(inShell ? 0.92 : 0.88, inShell ? 1.0 : 1.0, Math.random())

      tint[stride] = THREE.MathUtils.lerp(goldRed, cyanRed, cyanBias)
      tint[stride + 1] = THREE.MathUtils.lerp(goldGreen, cyanGreen, cyanBias)
      tint[stride + 2] = THREE.MathUtils.lerp(goldBlue, cyanBlue, cyanBias)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1))
    geometry.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 1))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))

    return {
      geometry,
      points: new THREE.Points(
        geometry,
        createParticleMaterial({
          opacity: 0.66,
          sizeFactor: 80,
          blending: THREE.AdditiveBlending,
          fieldWeight: 1.28,
        }),
      ),
      positions,
      colors,
      sizes,
      glow,
      pulse,
      radius,
      theta,
      phi,
      spin,
      phase,
      seed,
      tint,
    }
  }

  private createRingField(count: number, variant: 'main' | 'outer' = 'main'): RingField {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const semiMajor = new Float32Array(count)
    const eccentricity = new Float32Array(count)
    const inclination = new Float32Array(count)
    const node = new Float32Array(count)
    const phase = new Float32Array(count)
    const verticalAmplitude = new Float32Array(count)
    const layerPhase = new Float32Array(count)
    const bandMix = new Float32Array(count)
    const layerMix = new Float32Array(count)
    const brightnessBias = new Float32Array(count)
    const seed = new Float32Array(count)
    const tint = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const glow = new Float32Array(count)
    const pulse = new Float32Array(count)

    const ringLayers: RingLayerDefinition[] = variant === 'outer'
      ? [
          {
            weight: 1,
            radiusMin: 5.72,
            radiusMax: 7.34,
            eccentricityMin: 0.01,
            eccentricityMax: 0.054,
            inclination: 0.05,
            verticalMin: 0.012,
            verticalMax: 0.038,
            bandMin: 0.82,
            bandMax: 1,
            brightness: 0.82,
            sizeMin: 0.18,
            sizeMax: 0.48,
            glowMin: 0.18,
            glowMax: 0.52,
            tintLow: [0.46, 0.86, 0.95],
            tintHigh: [0.88, 0.99, 1],
          },
        ]
      : [
          {
            weight: 0.34,
            radiusMin: 1.24,
            radiusMax: 2.12,
            eccentricityMin: 0.016,
            eccentricityMax: 0.076,
            inclination: 0.06,
            verticalMin: 0.018,
            verticalMax: 0.052,
            bandMin: 0.16,
            bandMax: 0.38,
            brightness: 0.76,
            sizeMin: 0.22,
            sizeMax: 0.58,
            glowMin: 0.18,
            glowMax: 0.56,
            tintLow: [0.56, 0.42, 0.14],
            tintHigh: [1, 0.82, 0.34],
          },
          {
            weight: 0.66,
            radiusMin: 2.46,
            radiusMax: 4.54,
            eccentricityMin: 0.012,
            eccentricityMax: 0.06,
            inclination: 0.1,
            verticalMin: 0.024,
            verticalMax: 0.094,
            bandMin: 0.46,
            bandMax: 0.94,
            brightness: 1.04,
            sizeMin: 0.34,
            sizeMax: 0.86,
            glowMin: 0.24,
            glowMax: 0.78,
            tintLow: [0.7, 0.62, 0.22],
            tintHigh: [0.84, 0.99, 1],
          },
        ]
    const totalLayerWeight = ringLayers.reduce((sum, layer) => sum + layer.weight, 0)

    for (let index = 0; index < count; index += 1) {
      const stride = index * 3
      let weightSample = Math.random() * totalLayerWeight
      let selectedLayerIndex = ringLayers.length - 1

      for (let layerIndex = 0; layerIndex < ringLayers.length; layerIndex += 1) {
        weightSample -= ringLayers[layerIndex].weight
        if (weightSample <= 0) {
          selectedLayerIndex = layerIndex
          break
        }
      }

      const selectedLayer = ringLayers[selectedLayerIndex]
      const layerDepth = variant === 'outer'
        ? 1
        : selectedLayerIndex / Math.max(1, ringLayers.length - 1)
      const radiusBand = Math.pow(Math.random(), THREE.MathUtils.lerp(0.68, 0.92, layerDepth))
      const tintMix = Math.pow(Math.random(), 0.82)

      semiMajor[index] = THREE.MathUtils.lerp(selectedLayer.radiusMin, selectedLayer.radiusMax, radiusBand)
      eccentricity[index] = THREE.MathUtils.lerp(
        selectedLayer.eccentricityMin,
        selectedLayer.eccentricityMax,
        Math.random(),
      )
      inclination[index] = THREE.MathUtils.randFloatSpread(selectedLayer.inclination)
      node[index] = Math.random() * Math.PI * 2
      phase[index] = Math.random() * Math.PI * 2
      verticalAmplitude[index] = THREE.MathUtils.lerp(
        selectedLayer.verticalMin,
        selectedLayer.verticalMax,
        Math.random(),
      )
      layerPhase[index] = Math.random() * Math.PI * 2
      bandMix[index] = THREE.MathUtils.lerp(selectedLayer.bandMin, selectedLayer.bandMax, Math.random())
      layerMix[index] = layerDepth
      brightnessBias[index] = THREE.MathUtils.lerp(
        selectedLayer.brightness * 0.88,
        selectedLayer.brightness * 1.08,
        Math.random(),
      )
      seed[index] = Math.random()
      sizes[index] = THREE.MathUtils.lerp(
        selectedLayer.sizeMin,
        selectedLayer.sizeMax,
        Math.pow(1 - radiusBand, 0.58),
      )
      glow[index] = THREE.MathUtils.lerp(
        selectedLayer.glowMin,
        selectedLayer.glowMax,
        Math.pow(Math.random(), 0.72),
      )
      pulse[index] = Math.random()

      tint[stride] = THREE.MathUtils.lerp(selectedLayer.tintLow[0], selectedLayer.tintHigh[0], tintMix)
      tint[stride + 1] = THREE.MathUtils.lerp(
        selectedLayer.tintLow[1],
        selectedLayer.tintHigh[1],
        tintMix,
      )
      tint[stride + 2] = THREE.MathUtils.lerp(
        selectedLayer.tintLow[2],
        selectedLayer.tintHigh[2],
        tintMix,
      )
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1))
    geometry.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 1))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))

    return {
      geometry,
      points: new THREE.Points(
        geometry,
        createParticleMaterial({
          opacity: variant === 'outer' ? 0.72 : 1,
          sizeFactor: variant === 'outer' ? 72 : 96,
          blending: variant === 'outer' ? THREE.AdditiveBlending : THREE.NormalBlending,
          fieldWeight: variant === 'outer' ? 1.22 : 1.1,
        }),
      ),
      positions,
      colors,
      sizes,
      glow,
      pulse,
      semiMajor,
      eccentricity,
      inclination,
      node,
      phase,
      verticalAmplitude,
      layerPhase,
      bandMix,
      layerMix,
      brightnessBias,
      seed,
      tint,
    }
  }

  private createDustField(count: number): DustField {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const radius = new Float32Array(count)
    const angle = new Float32Array(count)
    const elevation = new Float32Array(count)
    const speed = new Float32Array(count)
    const phase = new Float32Array(count)
    const seed = new Float32Array(count)
    const tint = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const glow = new Float32Array(count)
    const pulse = new Float32Array(count)

    for (let index = 0; index < count; index += 1) {
      const stride = index * 3

      radius[index] = THREE.MathUtils.lerp(4.4, 8.8, Math.pow(Math.random(), 0.62))
      angle[index] = Math.random() * Math.PI * 2
      elevation[index] = THREE.MathUtils.randFloatSpread(0.9)
      speed[index] = THREE.MathUtils.lerp(0.08, 0.45, Math.random())
      phase[index] = Math.random() * Math.PI * 2
      seed[index] = Math.random()
      sizes[index] = THREE.MathUtils.lerp(0.45, 1.3, Math.random())
      glow[index] = THREE.MathUtils.lerp(0.42, 1.5, Math.pow(Math.random(), 0.62))
      pulse[index] = Math.random()
      const dustMix = Math.random()
      const warmDust = [
        THREE.MathUtils.lerp(0.78, 1.0, Math.random()),
        THREE.MathUtils.lerp(0.62, 0.9, Math.random()),
        THREE.MathUtils.lerp(0.24, 0.48, Math.random()),
      ]
      const coolDust = [
        THREE.MathUtils.lerp(0.4, 0.68, Math.random()),
        THREE.MathUtils.lerp(0.78, 0.96, Math.random()),
        THREE.MathUtils.lerp(0.9, 1.0, Math.random()),
      ]

      tint[stride] = THREE.MathUtils.lerp(warmDust[0], coolDust[0], dustMix)
      tint[stride + 1] = THREE.MathUtils.lerp(warmDust[1], coolDust[1], dustMix)
      tint[stride + 2] = THREE.MathUtils.lerp(warmDust[2], coolDust[2], dustMix)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1))
    geometry.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 1))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))

    return {
      geometry,
      points: new THREE.Points(
        geometry,
        createParticleMaterial({
          opacity: 0.42,
          sizeFactor: 68,
          blending: THREE.AdditiveBlending,
          fieldWeight: 1.26,
        }),
      ),
      positions,
      colors,
      radius,
      angle,
      elevation,
      speed,
      phase,
      seed,
      tint,
    }
  }

  private createStarField() {
    const count = 3600
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    for (let index = 0; index < count; index += 1) {
      const stride = index * 3
      const radius = THREE.MathUtils.lerp(28, 74, Math.pow(Math.random(), 0.82))
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2))
      const temperatureMix = Math.random()

      positions[stride] = radius * Math.sin(phi) * Math.cos(theta)
      positions[stride + 1] = radius * Math.cos(phi)
      positions[stride + 2] = radius * Math.sin(phi) * Math.sin(theta)

      if (temperatureMix < 0.38) {
        colors[stride] = THREE.MathUtils.lerp(0.88, 1.0, Math.random())
        colors[stride + 1] = THREE.MathUtils.lerp(0.74, 0.94, Math.random())
        colors[stride + 2] = THREE.MathUtils.lerp(0.36, 0.62, Math.random())
      } else if (temperatureMix < 0.84) {
        colors[stride] = THREE.MathUtils.lerp(0.52, 0.76, Math.random())
        colors[stride + 1] = THREE.MathUtils.lerp(0.82, 0.98, Math.random())
        colors[stride + 2] = THREE.MathUtils.lerp(0.92, 1.0, Math.random())
      } else {
        colors[stride] = THREE.MathUtils.lerp(0.88, 1.0, Math.random())
        colors[stride + 1] = THREE.MathUtils.lerp(0.9, 1.0, Math.random())
        colors[stride + 2] = THREE.MathUtils.lerp(0.94, 1.0, Math.random())
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.09,
        opacity: 0.78,
        transparent: true,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
  }

  private createNebulaField() {
    const count = 1400
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const pulse = new Float32Array(count)

    for (let index = 0; index < count; index += 1) {
      const stride = index * 3
      const lobe = index % 3
      const angle = Math.random() * Math.PI * 2
      const radius = THREE.MathUtils.lerp(6, 20, Math.pow(Math.random(), 0.56))
      const centerX = lobe === 0 ? -18 : lobe === 1 ? 15 : -4
      const centerY = lobe === 0 ? 6 : lobe === 1 ? -4 : -11
      const centerZ = lobe === 0 ? -40 : lobe === 1 ? -47 : -56

      positions[stride] = centerX + Math.cos(angle) * radius * THREE.MathUtils.lerp(1.2, 2.2, Math.random())
      positions[stride + 1] = centerY + Math.sin(angle) * radius * THREE.MathUtils.lerp(0.45, 1.1, Math.random())
      positions[stride + 2] = centerZ + THREE.MathUtils.randFloatSpread(14)

      sizes[index] = THREE.MathUtils.lerp(34, 96, Math.pow(Math.random(), 0.62))
      pulse[index] = Math.random()

      if (Math.random() > 0.44) {
        colors[stride] = THREE.MathUtils.lerp(0.34, 0.64, Math.random())
        colors[stride + 1] = THREE.MathUtils.lerp(0.68, 0.92, Math.random())
        colors[stride + 2] = THREE.MathUtils.lerp(0.82, 1.0, Math.random())
      } else {
        colors[stride] = THREE.MathUtils.lerp(0.7, 0.98, Math.random())
        colors[stride + 1] = THREE.MathUtils.lerp(0.48, 0.8, Math.random())
        colors[stride + 2] = THREE.MathUtils.lerp(0.18, 0.42, Math.random())
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 1))

    return new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0.12 },
          uOpacity: { value: 0.03 },
          uFlash: { value: 0 },
        },
        vertexShader: `
          attribute float aSize;
          attribute float aPulse;
          varying vec3 vColor;
          varying float vPulse;
          uniform float uTime;
          uniform float uIntensity;
          uniform float uFlash;

          void main() {
            vColor = color;
            vPulse = aPulse;

            vec3 displaced = position;
            displaced.x += sin(uTime * 0.06 + aPulse * 22.0 + position.y * 0.08) * (0.8 + uFlash * 0.5);
            displaced.y += cos(uTime * 0.05 + aPulse * 18.0 + position.x * 0.06) * (0.56 + uFlash * 0.36);
            displaced.z += sin(uTime * 0.04 + aPulse * 15.0 + position.x * 0.03) * 0.5;

            vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
            gl_PointSize = aSize * (7.4 / -mvPosition.z) * (0.66 + uIntensity * 0.12 + uFlash * 0.16);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uIntensity;
          uniform float uOpacity;
          uniform float uFlash;
          varying vec3 vColor;
          varying float vPulse;

          void main() {
            vec2 uv = gl_PointCoord * 2.0 - 1.0;
            float dist = length(uv);
            float soft = smoothstep(1.06, 0.0, dist);
            float halo = exp(-dist * 2.2);
            float core = exp(-dist * 6.8);
            float shimmer = 0.82 + 0.18 * sin(uTime * (0.24 + vPulse * 0.22) + vPulse * 19.0);
            vec3 flashTint = mix(vColor, vec3(1.0, 0.98, 0.95), uFlash * 0.42);
            vec3 color = flashTint * (halo * 0.46 + core * 0.68) * (uIntensity * 0.52 + shimmer * 0.18);
            float alpha = soft * (halo * 0.07 + core * 0.05) * uOpacity * (0.7 + uFlash * 0.12);
            gl_FragColor = vec4(color, alpha);
          }
        `,
      }),
    )
  }

  private createSunBillboard(width: number, height: number, color: THREE.Color, opacity: number) {
    return new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: color },
          uOpacity: { value: opacity },
        },
        vertexShader: `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec2 vUv;

          void main() {
            vec2 centered = vUv - 0.5;
            float halo = smoothstep(0.58, 0.0, length(centered));
            float core = smoothstep(0.18, 0.0, length(centered));
            float streak = smoothstep(0.08, 0.0, abs(centered.y)) * smoothstep(0.76, 0.0, abs(centered.x));
            float diagonalA = smoothstep(0.06, 0.0, abs(centered.x + centered.y) * 0.7071) * smoothstep(0.8, 0.0, length(centered));
            float diagonalB = smoothstep(0.06, 0.0, abs(centered.x - centered.y) * 0.7071) * smoothstep(0.8, 0.0, length(centered));
            float alpha = (halo * 0.42 + core * 0.8 + streak * 0.54 + (diagonalA + diagonalB) * 0.18) * uOpacity;
            vec3 color = uColor * (halo * 0.92 + core * 1.5 + streak * 0.84 + (diagonalA + diagonalB) * 0.3);
            gl_FragColor = vec4(color, alpha);
          }
        `,
      }),
    )
  }

  private createPlanetBody() {
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uBrightness: { value: 0.2 },
    }

    return new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 64, 64),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
          varying vec3 vNormal;
          varying vec2 vUv;
          varying vec3 vWorldPosition;
          varying vec3 vLocalPosition;

          void main() {
            vNormal = normalize(normalMatrix * normal);
            vUv = uv;
            vLocalPosition = position;
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uBrightness;
          varying vec3 vNormal;
          varying vec2 vUv;
          varying vec3 vWorldPosition;
          varying vec3 vLocalPosition;

          void main() {
            vec3 normal = normalize(vNormal);
            vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
            vec3 lightDirection = normalize(vec3(-0.65, 0.35, 0.68));
            vec3 fillDirection = normalize(vec3(0.22, -0.18, 0.96));
            vec3 localPosition = vLocalPosition;

            float latitude = normal.y;
            float equator = 1.0 - abs(latitude);
            float bandA = 0.5 + 0.5 * sin(vUv.y * 18.0 + uTime * 0.16);
            float bandB = 0.5 + 0.5 * sin(vUv.y * 44.0 - uTime * 0.08 + bandA * 0.9);
            float bandC = 0.5 + 0.5 * sin(vUv.y * 86.0 + uTime * 0.04 + bandB * 1.6);
            float bandD = 0.5 + 0.5 * sin(vUv.y * 132.0 - uTime * 0.03 + bandC * 1.4);
            float bandE = 0.5 + 0.5 * sin(vUv.y * 176.0 + uTime * 0.02 + bandD * 1.8);
            float broadBand = 0.5 + 0.5 * sin(vUv.y * 6.5 - uTime * 0.03);
            float storm = 0.5 + 0.5 * sin(vUv.x * 7.0 + vUv.y * 15.0 - uTime * 0.14);
            float haze = 0.5 + 0.5 * sin(vUv.y * 3.8 + vUv.x * 1.4);
            float polarCool = pow(abs(latitude), 1.5);
            float equatorBand = smoothstep(0.08, 0.96, equator);
            float bandContrast = bandA * 0.22 - bandB * 0.16 + bandC * 0.1 + bandD * 0.06 - bandE * 0.05 + broadBand * 0.1;
            float fineBandMask = (bandD * 0.55 + bandE * 0.45) * equatorBand;
            float beltLight = smoothstep(0.26, 0.88, bandA * 0.6 + bandC * 0.4) * equatorBand;
            float beltShadow = smoothstep(0.28, 0.84, bandB * 0.54 + bandD * 0.46) * equatorBand;
            float polarHaze = pow(abs(latitude), 2.05);

            vec3 base = mix(vec3(0.28, 0.245, 0.19), vec3(0.82, 0.78, 0.68), 0.28 + bandA * 0.2 + broadBand * 0.14);
            base = mix(base, vec3(0.63, 0.61, 0.58), polarHaze * 0.2);
            base += vec3(0.05, 0.034, 0.021) * equatorBand * 0.24;
            base += vec3(0.062, 0.045, 0.028) * beltLight * 0.34;
            base += vec3(0.036, 0.029, 0.021) * max(bandContrast, 0.0) * equatorBand;
            base += vec3(0.022, 0.018, 0.013) * fineBandMask * 0.32;
            base += vec3(0.03, 0.025, 0.018) * haze * 0.08;
            base -= vec3(0.056, 0.046, 0.034) * beltShadow * 0.32;
            base -= vec3(0.06, 0.05, 0.038) * (1.0 - bandB) * 0.24;
            base -= vec3(0.028, 0.022, 0.018) * (1.0 - bandC) * 0.18;
            base -= vec3(0.018, 0.014, 0.011) * (1.0 - bandD) * 0.12;
            base -= vec3(0.02, 0.017, 0.014) * storm * equatorBand * 0.18;

            float ringTilt = radians(31.0);
            float tiltCos = cos(ringTilt);
            float tiltSin = sin(ringTilt);
            vec3 ringSpacePosition = vec3(
              localPosition.x,
              localPosition.y * tiltCos + localPosition.z * tiltSin,
              -localPosition.y * tiltSin + localPosition.z * tiltCos
            );
            vec3 ringSpaceLight = normalize(vec3(
              lightDirection.x,
              lightDirection.y * tiltCos + lightDirection.z * tiltSin,
              -lightDirection.y * tiltSin + lightDirection.z * tiltCos
            ));
            float planeHit = step(0.0, -ringSpacePosition.y / ringSpaceLight.y);
            float hitDistance = -ringSpacePosition.y / (ringSpaceLight.y + sign(ringSpaceLight.y) * 0.0001);
            vec3 shadowHit = ringSpacePosition + ringSpaceLight * hitDistance;
            float shadowRadius = length(shadowHit.xz);
            float ringInner = smoothstep(1.38, 1.58, shadowRadius);
            float ringOuter = 1.0 - smoothstep(4.72, 5.0, shadowRadius);
            float cassiniGap = 1.0 - smoothstep(2.38, 2.56, shadowRadius) * (1.0 - smoothstep(2.64, 2.86, shadowRadius));
            float enckeGap = 1.0 - smoothstep(4.18, 4.24, shadowRadius) * (1.0 - smoothstep(4.3, 4.4, shadowRadius));
            float bandShadow = 1.0 - smoothstep(0.06, 0.22, abs(ringSpacePosition.y + 0.03));
            float ringShadow = ringInner * ringOuter * cassiniGap * enckeGap * planeHit;
            ringShadow = mix(ringShadow, max(ringShadow, bandShadow * ringInner), 0.72);
            ringShadow *= smoothstep(0.0, 0.18, max(dot(normal, lightDirection), 0.0));

            float key = smoothstep(-0.18, 0.42, dot(normal, lightDirection));
            float fill = smoothstep(-0.26, 0.34, dot(normal, fillDirection));
            float night = smoothstep(-0.7, 0.12, dot(normal, lightDirection));
            float ambient = 0.37 + equator * 0.045 + polarCool * 0.03;
            float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.3);
            vec3 color = base * (ambient + key * 0.6 + fill * 0.15 + night * 0.08) * (0.58 + uBrightness * 0.05);
            color *= 0.96 + (bandContrast * 0.07 + fineBandMask * 0.08) * key;
            color *= 1.0 - ringShadow * 0.68;
            color += vec3(0.22, 0.2, 0.16) * rim * 0.08;
            color = max(color, vec3(0.03, 0.025, 0.02));

            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    )
  }

  private createAtmosphereShell() {
    const uniforms: Record<string, THREE.IUniform> = {
      uOpacity: { value: 0.11 },
      uColor: { value: new THREE.Color(0xd8c4a0) },
    }

    return new THREE.Mesh(
      new THREE.SphereGeometry(1.34, 48, 48),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms,
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vWorldPosition;

          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          uniform float uOpacity;
          uniform vec3 uColor;
          varying vec3 vNormal;
          varying vec3 vWorldPosition;

          void main() {
            vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
            float fresnel = pow(1.0 - max(dot(vNormal, viewDirection), 0.0), 4.2);
            float polarGlow = 0.54 + 0.24 * pow(abs(vNormal.y), 1.3);
            float alpha = fresnel * polarGlow * uOpacity;
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
      }),
    )
  }

  private updateCoreField(
    elapsed: number,
    openness: number,
    chaos: number,
    explosion: number,
    brightness: number,
  ) {
    const spread = THREE.MathUtils.lerp(1, 1.01, openness)
    const chaosAmplitude = THREE.MathUtils.lerp(0, 0.012, chaos)
    const snapBurst = Math.max(0, explosion - 1)

    for (let index = 0; index < this.coreField.radius.length; index += 1) {
      const stride = index * 3
      const baseRadius = this.coreField.radius[index]
      const shellWeight = smoothstep(0.92, 1.015, baseRadius)
      const innerWeight = 1 - shellWeight
      const radius = baseRadius * spread
      const theta = this.coreField.theta[index] + elapsed * 0.026 * this.coreField.spin[index]
      const phi = this.coreField.phi[index] + Math.sin(elapsed * 0.08 + this.coreField.phase[index]) * (0.0012 + innerWeight * 0.0012)
      const orbitalPulse = 1 + Math.sin(elapsed * 1.2 + this.coreField.phase[index]) * (0.003 + innerWeight * 0.002)

      let x = radius * Math.sin(phi) * Math.cos(theta) * orbitalPulse
      let y = radius * Math.cos(phi) * orbitalPulse * 0.88
      let z = radius * Math.sin(phi) * Math.sin(theta) * orbitalPulse

      const jitterSeed = this.coreField.seed[index]
      const jitter = chaosAmplitude * (0.003 + jitterSeed * (0.008 + innerWeight * 0.012))

      x += Math.sin(elapsed * (6 + jitterSeed * 4) + this.coreField.phase[index]) * jitter
      y += Math.cos(elapsed * (5 + jitterSeed * 4) + this.coreField.phase[index]) * jitter
      z += Math.sin(elapsed * (7 + jitterSeed * 5) + this.coreField.phase[index] * 1.2) * jitter

      const radialLength = Math.max(0.001, Math.hypot(x, y, z))
      const directionX = x / radialLength
      const directionY = y / radialLength
      const directionZ = z / radialLength
      const blowout = explosion * Math.pow(jitterSeed, 2.1) * (0.08 + innerWeight * 0.08)
      const snapImpulse = snapBurst * (5.4 + innerWeight * 4.8 + jitterSeed * 4.6)

      x = x * (1 + blowout + snapBurst * 1.9) + directionX * snapImpulse
      y = y * (1 + blowout * 0.24 + snapBurst * 1.34) + directionY * snapImpulse * 0.92
      z = z * (1 + blowout + snapBurst * 1.9) + directionZ * snapImpulse

      this.coreField.positions[stride] = x
      this.coreField.positions[stride + 1] = y
      this.coreField.positions[stride + 2] = z

      const shimmer = 0.88 + Math.sin(elapsed * (0.9 + jitterSeed * 0.4) + this.coreField.phase[index]) * 0.08
      const particleBrightness =
        (0.152 + brightness * (0.128 + jitterSeed * 0.05)) *
        (1.06 - chaos * 0.018 + explosion * 0.15 + innerWeight * 0.22) *
        shimmer
      const luminosity = 0.94 + Math.pow(jitterSeed, 0.56) * 0.82 + innerWeight * 0.18
      this.coreField.colors[stride] =
        this.coreField.tint[stride] * particleBrightness * luminosity * (0.98 + shellWeight * 0.06)
      this.coreField.colors[stride + 1] =
        this.coreField.tint[stride + 1] * particleBrightness * luminosity * (0.97 + shellWeight * 0.08)
      this.coreField.colors[stride + 2] =
        this.coreField.tint[stride + 2] * particleBrightness * luminosity * (0.95 + innerWeight * 0.12)

      this.coreField.glow[index] = THREE.MathUtils.clamp(0.62 + jitterSeed * 0.5 + shimmer * 0.14 + innerWeight * 0.13, 0.62, 1.38)
      this.coreField.sizes[index] = THREE.MathUtils.clamp(0.54 + jitterSeed * (0.2 + shellWeight * 0.06), 0.48, 1.1)
    }

    this.coreField.geometry.attributes.position.needsUpdate = true
    this.coreField.geometry.attributes.color.needsUpdate = true
    this.coreField.geometry.attributes.aGlow.needsUpdate = true
    this.coreField.geometry.attributes.aSize.needsUpdate = true
  }

  private updateRingField(
    field: RingField,
    elapsed: number,
    openness: number,
    chaos: number,
    explosion: number,
    brightness: number,
  ) {
    const spread = THREE.MathUtils.lerp(1, 1.58, openness)
    const ringTilt = THREE.MathUtils.degToRad(31)
    const isMainRing = field === this.ringField
    const snapBurst = Math.max(0, explosion - 1)

    for (let index = 0; index < field.semiMajor.length; index += 1) {
      const stride = index * 3
      const seed = field.seed[index]
      const baseRadius = field.semiMajor[index]
      const layerMix = field.layerMix[index]
      const brightnessBias = field.brightnessBias[index]
      const semimajor = baseRadius * spread
      const eccentricity = field.eccentricity[index]
      const verticalAmplitude = field.verticalAmplitude[index] * spread
      const layerPhase = field.layerPhase[index]
      const bandMix = field.bandMix[index]
      const angularVelocity = 1.48 / Math.pow(baseRadius, 1.5)
      const anomaly = field.phase[index] + elapsed * angularVelocity * (1 - chaos * 0.45)
      const orbitalRadius =
        (semimajor * (1 - eccentricity * eccentricity)) /
        (1 + eccentricity * Math.cos(anomaly))

      let x = orbitalRadius * Math.cos(anomaly)
      let z = orbitalRadius * Math.sin(anomaly)
      let y =
        Math.sin(anomaly * 2.2 + layerPhase + elapsed * (0.34 + seed * 0.32)) * verticalAmplitude +
        Math.sin(anomaly * 6.4 + layerPhase * 1.7 - elapsed * (0.24 + bandMix * 0.28)) *
          verticalAmplitude *
          0.36 +
        Math.sin(elapsed * (0.9 + seed * 0.7) + layerPhase) * verticalAmplitude * 0.22 +
        Math.sin(anomaly * 3.1 + seed * 18) * field.inclination[index] * orbitalRadius * 0.08

      const cosNode = Math.cos(field.node[index])
      const sinNode = Math.sin(field.node[index])
      const xNode = x * cosNode - z * sinNode
      const zNode = x * sinNode + z * cosNode

      x = xNode
      z = zNode

      const yTilt = y * Math.cos(ringTilt) - z * Math.sin(ringTilt)
      const zTilt = y * Math.sin(ringTilt) + z * Math.cos(ringTilt)

      y = yTilt
      z = zTilt

        const brownian = chaos * (0.02 + seed * 0.06) * (1 + baseRadius * 0.04)
        x += Math.sin(elapsed * (18 + seed * 26) + field.phase[index]) * brownian
        y += Math.cos(elapsed * (22 + seed * 28) + field.phase[index] * 0.6) * brownian
        z += Math.sin(elapsed * (20 + seed * 24) + field.phase[index] * 1.3) * brownian

      const radialLength = Math.max(0.001, Math.hypot(x, z))
      const outwardStrength = explosion * Math.pow(seed, 1.4) * (0.12 + baseRadius * 0.14)
      const snapEjection = snapBurst * (0.8 + baseRadius * 0.34 + seed * 0.8)

      x += (x / radialLength) * (outwardStrength * 3.4 + snapEjection * 6.4)
      z += (z / radialLength) * (outwardStrength * 3.4 + snapEjection * 6.4)
      y += Math.sin(elapsed * (28 + seed * 34)) * (outwardStrength * 0.72 + snapEjection * 1.28)

      field.positions[stride] = x
      field.positions[stride + 1] = y
      field.positions[stride + 2] = z

      const verticalGlow = 1 - Math.min(1, Math.abs(y) / (verticalAmplitude * 4.6 + 0.001))
      const radialBand = 0.5 + 0.5 * Math.sin(baseRadius * 3.2 + layerPhase * 1.2)
      const broadBand = 0.5 + 0.5 * Math.sin(baseRadius * 1.8 + layerPhase * 0.45 + seed * 2.7)
      const ringletFrequency = THREE.MathUtils.lerp(10.6, 5.4, layerMix)
      const ringletA =
        0.5 +
        0.5 * Math.sin(baseRadius * ringletFrequency + layerPhase * (1.4 + layerMix * 0.8) + seed * 6)
      const ringletB =
        0.5 +
        0.5 * Math.sin(baseRadius * (ringletFrequency * 2.25) - layerPhase * 0.8 + seed * 11)
      const frontBack = THREE.MathUtils.clamp(0.5 + z / (semimajor * 2.2), 0, 1)
      const frontFocus = Math.pow(frontBack, 1.18)
      const highlightBandA = isMainRing
        ? 1 - smoothstep(0.0, 0.11, Math.abs(baseRadius - 2.78))
        : 0
      const highlightBandB = isMainRing
        ? 1 - smoothstep(0.0, 0.16, Math.abs(baseRadius - 3.86))
        : 0
      const narrowHighlight =
        (highlightBandA * 0.96 + highlightBandB * 1.18) *
        (0.88 + ringletA * 0.12 + ringletB * 0.2 + frontFocus * 0.16)
      const innerGap = smoothstep(2.12, 2.24, baseRadius) * (1 - smoothstep(2.24, 2.46, baseRadius))
      const outerGap = smoothstep(4.54, 4.82, baseRadius) * (1 - smoothstep(4.82, 5.56, baseRadius))
      const radialGapFade = 1 - Math.max(innerGap, outerGap) * 0.98
      const ringDensity = 0.82 + radialBand * 0.08 + broadBand * 0.1
      const nearSideBoost = 0.28 + frontFocus * 1.08
      const farSideDesaturate = 0.68 + frontFocus * 0.16
      const farSideFade = 0.62 + frontFocus * 0.52
      const depthVeil = THREE.MathUtils.lerp(0.8, 1.36, frontFocus)
      const particleBrightness =
        (0.112 + brightness * (0.246 + bandMix * 0.208) + chaos * 0.028) *
        (0.62 + verticalGlow * 0.2) *
        (0.52 + radialBand * 0.1 + broadBand * 0.14 + ringletA * 0.16 + ringletB * 0.18) *
        ringDensity *
        nearSideBoost *
        depthVeil *
        radialGapFade *
        (0.78 + brightnessBias * 0.4) *
        (1 + narrowHighlight * 1.46)
      const luminosity =
        (0.98 + Math.pow(seed, 0.72) * 1.46) *
        (0.88 + ringletA * 0.16 + ringletB * 0.12) *
        (1 + narrowHighlight * 0.7)
      const warmBias = THREE.MathUtils.lerp(1.12, 0.96, layerMix)
      const coolBias = THREE.MathUtils.lerp(0.9, 1.14, layerMix)
      field.colors[stride] =
        field.tint[stride] *
        particleBrightness *
        luminosity *
        (0.62 + bandMix * 0.05 + broadBand * 0.05 + ringletA * 0.1 + narrowHighlight * 0.18) *
        farSideDesaturate *
        farSideFade *
        warmBias
      field.colors[stride + 1] =
        field.tint[stride + 1] *
        particleBrightness *
        luminosity *
        (0.62 + verticalGlow * 0.08 + broadBand * 0.06 + ringletB * 0.08 + narrowHighlight * 0.24) *
        farSideDesaturate *
        farSideFade
      field.colors[stride + 2] =
        field.tint[stride + 2] *
        particleBrightness *
        luminosity *
        (0.6 + (1 - frontBack) * 0.08 + broadBand * 0.04 + ringletA * 0.06 + narrowHighlight * 0.28) *
        farSideFade *
        coolBias

      field.glow[index] =
        THREE.MathUtils.lerp(0.46, 1.92, frontFocus) *
        (0.72 + brightnessBias * 0.24 + ringletA * 0.12 + narrowHighlight * 0.44)
      field.sizes[index] =
        THREE.MathUtils.lerp(0.46, 1.42, frontFocus) *
        THREE.MathUtils.lerp(0.68, 1.16, seed) *
        (0.8 + brightnessBias * 0.16 + narrowHighlight * 0.08)
    }

    field.geometry.attributes.position.needsUpdate = true
    field.geometry.attributes.color.needsUpdate = true
    field.geometry.attributes.aGlow.needsUpdate = true
    field.geometry.attributes.aSize.needsUpdate = true
  }

  private updateDustField(
    elapsed: number,
    openness: number,
    chaos: number,
    explosion: number,
    brightness: number,
  ) {
    const orbitSpread = THREE.MathUtils.lerp(1, 1.2, openness)
    const snapBurst = Math.max(0, explosion - 1)

    for (let index = 0; index < this.dustField.radius.length; index += 1) {
    const stride = index * 3
    const seed = this.dustField.seed[index]
    const baseRadius = this.dustField.radius[index] * orbitSpread
    const angle = this.dustField.angle[index] + elapsed * this.dustField.speed[index]
    const flyNoise = chaos * (0.28 + seed * 0.72)

    let x = Math.cos(angle) * baseRadius
    let z = Math.sin(angle) * baseRadius
    let y = this.dustField.elevation[index] + Math.sin(elapsed * 0.8 + this.dustField.phase[index]) * 0.12

    x += Math.sin(elapsed * (24 + seed * 34) + this.dustField.phase[index]) * flyNoise
    y += Math.cos(elapsed * (29 + seed * 31) + this.dustField.phase[index] * 0.4) * flyNoise
    z += Math.sin(elapsed * (26 + seed * 29) + this.dustField.phase[index] * 1.1) * flyNoise

    const shock = explosion * Math.pow(seed, 1.25) * 4.1 + snapBurst * (5.8 + seed * 7.4)
    x *= 1 + shock * 0.34
    y *= 1 + shock * 0.22
    z *= 1 + shock * 0.34

    this.dustField.positions[stride] = x
    this.dustField.positions[stride + 1] = y
    this.dustField.positions[stride + 2] = z

      const particleBrightness = 0.082 + brightness * 0.3 + chaos * 0.13
      const luminosity = 0.74 + Math.pow(seed, 0.52) * 1.62
      this.dustField.colors[stride] = this.dustField.tint[stride] * particleBrightness * luminosity
      this.dustField.colors[stride + 1] = this.dustField.tint[stride + 1] * particleBrightness * luminosity
      this.dustField.colors[stride + 2] = this.dustField.tint[stride + 2] * particleBrightness * luminosity
    }

    this.dustField.geometry.attributes.position.needsUpdate = true
    this.dustField.geometry.attributes.color.needsUpdate = true
  }

  private handleResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.composer.setSize(window.innerWidth, window.innerHeight)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.bloomPass.setSize(window.innerWidth, window.innerHeight)
  }
}

function createParticleMaterial(options: ParticleMaterialOptions = {}) {
  const { opacity = 1, sizeFactor = 96, blending = THREE.NormalBlending, fieldWeight = 1 } = options

  return new THREE.ShaderMaterial({
    blending,
    depthWrite: false,
    transparent: true,
    vertexColors: true,
    uniforms: {
      uOpacity: { value: opacity },
      uSizeFactor: { value: sizeFactor },
      uTime: { value: 0 },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
      uSunStrength: { value: 1.2 },
      uExplosionProgress: { value: 0 },
      uExplosionForce: { value: 0 },
      uExplosionElapsed: { value: 0 },
      uImplosionProgress: { value: 0 },
      uShockwaveProgress: { value: 0 },
      uDriftProgress: { value: 0 },
      uReturnProgress: { value: 0 },
      uFlashProgress: { value: 0 },
      uFieldWeight: { value: fieldWeight },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aGlow;
      attribute float aPulse;
      attribute float aSeed;
      varying vec3 vColor;
      varying vec3 vWorldPosition;
      varying float vGlow;
      varying float vPulse;
      varying float vExplosionEnergy;
      varying float vFlash;
      varying float vCoolDown;
      varying float vTurbulence;
      uniform float uSizeFactor;
      uniform float uTime;
      uniform float uExplosionProgress;
      uniform float uExplosionForce;
      uniform float uExplosionElapsed;
      uniform float uImplosionProgress;
      uniform float uShockwaveProgress;
      uniform float uDriftProgress;
      uniform float uReturnProgress;
      uniform float uFlashProgress;
      uniform float uFieldWeight;

      vec3 safeNormalize(vec3 value) {
        float magnitudeSquared = max(dot(value, value), 1e-6);
        return value * inversesqrt(magnitudeSquared);
      }

      vec3 pseudoCurl(vec3 p, float time, float seed) {
        float x = sin(p.y * 2.9 + time * 1.6 + seed * 17.0) - cos(p.z * 4.1 - time * 1.2 + seed * 11.0);
        float y = sin(p.z * 3.6 - time * 1.05 + seed * 13.0) - cos(p.x * 4.4 + time * 1.5 + seed * 7.0);
        float z = sin(p.x * 3.8 + time * 1.32 + seed * 19.0) - cos(p.y * 4.2 - time * 1.15 + seed * 5.0);
        return safeNormalize(vec3(x, y, z));
      }

      void main() {
        vColor = color;
        vGlow = aGlow;
        vPulse = aPulse;
        vec3 displacedPosition = position;
        vec3 radialDirection = safeNormalize(position + vec3(
          sin(aSeed * 31.0) * 0.015,
          cos(aSeed * 17.0) * 0.015,
          sin(aSeed * 43.0) * 0.015
        ));
        vec3 curlDirection = pseudoCurl(
          displacedPosition * (1.05 + uFieldWeight * 0.24),
          uTime + uExplosionElapsed * 1.8,
          aSeed
        );
        vec3 swirlDirection = safeNormalize(cross(radialDirection, curlDirection + vec3(0.11, 1.0, -0.07)));
        float returnFade = 1.0 - uReturnProgress;
        float dragFade = exp(-uDriftProgress * (1.65 + aSeed * 1.4));
        float implosionPull = uImplosionProgress * uFieldWeight * (0.52 + aGlow * 0.28 + aSeed * 0.24);
        float burstDistance = uExplosionForce * uFieldWeight * (4.6 + aSeed * 8.8 + aGlow * 2.4);
        float plumeDistance = uExplosionProgress * uFieldWeight * (3.4 + aSeed * 6.8) * dragFade;
        float swirlDistance = uExplosionProgress * (0.7 + aSeed * 1.24 + aGlow * 0.32) * dragFade * returnFade;
        float floatDistance = uDriftProgress * (0.54 + aSeed * 1.08) * returnFade;

        displacedPosition -= radialDirection * implosionPull;
        displacedPosition += radialDirection * (burstDistance * uShockwaveProgress + plumeDistance) * returnFade;
        displacedPosition += curlDirection * plumeDistance * 1.18 * returnFade;
        displacedPosition += swirlDirection * swirlDistance * 2.2;
        displacedPosition += (curlDirection * 0.74 + swirlDirection * 0.32) * floatDistance;
        displacedPosition += radialDirection * sin(uTime * (0.7 + aSeed * 0.45) + aPulse * 29.0) * floatDistance * 0.22;

        vec4 worldPosition = modelMatrix * vec4(displacedPosition, 1.0);
        vWorldPosition = worldPosition.xyz;
        vec4 mvPosition = modelViewMatrix * vec4(displacedPosition, 1.0);
        float sizePunch = 1.0 + uFlashProgress * 0.72 + uExplosionProgress * 0.22 + uImplosionProgress * 0.18;
        gl_PointSize = aSize * (0.78 + aGlow * 0.26) * sizePunch * (uSizeFactor / -mvPosition.z);
        vExplosionEnergy = clamp(uExplosionProgress * 0.82 + uFlashProgress * 0.9 + uShockwaveProgress * 0.34, 0.0, 1.0);
        vFlash = clamp(uFlashProgress + uImplosionProgress * 0.72, 0.0, 1.0);
        vCoolDown = uReturnProgress;
        vTurbulence = clamp((1.0 - dragFade) * 0.28 + swirlDistance * 0.16 + floatDistance * 0.18, 0.0, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform float uSunStrength;
      uniform float uExplosionProgress;
      uniform float uFlashProgress;
      varying vec3 vColor;
      varying vec3 vWorldPosition;
      varying float vGlow;
      varying float vPulse;
      varying float vExplosionEnergy;
      varying float vFlash;
      varying float vCoolDown;
      varying float vTurbulence;

      void main() {
        vec2 pointUv = gl_PointCoord * 2.0 - 1.0;
        float dist = length(pointUv);
        float edgeMask = smoothstep(1.08, 0.08, dist);
        float halo = exp(-dist * 7.0);
        float hotCore = exp(-dist * 21.0);
        float whiteCore = exp(-dist * 40.0);
        float sparkleSeed = dot(vWorldPosition.xy, vec2(7.13, 11.27)) + vColor.r * 9.0;
        float sparkleAngle = sparkleSeed * 0.21;
        vec2 streakDirection = vec2(cos(sparkleAngle), sin(sparkleAngle));
        vec2 streakNormal = vec2(-streakDirection.y, streakDirection.x);
        float along = abs(dot(pointUv, streakDirection));
        float across = abs(dot(pointUv, streakNormal));
        float streak = exp(-across * 38.0 - along * 4.8);
        float crossFlare = exp(-min(abs(pointUv.x), abs(pointUv.y)) * 34.0 - max(abs(pointUv.x), abs(pointUv.y)) * 12.0);
        float diamondFacet = exp(-abs(abs(pointUv.x) - abs(pointUv.y)) * 18.0 - dist * 12.0);
        float grain = 0.92 + 0.08 * sin(gl_PointCoord.x * 37.0 + gl_PointCoord.y * 41.0 + sparkleSeed);
        vec3 radialDirection = normalize(vWorldPosition + vec3(0.0001));
        vec3 sunDirection = normalize(uSunDirection);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float sunFacing = max(dot(radialDirection, sunDirection), 0.0);
        float forwardScatter = pow(max(dot(viewDirection, sunDirection), 0.0), 4.2);
        float litMask = smoothstep(0.04, 0.58, sunFacing);
        float shadowMask = 1.0 - litMask;
        float baseTwinkle = 0.82 + sin(uTime * (1.2 + vPulse * 3.4) + sparkleSeed * 0.18 + vPulse * 27.0) * 0.18;
        float burstTwinkle = pow(0.5 + 0.5 * sin(uTime * (3.4 + vPulse * 6.2) + sparkleSeed * 0.43), 10.0);
        float flicker = baseTwinkle + burstTwinkle * (0.18 + vGlow * 0.06);
        float glowWeight = 0.82 + vGlow * 0.68;
        float paletteCycle = 0.5 + 0.5 * sin(sparkleSeed * 0.37 + uTime * 3.2 + vPulse * 18.0 + vTurbulence * 7.0);
        vec3 hotPalette = mix(vec3(1.0, 0.74, 0.22), vec3(0.42, 0.92, 1.0), paletteCycle);
        hotPalette = mix(hotPalette, vec3(0.98, 0.99, 0.97), vTurbulence * 0.16 + vFlash * 0.12);
        vec3 cooledBase = mix(vColor, vColor * vec3(0.24, 0.3, 0.44) + vec3(0.04, 0.05, 0.1), vCoolDown * 0.72);
        vec3 baseTint = mix(cooledBase, vec3(0.99, 0.995, 0.992), 0.18 + vFlash * 0.12);
        vec3 shadowTint = baseTint * vec3(0.5, 0.54, 0.66);
        vec3 structuredTint = mix(shadowTint, baseTint, litMask);
        vec3 sunGlow = uSunColor * (litMask * 0.28 + sunFacing * 0.32 + forwardScatter * 0.94) * (0.14 + hotCore * 0.56 + whiteCore * 0.32 + streak * 0.14) * uSunStrength * (0.76 + vGlow * 0.42);
        vec3 flareTint = mix(baseTint, vec3(0.99, 0.985, 0.97), 0.08 + vFlash * 0.06);
        vec3 color = (
          structuredTint * (0.4 + litMask * 1.08) * (halo * 0.44 + hotCore * 1.34 + whiteCore * 0.54) * grain * glowWeight +
          flareTint * (streak * 0.12 + crossFlare * 0.045 + diamondFacet * 0.085) * (0.5 + vGlow * 0.42) +
          sunGlow +
          shadowMask * diamondFacet * baseTint * 0.08
        ) * flicker;
        float energyMix = clamp(vExplosionEnergy * (0.72 + vTurbulence * 0.24), 0.0, 1.0);
        vec3 energyGlow = hotPalette * (whiteCore * 1.22 + hotCore * 1.34 + halo * 0.64 + streak * 0.28 + diamondFacet * 0.16) * (1.0 + vGlow * 0.52 + uExplosionProgress * 0.24);
        vec3 implosionWhite = vec3(1.0, 0.997, 0.992) * (vFlash * 0.34 + uExplosionProgress * 0.05) * (whiteCore * 0.72 + hotCore * 0.42 + halo * 0.14 + crossFlare * 0.06);
        color = mix(color, energyGlow, energyMix);
        color += implosionWhite;
        float alpha = (whiteCore * 0.72 + hotCore * 1.22 + halo * 0.28 + streak * 0.08 + crossFlare * 0.026 + diamondFacet * 0.06) * edgeMask * uOpacity * (1.02 + vGlow * 0.42) * (0.98 + flicker * 0.2 + vExplosionEnergy * 0.28 + vFlash * 0.22);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })
}

function smoothstep(minimum: number, maximum: number, value: number) {
  const x = THREE.MathUtils.clamp((value - minimum) / (maximum - minimum), 0, 1)
  return x * x * (3 - 2 * x)
}