import gsap from 'gsap'
import type { MotionId, Shot } from '../types'

export type MotionTargets = {
  stage: HTMLElement
  move: HTMLElement
  cast: HTMLElement
  prop: HTMLElement
  line: HTMLElement
}

type Timeline = ReturnType<typeof gsap.timeline>

export function addShotTweens(
  tl: Timeline,
  shot: Shot,
  targets: MotionTargets,
  at: number,
  reducedMotion: boolean,
): void {
  const dur = shot.durationSec
  resetLayers(tl, targets, at)

  if (reducedMotion) {
    tl.to({}, { duration: dur }, at)
    if (shot.line.trim()) {
      tl.set(targets.line, { autoAlpha: 1, y: 0 }, at)
    }
    return
  }

  addPrimaryMotion(tl, shot.motionId, targets, dur, at, shot)
  if (shot.line.trim() && shot.motionId !== 'line_pop') {
    addLinePop(tl, targets.line, at)
  }
}

function resetLayers(tl: Timeline, targets: MotionTargets, at: number): void {
  tl.set(
    [targets.move, targets.cast, targets.prop],
    { x: 0, y: 0, xPercent: 0, yPercent: 0, scale: 1, autoAlpha: 1 },
    at,
  )
  tl.set(targets.line, { autoAlpha: 0, y: 18 }, at)
}

function addPrimaryMotion(
  tl: Timeline,
  motionId: MotionId,
  targets: MotionTargets,
  dur: number,
  at: number,
  shot: Shot,
): void {
  switch (motionId) {
    case 'push_in':
      tl.fromTo(
        targets.move,
        { scale: 1 },
        { scale: 1.14, duration: dur, ease: 'none' },
        at,
      )
      break
    case 'pull_out':
      tl.fromTo(
        targets.move,
        { scale: 1.16 },
        { scale: 1, duration: dur, ease: 'none' },
        at,
      )
      break
    case 'pan_left':
      tl.fromTo(
        targets.move,
        { xPercent: 0 },
        { xPercent: 9, duration: dur, ease: 'none' },
        at,
      )
      break
    case 'pan_right':
      tl.fromTo(
        targets.move,
        { xPercent: 0 },
        { xPercent: -9, duration: dur, ease: 'none' },
        at,
      )
      break
    case 'follow':
      tl.fromTo(
        targets.cast,
        { xPercent: 0 },
        { xPercent: 8, duration: dur, ease: 'none' },
        at,
      )
      break
    case 'cut':
      tl.to({}, { duration: dur }, at)
      break
    case 'enter_stage': {
      const subject =
        shot.prop === 'note' || shot.prop === 'lock' ? targets.prop : targets.cast
      tl.fromTo(
        subject,
        { xPercent: 42, autoAlpha: 0 },
        { xPercent: 0, autoAlpha: 1, duration: Math.min(1.1, dur), ease: 'power2.out' },
        at,
      )
      if (dur > 1.1) tl.to({}, { duration: dur - 1.1 }, at + 1.1)
      break
    }
    case 'line_pop':
      addLinePop(tl, targets.line, at)
      tl.to({}, { duration: dur }, at)
      break
    default:
      tl.to({}, { duration: dur }, at)
  }
}

function addLinePop(tl: Timeline, line: HTMLElement, at: number): void {
  tl.fromTo(
    line,
    { autoAlpha: 0, y: 16 },
    { autoAlpha: 1, y: 0, duration: 0.32, ease: 'power2.out' },
    at + 0.12,
  )
}
