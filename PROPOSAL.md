# gym-app — Proposal

**An AI workout companion that reshapes the screen to the set you're on — not another logger.**

## The bet
Workout *tracking* is solved and commoditized (Hevy, Strong, JEFIT). The unmet need is
**in-the-moment guidance** — what to do, how to do it, what to change — without leaving the
rack to read a wiki or poke a spreadsheet. Every "AI fitness" app today bolts a chatbot onto
a static tracker. We invert it: **the AI drives the interface itself**, and it runs on
hardware you own.

## Product
Mobile-first (Expo / React Native, one codebase → iOS / Android / web). A solid tracker is
the floor; an AI layer (a) understands plain language and (b) generates the right UI for the
moment — step-by-step form cues, adaptive rest/coaching prompts, surfaced quick-actions.
Defaults to **local Ollama**, flips to **Claude** or **ChatGPT** per user.

It **grows with you**: the same engine adapts its surface from beginner (form cues, "you
skipped legs") to advanced (volume landmarks, muscle-balance analysis), so it never feels too
basic or too much. Because of athlete memory, it knows which mode you're in.

## Why it's defensible — the model is never the moat
Anyone can call an LLM. Durable advantage comes from accumulated context, cost structure, and
data asymmetry. **Thesis: easy to enter, learned-in to stay, and an AI you can afford to run
constantly because it's yours.**

- **Athlete memory** — a profile the AI builds about *you*: injuries, which cues land, your
  RPE→weight calibration, equipment, goals. Compounds daily; a competitor can't replicate it
  on day one.
- **Lavish local compute** — zero marginal AI cost means we regenerate UI per set and coach
  continuously — an experience SaaS unit economics can't match. Privacy is the trust half of
  the same advantage.
- **Import anything** — bring a whole training life in: Notes text *(working)*, Hevy/Strong
  CSV, a photo of a gym whiteboard, a PDF coach program. Easy-in + memory = asymmetric
  switching costs (cheap to enter, costly to leave).
- **Personal calibration + recovery** — predictions sharpen per-user (true working weights,
  recovery rate, form quirks); readiness inferred from your own in-app usage timing.
- **Voice companion** — talk to it: a spoken pre-session check-in ("shoulder's tight, going
  lighter") and hands-free logging mid-set.

## Working today
873-exercise tracker deployed to phone · pluggable AI provider layer (Ollama / Claude /
per-user) · natural-language set logging · full multi-day routine import from notes.

## Next
The generative **in-session companion** + **athlete memory** — the real differentiator.
Tier-3 bets roadmap'd: wearable/recovery fusion, open/self-hostable
homelab-native ecosystem.

*Not the moat (table stakes): the public exercise DB, the tracker UI, generic AI chat,
one-shot generated programs.*
