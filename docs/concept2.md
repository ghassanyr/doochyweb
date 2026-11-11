# Doochy Learn - Concept Anchor

**Status:** stable idea. If a later decision contradicts this document, resolve it here first
so we do not drift.

**Working name:** Doochy Learn
**Location:** `learn.doochy.net`, served from this repo (doochyweb), free to use.

---

## What it is

A free, browser-based **chart-reading trainer**. It shows a real historical chart up to a
cut bar, asks a structured question about it, then reveals what actually happened and the
setup's historical base rate.

It is **not** a signal service, not a trading bot, and involves no real money. Educational
only.

## Why it exists

Most chart trainers collapse recognition, prediction and execution into a single up/down
guess. That teaches superstition. This trainer separates them and trains **calibration**
against **honest base rates**.

## Core loop

1. Show 60–120 anonymized candles ending at cut bar `T`.
2. Ask a structured question.
3. Reveal the future bars, annotations, MFE/MAE, the base rate, and a short "why".
4. Review: your answer vs the base rate / crowd; the same tag appears again later
   (spaced repetition by concept, never by exact chart).

## Question types

Recognition is separated from prediction:

- **Identification:** what pattern is this?
- **Validity:** valid / near-miss / noise?
- **Direction:** up / down / no-trade.
- **Probability:** chance the upper barrier is hit first.
- **Trade plan:** entry, stop, target; graded in R multiples.

## Labeling

**Triple-barrier** (López de Prado style). At cut bar `T`:

- Upper barrier: `+k × ATR`
- Lower barrier: `−k × ATR`
- Time barrier: `H` bars

The label is whichever barrier is hit first: **up / down / scratch (timeout)**. Store
**MFE/MAE** for richer feedback. ATR normalization makes items comparable across assets and
gives a natural "no-trade" class.

## Data and content

- **Real historical OHLCV is the backbone.** No synthetic main content.
- An **algorithm detects candidate instances** from history.
- A **human curates** the candidates through a **CLI + CSV** workflow: confirm/reject the
  tag, pick the cut bar, set key levels, rate ambiguity.
- The **human never decides the outcome** - the market already did, and it is computed
  mechanically. This preserves honest base rates.
- **Negative controls** (random walk / shuffled returns) and flips/jitter augmentation are
  **deferred** to a later phase.
- Anonymize: hide symbol, date and absolute price; normalize the y-axis to % / index 100;
  render vector candles client-side.

## Honesty and ethics

- Always show base rates and frame patterns as probabilistic edges that may not survive
  costs.
- Score skill against the baseline; prefer calibration over raw accuracy; never imply a
  small sample is a proven edge.
- No loss-framed streaks, loot-box mechanics, or real-money prizes.
- Clear educational disclaimers. No signals. No automated trading.

## Scope now

- **Free only.** Paid/pro is deferred.
- **CLI + CSV** review workflow first; a polished labeling UI comes later.
- Reuse doochyweb's market layer (providers, indicators, patterns, breakout engine,
  Mongo/JWT, React/Tailwind design system).

## Non-goals (for now)

- Placebos / negative controls
- Live market challenges, multiplayer, WebSocket
- Native mobile app
- Automated trading or signal generation
- Monetization

## Working mode

An **overseer agent** writes prompts; a **worker agent** executes them in the repo. The
overseer reviews each delivered phase. Every phase ends with tests/typecheck and a review
checkpoint before the next begins.

## Success looks like

A user can run a daily drill of anonymized, real historical setups, answer a probability
question, see the realized outcome plus the base rate, and track whether their stated
confidence is honest over time.
