import { characterById } from './characters'
import type { CharacterId } from './characters'
import type { BossKind } from './missions'
import { drawCharacterSkin } from './skins'
import { playMusic, playSfx, resumeAudio, stopMusic } from './audio'

/** Story crawl shown once the player commits to a run. */
const STORY_LINES = [
  'The year is 2026.',
  'A hyper-aggressive plague has wiped out human civilization.',
  'The air belongs to a mutated species of giant flying bugs carrying the infection.',
  'One sting means certain mutation into a flesh-eating zombie.',
  'You are among the last remnants of humanity...',
]

const STORY_DURATION = 22000

interface Line {
  speaker: string
  text: string
  /** 'system' lines are machine readouts, rendered in glowing yellow. */
  side: 'left' | 'right' | 'system'
  /** Slams the screen red and wipes the NPC sprites as the line opens. */
  flash?: boolean
  /** Swaps the NPC canvas for a bespoke scene while the line is on screen. */
  art?: 'dying' | 'ufo'
}

/** Closing crawl after the Hive Mother falls. */
const CREDIT_LINES: Record<'chapter1' | 'chapter2' | 'chapter4', string[]> = {
  chapter4: [
    'The Rust Colossus is dead. The flies are not.',
    'Whatever came down out of that sky was waiting for the breeder to fall.',
    'To Be Continued...',
    'New Game+ unlocked — carry your arsenal back into a harder world.',
  ],
  chapter1: [
    'To Be Continued in Chapter 2: Project Horizon...',
    'Thank you for playing!',
  ],
  chapter2: [
    'Chapter 2 Cleared.',
    'Prepare for Chapter 3: The Primeval Canopy...',
    'Your data progression has been saved!',
  ],
}

const CREDIT_DURATION = 8000

const TYPE_SPEED = 18

function build(): { story: HTMLElement; dialogue: HTMLElement; credits: HTMLElement } {
  const host = document.querySelector('#app')
  if (!host) throw new Error('#app container missing')

  const story = document.createElement('div')
  story.id = 'story'
  story.className = 'absolute inset-0 z-40 hidden overflow-hidden bg-black'
  story.innerHTML = `
    <div class="absolute inset-0 bg-gradient-to-b from-black via-slate-950 to-black"></div>
    <div id="story-viewport" class="absolute inset-0 flex justify-center overflow-hidden">
      <div id="story-crawl" class="max-w-2xl px-8 text-center">
        <h2 class="mb-10 text-4xl font-black tracking-[0.3em] text-orange-500">2 0 2 6</h2>
        ${STORY_LINES.map(
          (l) => `<p class="mb-8 text-2xl leading-relaxed text-slate-200">${l}</p>`
        ).join('')}
        <p class="mt-12 text-sm uppercase tracking-[0.4em] text-emerald-400">Pick up your rifle.</p>
      </div>
    </div>
    <button id="story-skip" class="absolute right-6 top-6 rounded-lg bg-white/10 px-5 py-2 text-sm font-bold text-white ring-1 ring-white/20 hover:bg-white/20">Skip &raquo;</button>
  `
  host.appendChild(story)

  const dialogue = document.createElement('div')
  dialogue.id = 'cutscene'
  dialogue.className =
    'absolute inset-0 z-40 hidden cursor-pointer flex-col justify-end bg-slate-950/95 p-8'
  dialogue.innerHTML = `
    <div class="pointer-events-none absolute inset-x-0 top-16 flex items-end justify-center gap-12">
      <div class="text-center">
        <canvas id="cutscene-portrait" width="140" height="140" class="rounded-2xl bg-black/50 ring-1 ring-emerald-400/40"></canvas>
        <div id="cutscene-portrait-name" class="mt-2 text-sm font-bold text-emerald-300"></div>
      </div>
      <div id="cutscene-survivor-group" class="text-center">
        <canvas id="cutscene-survivors" width="260" height="140" class="rounded-2xl bg-black/50 ring-1 ring-sky-400/30"></canvas>
        <div id="cutscene-survivor-label" class="mt-2 text-sm font-bold text-sky-300">Survivors of the district</div>
      </div>
    </div>
    <div class="mx-auto w-full max-w-3xl rounded-2xl bg-black/80 p-6 ring-1 ring-orange-400/40">
      <div id="cutscene-speaker" class="text-sm font-black uppercase tracking-widest text-orange-300"></div>
      <p id="cutscene-text" class="mt-2 min-h-[72px] text-lg leading-relaxed text-slate-100"></p>
      <div class="mt-2 text-right text-xs uppercase tracking-widest text-slate-500">Click to continue &raquo;</div>
    </div>
  `
  host.appendChild(dialogue)

  const credits = document.createElement('div')
  credits.id = 'credits'
  credits.className = 'absolute inset-0 z-40 hidden overflow-hidden bg-black'
  credits.innerHTML = `
    <div class="absolute inset-0 flex justify-center overflow-hidden">
      <div id="credits-crawl" class="max-w-2xl px-8 text-center">

      </div>
    </div>
  `
  host.appendChild(credits)
  return { story, dialogue, credits }
}

