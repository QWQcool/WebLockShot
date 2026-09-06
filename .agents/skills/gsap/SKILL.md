---
name: gsap
description: GSAP animation skill for crafting performant web animations, complex timelines, choreographies, and React integration (useGSAP). Use when designing motion, controlling animatics/timelines, and executing visual interactions.
---

# GSAP Animation & Motion Design

This skill governs creating animations, choreographing motion, and managing timeline playback using GSAP and React `@gsap/react`.

## Core Animation Principles

1. **Performant Transforms**: Animate GPU-accelerated properties (`transform: x, y, scale, rotation`, `opacity`) instead of layout properties (`top`, `left`, `width`, `height`, `margin`) to prevent layout thrashing.
2. **Timeline-Driven Sequencing**: Use `gsap.timeline()` for coordinating multi-step animations rather than chaining independent `delay`s.
3. **Restraint & Purpose**: Animations must serve communication, user focus, or storytelling. Never animate gratuitously.
4. **Accessibility First**: Respect `prefers-reduced-motion` settings. Provide immediate or subtle transitions when reduced motion is preferred.

---

## Core GSAP Patterns

### Basic Tweens
```typescript
import gsap from 'gsap'

// To / From / FromTo
gsap.to(target, { x: 100, opacity: 1, duration: 0.6, ease: 'power2.out' })
gsap.from(target, { y: 20, opacity: 0, duration: 0.5, ease: 'power1.out' })
gsap.fromTo(target, { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4 })
```

### Timeline Sequencing
```typescript
const tl = gsap.timeline({
  defaults: { ease: 'power2.out', duration: 0.5 },
  paused: false,
  onComplete: () => console.log('Timeline finished')
})

tl.from('.header', { y: -20, opacity: 0 })
  .from('.card', { scale: 0.95, opacity: 0, stagger: 0.1 }, '-=0.2') // position parameter
  .to('.highlight', { backgroundColor: '#fffae0', duration: 0.3 })
```

---

## React Integration (`@gsap/react`)

Always use `useGSAP` with scoped references to guarantee clean teardown and avoid detached DOM memory leaks.

```tsx
import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

export function AnimatedComponent() {
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    gsap.from('.item', {
      opacity: 0,
      y: 16,
      stagger: 0.08,
      duration: 0.4,
      ease: 'power2.out'
    })
  }, { scope: containerRef })

  return (
    <div ref={containerRef} className="container">
      <div className="item">Item 1</div>
      <div className="item">Item 2</div>
    </div>
  )
}
```

### Dynamic Context-Safe Event Handlers
```tsx
const { contextSafe } = useGSAP({ scope: containerRef })

const handleClick = contextSafe(() => {
  gsap.to('.target', { rotation: '+=90', duration: 0.3, ease: 'back.out(2)' })
})
```

---

## Animatic & Stage Timeline Patterns (WebLockShot)

In video/animatic stage systems (like WebLockShot's 9:16 player):
- Driven by a central playback head (`currentTime` or `progress`).
- Timelines are instantiated paused (`paused: true`) and seeked via `tl.seek(time)` or `tl.time(t)`.
- Motions are dictionary-based (`motionId` mapping to defined tweens) ensuring reproducible camera moves (`push_in`, `pull_out`, `pan_left`, `pan_right`, `follow`, `cut`, `enter_stage`, `line_pop`).
