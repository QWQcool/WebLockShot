import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import {
  useCallback,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { Story } from '../types'
import { addShotTweens, type MotionTargets } from './motions'

gsap.registerPlugin(useGSAP)

export function shotStarts(story: Story): number[] {
  const starts: number[] = []
  let acc = 0
  for (const shot of story.shots) {
    starts.push(acc)
    acc += shot.durationSec
  }
  return starts
}

export function totalDuration(story: Story): number {
  return story.shots.reduce((sum, shot) => sum + shot.durationSec, 0)
}

export function indexAtTime(story: Story, time: number): number {
  let acc = 0
  for (let i = 0; i < story.shots.length; i++) {
    acc += story.shots[i].durationSec
    if (time < acc - 0.0001) return i
  }
  return story.shots.length - 1
}

function readTargets(stage: HTMLElement): MotionTargets | null {
  const move = stage.querySelector('.layer-move')
  const cast = stage.querySelector('.layer-cast')
  const prop = stage.querySelector('.layer-prop')
  const line = stage.querySelector('.layer-line')
  if (!(move instanceof HTMLElement)) return null
  if (!(cast instanceof HTMLElement)) return null
  if (!(prop instanceof HTMLElement)) return null
  if (!(line instanceof HTMLElement)) return null
  return { stage, move, cast, prop, line }
}

export function useShotTimeline(
  story: Story,
  reducedMotion: boolean,
  rootRef: RefObject<HTMLElement | null>,
  timelineKey: string,
) {
  const tlRef = useRef<gsap.core.Timeline | null>(null)
  const keepIndexRef = useRef(0)
  const lastStoryIdRef = useRef(story.id)
  const [time, setTime] = useState(0)
  const [shotIndex, setShotIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const duration = totalDuration(story)

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return
      if (lastStoryIdRef.current !== story.id) {
        keepIndexRef.current = 0
        lastStoryIdRef.current = story.id
      }

      const stages = Array.from(root.querySelectorAll<HTMLElement>('[data-shot]'))
      const tl = gsap.timeline({
        paused: true,
        onUpdate() {
          const now = tl.time()
          setTime(now)
          const next = indexAtTime(story, now)
          keepIndexRef.current = next
          setShotIndex((prev) => (prev === next ? prev : next))
        },
        onComplete() {
          setPlaying(false)
        },
      })

      let at = 0
      for (const shot of story.shots) {
        const stage = stages.find((el) => el.dataset.shot === shot.id)
        if (!stage) {
          at += shot.durationSec
          continue
        }
        const targets = readTargets(stage)
        if (!targets) {
          at += shot.durationSec
          continue
        }

        tl.set(stages, { autoAlpha: 0 }, at)
        tl.set(stage, { autoAlpha: 1 }, at)
        addShotTweens(tl, shot, targets, at, reducedMotion)
        at += shot.durationSec
      }

      tlRef.current = tl
      const restore = keepIndexRef.current
      const starts = shotStarts(story)
      const t = starts[restore] ?? 0
      tl.pause(t)
      setTime(t)
      setShotIndex(restore)
      setPlaying(false)

      return () => {
        tl.kill()
        tlRef.current = null
      }
    },
    {
      scope: rootRef,
      dependencies: [timelineKey, reducedMotion],
      revertOnUpdate: true,
    },
  )

  const play = useCallback(() => {
    const tl = tlRef.current
    if (!tl) return
    if (tl.progress() === 1) tl.time(0)
    tl.play()
    setPlaying(true)
  }, [])

  const pause = useCallback(() => {
    tlRef.current?.pause()
    setPlaying(false)
  }, [])

  const toggle = useCallback(() => {
    const tl = tlRef.current
    if (!tl) return
    if (tl.isActive()) {
      tl.pause()
      setPlaying(false)
      return
    }
    if (tl.progress() === 1) tl.time(0)
    tl.play()
    setPlaying(true)
  }, [])

  const seekToShot = useCallback(
    (index: number) => {
      const tl = tlRef.current
      if (!tl) return
      const starts = shotStarts(story)
      const t = starts[index] ?? 0
      keepIndexRef.current = index
      tl.pause(t)
      setPlaying(false)
      setTime(t)
      setShotIndex(index)
    },
    [story],
  )

  return {
    time,
    shotIndex,
    playing,
    duration,
    play,
    pause,
    toggle,
    seekToShot,
  }
}