let panels: { story: HTMLElement; dialogue: HTMLElement; credits: HTMLElement } | null = null

/** Built on first use: main.ts replaces #app's markup during boot. */
function panelsReady(): { story: HTMLElement; dialogue: HTMLElement; credits: HTMLElement } {
  if (!panels) panels = build()
  return panels
}

function show(node: HTMLElement, visible: boolean, display: 'flex' | 'block') {
  node.classList.toggle('hidden', !visible)
  if (visible) node.classList.add(display)
  else node.classList.remove(display)
}

let storyAnimation: Animation | null = null

/** Scrolling lore crawl with a synth drone; resolves when finished or skipped. */
export function playStoryIntro(onDone: () => void) {
  resumeAudio()
  playMusic('story')
  const { story } = panelsReady()
  show(story, true, 'block')
  const crawl = document.getElementById('story-crawl')
  const skip = document.getElementById('story-skip')
  if (!crawl || !skip) throw new Error('story cutscene markup missing')

  const finish = () => {
    storyAnimation?.cancel()
    storyAnimation = null
    skip.removeEventListener('click', finish)
    show(story, false, 'block')
    stopMusic()
    onDone()
  }

  crawl.style.transform = 'translateY(100vh)'
  storyAnimation = crawl.animate(
    [{ transform: 'translateY(100vh)' }, { transform: 'translateY(-110%)' }],
    { duration: STORY_DURATION, easing: 'linear', fill: 'forwards' }
  )
  storyAnimation.onfinish = finish
  skip.addEventListener('click', finish)
}

/** The Wardens' camp, cut short by the Leviathan's opening slam. */
function leviathanIntroDialogue(id: CharacterId): Line[] {
  const hero = characterById(id).name
  return [
    { speaker: hero, text: 'What is this place? Who are you people?', side: 'left' },
    {
      speaker: 'Elder Taelon',
      text: 'Shh! The roots hear everything. We are the last of the Wardens. We thought the high leaves would protect us from the spreading rot, but it tracked our path...',
      side: 'right',
    },
    {
      speaker: 'Elder Taelon',
      text: 'Break its glowing anchors, outsider! I will explain everything if we survive the eclipse!',
      side: 'right',
      flash: true,
    },
  ]
}

/** After the Leviathan falls: the Wardens' secret and the road to chapter 4. */
function leviathanOutroDialogue(id: CharacterId): Line[] {
  const hero = characterById(id).name
  return [
    { speaker: hero, text: "It's dead. Now talk. What was that thing hunting you for?", side: 'left' },
    {
      speaker: 'Elder Taelon',
      text: "It wasn't hunting us for food... it was consuming our ancient bloodline to open the seal. My entire family... eaten. It sought the key to the iron gates beyond the mountains.",
      side: 'right',
    },
    { speaker: hero, text: 'Where do I go next?', side: 'left' },
    {
      speaker: 'Elder Taelon',
      text: "The monster was just a scout. The source of the infection lies deep within CHAPTER 4: THE SCORCHED RUSTLANDS\u2014the endless machine deserts where the old world's weapons went mad. Go east, past the dead sea...",
      side: 'right',
    },
  ]
}

/** The dying survivor at the mouth of the Crucible, before the swarm lands. */
function colossusIntroDialogue(id: CharacterId): Line[] {
  const hero = characterById(id).name
  return [
    {
      speaker: hero,
      text: "Hey — hey, stay with me. You're bleeding out. Who did this to you?",
      side: 'left',
      art: 'dying',
    },
    {
      speaker: 'Dying Survivor',
      text: "Don't... don't go down into the salt basin. The flies. Everyone thinks the flies came from the hives \u2014 they didn't. They come out of *it*.",
      side: 'right',
    },
    {
      speaker: hero,
      text: 'Out of what? Slowly. What is down there?',
      side: 'left',
    },
    {
      speaker: 'Dying Survivor',
      text: 'The Rust Colossus. It breeds them. Every zombie fly infecting this whole region crawled out of that thing\u2019s gut. Kill it and the swarm dies with it.',
      side: 'right',
    },
    {
      speaker: 'Dying Survivor',
      text: "But the arena... the arena is packed. Thousands of them, and the flies come in clouds. You won't get a single quiet minute down there. Eight minutes and it wakes up...",
      side: 'right',
    },
    {
      speaker: hero,
      text: 'Hold on. Pressure on the wound \u2014 stay awake!',
      side: 'left',
    },
    {
      speaker: 'System',
      text: '[VITALS LOST \u2014 SURVIVOR DECEASED. HOSTILE DENSITY: EXTREME.]',
      side: 'system',
      flash: true,
    },
    {
      speaker: hero,
      text: "...Rest easy. I'll burn the breeder for you. Weapons hot.",
      side: 'left',
    },
  ]
}

/** Relief, then the sky opens: the hook into whatever comes after chapter 4. */
function colossusOutroDialogue(id: CharacterId): Line[] {
  const hero = characterById(id).name
  return [
    {
      speaker: hero,
      text: '*Long breath out*... It\u2019s down. It\u2019s actually down. Eight minutes of hell and a mountain of scrap, and I\u2019m still standing.',
      side: 'left',
    },
    {
      speaker: hero,
      text: 'The flies are dropping out of the air everywhere. He was right \u2014 the breeder was the whole swarm. That\u2019s it. The Rustlands are clear.',
      side: 'left',
    },
    {
      speaker: 'System',
      text: '[WARNING: UNIDENTIFIED CRAFT — ALTITUDE 400M AND DESCENDING. NOT OF TERRESTRIAL MANUFACTURE.]',
      side: 'system',
      flash: true,
      art: 'ufo',
    },
    {
      speaker: hero,
      text: 'That... that is not a gunship. Nothing we ever built hums like that.',
      side: 'left',
    },
    {
      speaker: 'System',
      text: '[DROP PODS RELEASED. x9 ORGANISMS INBOUND — WINGED, TENTACLED, BIOSIGNATURE UNKNOWN.]',
      side: 'system',
      art: 'ufo',
    },
    {
      speaker: hero,
      text: 'Purple things... wings, and all those tentacles. The Colossus was never the source. Something put it here. Reload. This war just got a lot bigger.',
      side: 'left',
    },
  ]
}

function bossDialogue(id: CharacterId, boss: BossKind): Line[] {
  const hero = characterById(id).name
  if (boss === 'canopy-leviathan') return leviathanIntroDialogue(id)
  if (boss === 'rust-colossus') return colossusIntroDialogue(id)
  if (boss === 'runner-alpha') {
    return [
      {
        speaker: hero,
        text: 'Hold on... something is moving way too fast on the radar.',
        side: 'left',
      },
      {
        speaker: 'Survivor',
        text: "That's the Alpha! It was a track star before the outbreak. Watch your flanks!",
        side: 'right',
      },
    ]
  }
  if (boss === 'camo-stalker') {
    return [
      {
        speaker: hero,
        text: "Hey, are you alright? We're here to get you out.",
        side: 'left',
      },
      {
        speaker: 'Survivor',
        text: 'FRESH MEAT...',
        side: 'right',
      },
    ]
  }
  if (boss === 'cryo-stalker') {
    return [
      {
        speaker: hero,
        text: "Clear! Secure the room... Wait, there's a light on inside that panic bunker. Move up!",
        side: 'left',
      },
      {
        speaker: 'Hidden Researcher 1',
        text: "Stop! Don't open the containment valves! We locked it in there for a reason!",
        side: 'right',
      },
      {
        speaker: hero,
        text: "We're here from the southern safe zones. We destroyed the Hive Mother. Who are you people?",
        side: 'left',
      },
      {
        speaker: 'Hidden Researcher 2',
        text: 'We are the remaining staff of Project Horizon... We tried to weaponize the plague bug venom. But it mutated. It absorbed our liquid nitrogen coolant lines!',
        side: 'right',
      },
      {
        speaker: 'Hidden Researcher 1',
        text: "It's right behind you in the frost core! It doesn't just spread the virus anymore... it's adapting to the sub-zero temperatures! RUN!",
        side: 'right',
      },
      {
        speaker: hero,
        text: 'Take cover and seal that glass. If it bleeds, we can kill it. Weapons hot!',
        side: 'left',
      },
    ]
  }
  if (boss === 'brood-matron') {
    return [
      {
        speaker: 'Survivor 1',
        text: 'The whole skyline went dark an hour ago. That was not a cloud — that was her brood.',
        side: 'right',
      },
      {
        speaker: hero,
        text: 'Then we take the roof back before she lays another wave. Keep your eyes up.',
        side: 'left',
      },
    ]
  }
  return [
    {
      speaker: 'Survivor 1',
      text: "It's suicide going in there... The entire district has become a feeding ground. The air is thick with venom.",
      side: 'right',
    },
    {
      speaker: hero,
      text: "We don't have a choice. The scouting drones confirmed it. The source of the airborne plague is nestling deep inside 'The Infected Hive'.",
      side: 'left',
    },
    {
      speaker: 'Survivor 2',
      text: "They say it's not a normal insect. It's a massive, multi-winged abomination. It absorbed the DNA of the first fallen researchers. It controls the local horde like a hive mind!",
      side: 'right',
    },
    {
      speaker: 'Survivor 1',
      text: 'If you fail, the remaining safe zones drop within 24 hours. The swarm is already gathering outside our perimeter.',
      side: 'right',
    },
    {
      speaker: hero,
      text: "Lock the doors, distribute the remaining ammo, and hold this line at all costs. We're going to pull the plug on this swarm right now. Watch the skies.",
      side: 'left',
    },
  ]
}

function drawPortrait(id: CharacterId) {
  const canvas = document.getElementById('cutscene-portrait')
  if (!(canvas instanceof HTMLCanvasElement)) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  drawCharacterSkin(ctx, id, 52, -Math.PI / 2, false)
  ctx.restore()
}

/** Bespoke scenes for the Crucible: a bleeding survivor, then the craft. */
function drawScene(kind: 'dying' | 'ufo') {
  const canvas = document.getElementById('cutscene-survivors')
  const label = document.getElementById('cutscene-survivor-label')
  if (!(canvas instanceof HTMLCanvasElement)) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (kind === 'dying') {
    if (label) {
      label.textContent = 'Dying survivor'
      label.className = 'mt-2 text-sm font-bold text-red-300'
    }
    ctx.save()
    ctx.translate(130, 92)
    ctx.fillStyle = 'rgba(127,29,29,0.55)'
    ctx.beginPath()
    ctx.ellipse(0, 22, 62, 14, 0, 0, Math.PI * 2)
    ctx.fill()
    // Slumped against a wreck: body low, head tipped back.
    ctx.fillStyle = '#9a7b5a'
    ctx.beginPath()
    ctx.ellipse(6, 4, 46, 20, -0.12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#d6bfa5'
    ctx.beginPath()
    ctx.arc(-40, -12, 20, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#7f1d1d'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(-46, -8)
    ctx.lineTo(-34, -2)
    ctx.stroke()
    ctx.fillStyle = '#7f1d1d'
    for (const [x, y, r] of [[18, 16, 7], [34, 22, 5], [-4, 24, 4]]) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    return
  }
  if (label) {
    label.textContent = 'Unidentified craft'
    label.className = 'mt-2 text-sm font-bold text-fuchsia-300'
  }
  // Saucer overhead, dropping winged tentacle things into the salt.
  ctx.save()
  ctx.translate(130, 44)
  ctx.fillStyle = 'rgba(217,70,239,0.25)'
  ctx.beginPath()
  ctx.moveTo(-70, 84)
  ctx.lineTo(-30, 8)
  ctx.lineTo(30, 8)
  ctx.lineTo(70, 84)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#334155'
  ctx.beginPath()
  ctx.ellipse(0, 4, 60, 15, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#a5f3fc'
  ctx.beginPath()
  ctx.ellipse(0, -8, 26, 16, 0, Math.PI, 0)
  ctx.fill()
  ctx.fillStyle = '#e879f9'
  for (const x of [-34, 0, 34]) {
    ctx.beginPath()
    ctx.arc(x, 10, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  for (const [x, y, s] of [[58, 96, 1], [130, 108, 1.2], [200, 92, 0.9]]) {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(s, s)
    ctx.fillStyle = '#7e22ce'
    ctx.beginPath()
    ctx.ellipse(-22, -8, 16, 7, -0.5, 0, Math.PI * 2)
    ctx.ellipse(22, -8, 16, 7, 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#a855f7'
    ctx.beginPath()
    ctx.arc(0, 0, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#7e22ce'
    ctx.lineWidth = 3
    for (const t of [-8, -3, 3, 8]) {
      ctx.beginPath()
      ctx.moveTo(t, 10)
      ctx.quadraticCurveTo(t * 1.8, 20, t * 0.6, 28)
      ctx.stroke()
    }
    ctx.fillStyle = '#fde047'
    ctx.beginPath()
    ctx.arc(-5, -3, 3, 0, Math.PI * 2)
    ctx.arc(5, -3, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** Three simple NPC sprites so the hero has someone to talk to. */
function drawSurvivors() {
  const canvas = document.getElementById('cutscene-survivors')
  if (!(canvas instanceof HTMLCanvasElement)) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const spots = [60, 130, 200]
  spots.forEach((x, i) => {
    ctx.save()
    ctx.translate(x, 78 + (i === 1 ? -6 : 0))
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.ellipse(0, 34, 22, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = ['#7dd3fc', '#bae6fd', '#38bdf8'][i]
    ctx.beginPath()
    ctx.arc(0, 0, 26, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#0c4a6e'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#0c4a6e'
    ctx.beginPath()
    ctx.arc(-8, -6, 3.5, 0, Math.PI * 2)
    ctx.arc(8, -6, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  })
}

/** The vision the hive mind burns into the survivor as it dies. */
function outroDialogue(id: CharacterId): Line[] {
  const hero = characterById(id).name
  return [
    {
      speaker: hero,
      text: "*Coughing*... It's down... The hive mind is breaking. But what is this sludge? It's... burning through my visor...",
      side: 'left',
    },
    {
      speaker: 'System',
      text: '[CORRUPTIVE BIO-LINK ESTABLISHED: RECOVERING EXPERIMENTAL MEMORY DATA...]',
      side: 'system',
    },
    {
      speaker: hero,
      text: "Arrgh! My head... I'm seeing something. It's a vision... or a memory from the virus itself. A massive, high-tech fortress hidden deep in the frozen mountains...",
      side: 'left',
    },
    {
      speaker: 'Survivor (radio)',
      text: 'Team! Do you copy? The swarm outside our perimeter just collapsed! You did it! What is your status?',
      side: 'right',
    },
    {
      speaker: hero,
      text: "The Hive Mother is dead, but this isn't over. The virus didn't evolve naturally. I just saw the birthplace of the plague. An underground corporate facility called 'Project Horizon' located 200 miles north.",
      side: 'left',
    },
    {
      speaker: 'Survivor (radio)',
      text: "An underground lab? That area was locked down by the military years ago. It's completely overrun by tier-4 mutations!",
      side: 'right',
    },
    {
      speaker: hero,
      text: "Then pack your winter gear and load up the heavy ammunition. We're going to the source. Fire up the transport vehicle... we have a new destination.",
      side: 'left',
    },
  ]
}

/** The bunker interrogation after the Cryo-Stalker falls. */
function cryoOutroDialogue(id: CharacterId): Line[] {
  const hero = characterById(id).name
  return [
    {
      speaker: hero,
      text: "It's over... the frost core is secure. Open the bunker doors and start talking. Why did you people create that abomination?!",
      side: 'left',
    },
    {
      speaker: 'Hidden Researcher 1',
      text: "Create it?! You don't understand... we didn't engineer this virus. We didn't make the plague bugs!",
      side: 'right',
    },
    {
      speaker: hero,
      text: "Don't lie to me. Your computer logs show the genetic splices!",
      side: 'left',
    },
    {
      speaker: 'Hidden Researcher 2',
      text: 'We only experimented on what we uncovered! The original plague bugs were found deep underground, frozen in an ancient ice shelf. We were just trying to isolate the venom, but the source... the source is far older and completely unnatural.',
      side: 'right',
    },
    {
      speaker: hero,
      text: "If you didn't engineer it, then what is this... wait. Look at the monster's ruptured stomach lining. What is that trapped inside the biological tissue?",
      side: 'left',
    },
    {
      speaker: 'Hidden Researcher 1',
      text: 'Is that... a fossilized bone structure? No, look at the fur pattern. That animal is completely native to the tropical rainforest regions thousands of miles south!',
      side: 'right',
    },
    {
      speaker: hero,
      text: 'A tropical creature preserved inside a sub-zero arctic mutation... This means the virus didn\'t originate in the north. The hive network spans across the entire globe.',
      side: 'left',
    },
    {
      speaker: hero,
      text: 'Change of plans, team. Seal this lab. We are heading south to the equator. We need to find the primeval nesting grounds.',
      side: 'left',
    },
  ]
}

/**
 * Ending cinematic: the closing dialogue over the wrecked arena, then a crawl
 * that fades to black and hands back to the menu.
 */
export function playOutro(id: CharacterId, boss: BossKind, onDone: () => void) {
  // The Leviathan hands straight back to the chapter board after its last line.
  if (boss === 'canopy-leviathan') {
    runDialogue(id, leviathanOutroDialogue(id), true, onDone)
    return
  }
  // The Colossus ends on the UFO reveal, then the chapter 4 crawl.
  if (boss === 'rust-colossus') {
    runDialogue(id, colossusOutroDialogue(id), true, () => playCredits('chapter4', onDone))
    return
  }
  const chapter2 = boss === 'cryo-stalker'
  const lines = chapter2 ? cryoOutroDialogue(id) : outroDialogue(id)
  runDialogue(id, lines, true, () =>
    playCredits(chapter2 ? 'chapter2' : 'chapter1', onDone)
  )
}

/** Red slam flash used when a cutscene is interrupted mid-sentence. */
function flashDanger() {
  const host = document.querySelector('#app')
  if (!host) return
  const flash = document.createElement('div')
  flash.className = 'pointer-events-none absolute inset-0 z-50 bg-red-600'
  host.appendChild(flash)
  const anim = flash.animate(
    [{ opacity: 0.85 }, { opacity: 0.25 }, { opacity: 0 }],
    { duration: 700, easing: 'ease-out' }
  )
  anim.onfinish = () => flash.remove()
  playSfx('explosion')
  playSfx('boss-roar')
}

function playCredits(chapter: keyof typeof CREDIT_LINES, onDone: () => void) {
  const { credits } = panelsReady()
  show(credits, true, 'block')
  const crawl = document.getElementById('credits-crawl')
  if (!crawl) throw new Error('credits markup missing')
  crawl.innerHTML = CREDIT_LINES[chapter]
    .map((l) => `<p class="mb-10 text-3xl font-black leading-relaxed text-white">${l}</p>`)
    .join('')
  crawl.animate([{ transform: 'translateY(100vh)' }, { transform: 'translateY(-40vh)' }], {
    duration: CREDIT_DURATION,
    easing: 'linear',
    fill: 'forwards',
  })
  window.setTimeout(() => {
    show(credits, false, 'block')
    stopMusic()
    onDone()
  }, CREDIT_DURATION)
}

/** Typewriter dialogue before the finale; resolves when the last line is read. */
export function playBossDialogue(id: CharacterId, boss: BossKind, onDone: () => void) {
  runDialogue(id, bossDialogue(id, boss), false, onDone)
}

/**
 * Drives one typewriter dialogue. `overlay` keeps the arena visible behind a
 * dimmed panel instead of covering it with the solid cutscene background.
 */
function runDialogue(id: CharacterId, lines: Line[], overlay: boolean, onDone: () => void) {
  resumeAudio()
  playMusic('story')
  const { dialogue } = panelsReady()
  dialogue.className = `absolute inset-0 z-40 hidden cursor-pointer flex-col justify-end p-8 ${
    overlay ? 'bg-slate-950/60' : 'bg-slate-950/95'
  }`
  // Radio voices during the outro: no survivor sprites on screen.
  document.getElementById('cutscene-survivor-group')?.classList.toggle('hidden', overlay)
  const speakerEl = document.getElementById('cutscene-speaker')
  const textEl = document.getElementById('cutscene-text')
  const nameEl = document.getElementById('cutscene-portrait-name')
  if (!speakerEl || !textEl || !nameEl) throw new Error('dialogue cutscene markup missing')
  const body: HTMLElement = textEl
  const speaker: HTMLElement = speakerEl

  show(dialogue, true, 'flex')
  drawPortrait(id)
  drawSurvivors()
  nameEl.textContent = characterById(id).name

  let index = 0
  let typed = 0
  let timer: number | null = null

  const stopTyping = () => {
    if (timer !== null) window.clearInterval(timer)
    timer = null
  }

  const finish = () => {
    stopTyping()
    dialogue.removeEventListener('click', advance)
    show(dialogue, false, 'flex')
    stopMusic()
    onDone()
  }

  const type = () => {
    const line = lines[index]
    if (line.flash) {
      flashDanger()
      // The camp and its guards are gone the moment the slam lands.
      document.getElementById('cutscene-survivor-group')?.classList.add('hidden')
    }
    if (line.art) {
      document.getElementById('cutscene-survivor-group')?.classList.remove('hidden')
      drawScene(line.art)
    }
    speaker.textContent = line.speaker
    speaker.className = `text-sm font-black uppercase tracking-widest ${
      line.side === 'left'
        ? 'text-emerald-300'
        : line.side === 'system'
          ? 'text-yellow-300'
          : 'text-sky-300'
    }`
    body.className =
      line.side === 'system'
        ? 'mt-2 min-h-[72px] font-mono text-lg leading-relaxed text-yellow-300 [text-shadow:0_0_12px_rgba(250,204,21,0.9)]'
        : 'mt-2 min-h-[72px] text-lg leading-relaxed text-slate-100'
    typed = 0
    body.textContent = ''
    stopTyping()
    timer = window.setInterval(() => {
      typed += 1
      body.textContent = line.text.slice(0, typed)
      if (typed % 2 === 0) playSfx('type')
      if (typed >= line.text.length) stopTyping()
    }, TYPE_SPEED)
  }

  function advance() {
    const line = lines[index]
    if (typed < line.text.length) {
      // First click completes the line instead of skipping it.
      stopTyping()
      typed = line.text.length
      body.textContent = line.text
      return
    }
    index += 1
    if (index >= lines.length) {
      finish()
      return
    }
    type()
  }

  dialogue.addEventListener('click', advance)
  type()
}
