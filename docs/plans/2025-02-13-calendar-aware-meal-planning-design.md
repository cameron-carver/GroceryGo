# Calendar-Aware Meal Planning — Design Document

## Overview

Integrate Google Calendar and Apple Calendar into GroceryGo so that meal plans adapt to the user's actual week. Busy days get quick meals; light days get elaborate or exploratory ones. A single grocery trip is timed to balance calendar availability with ingredient freshness.

The goal: lower the bar for health and nutrition by making food fit into life rather than competing with it.

## Architecture: Calendar-First Pipeline (Approach A)

Calendar analysis runs as a distinct pipeline stage before meal plan generation. The flow:

Connect Calendar → Fetch Events → Score Week → Interactive Preview → User Adjusts → Generate Meal Plan

Calendar logic is fully decoupled from meal planning. The generation flow receives enriched input (per-day complexity tiers) but is otherwise unchanged.

---

## Section 1: Calendar Provider Abstraction

### Interface

```typescript
interface CalendarProvider {
  authenticate(userId: string): Promise<OAuthTokens>;
  fetchEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]>;
  revokeAccess(userId: string): Promise<void>;
}

interface CalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  source: 'google' | 'apple';
  metadata: {
    location?: string;
    description?: string;
    recurrence?: string;
  };
}
```

### Implementations

- **GoogleCalendarProvider** — Google Calendar REST API v3, OAuth2 with `calendar.readonly` scope.
- **AppleCalendarProvider** — CalDAV protocol against iCloud, app-specific password or iCloud OAuth.

### Key Decisions

- **Tokens stored in `calendar_connections` table**, encrypted at rest.
- **Events fetched on-demand**, not synced. Raw events are ephemeral — only computed scores are persisted. Avoids sync complexity and stale data.
- **Users can connect one or both providers.** Events merge into a single stream before scoring.

### Location

`src/services/calendarService.ts` — abstraction + provider implementations.

---

## Section 2: Pluggable Scoring Engine

### Interface

```typescript
interface ScoreSignal {
  name: string;
  weight: number; // 0-1
  compute(events: CalendarEvent[], date: Date): SignalResult;
}

interface SignalResult {
  score: number;       // 0-100, higher = more stressful
  reasoning: string;   // human-readable explanation
  rawData: Record<string, any>; // for backtesting
}

interface DayScore {
  date: Date;
  finalScore: number;  // weighted composite, 0-100
  tier: 'quick' | 'standard' | 'exploratory';
  signalBreakdown: SignalResult[];
}
```

### DayScoreEngine

- Composes multiple `ScoreSignal` providers.
- `scoreDay(events, date) → DayScore`
- `scoreWeek(events, startDate) → DayScore[]`

### Tier Thresholds (configurable)

| Score Range | Tier | Meaning |
|---|---|---|
| 0-35 | Exploratory | Light day — time for culinary exploration |
| 36-65 | Standard | Normal day — solid home cooking |
| 66-100 | Quick | Packed day — fast, minimal effort |

### V1 Signal: Time-Block Analysis

Factors:
- Total committed hours in the day
- Largest free block available (a day with meetings but a 3-hour evening gap differs from wall-to-wall)
- Back-to-back event density (consecutive meetings = more draining than spread-out ones)
- Event timing relative to meal windows (meetings over lunch or during dinner prep time penalize harder)

### Extensibility

Adding a new signal (AI event-title inference, user calibration, etc.) means implementing `ScoreSignal` and registering it with the engine. No refactoring of existing code.

### Storage

Raw signal breakdowns are persisted in `week_scores` alongside the final scores. This enables backtesting new signals against historical weeks.

### Location

`src/services/scoringEngine.ts`

---

## Section 3: Interactive Week Preview

### Route

`src/app/week-preview/page.tsx`

### Layout

A 7-day row (Mon-Sun). Each day shows:
- Day name + date
- The assigned tier as a clear label (Quick / Standard / Exploratory)
- Condensed reasoning (e.g., "6hrs meetings, free after 6pm")
- Visual treatment that makes tiers immediately scannable (light days feel open, heavy days feel compact)
- Stress score shown subtly — the tier label is the primary signal

### Interactivity

- Click a day to override its tier (e.g., "Tuesday looks busy but my afternoon meeting always cancels")
- Overrides are visually distinct from system suggestions
- "Looks good, generate plan" button passes the final tier map into generation

### Data Flow

1. User arrives → fetch events from connected calendar(s) for target week
2. Scoring engine produces 7 DayScores
3. Preview renders with system-suggested tiers
4. User adjusts any days
5. On confirm → `week_scores` saved (with user adjustments) → redirect to `meal-plan-generate` with tier constraints

### Connection to Existing Generation

The AI prompt in `/api/generate-meal-plan/route.ts` gets extended with a `dayComplexityMap`:

```typescript
{ monday: 'quick', tuesday: 'exploratory', wednesday: 'standard', ... }
```

The prompt uses this to constrain recipe difficulty and prep time per day. Existing Zod schemas extended to validate this input.

### Navigation Flow

Dashboard → Connect Calendar (one-time) → Week Preview → Generate Plan

---

## Section 4: Grocery Pickup Optimizer

### Logic

Recommends the best single day for a grocery trip. Two factors:

**Calendar availability (60% weight):**
- Favors days with low stress scores and large free time blocks
- Penalizes days where free time is only early morning or late night

**Freshness optimization (40% weight):**
- Categorizes ingredients by shelf life:
  - Short-lived (1-3 days): fresh herbs, berries, fish
  - Medium (4-6 days): most produce, poultry
  - Long-lived (7+ days): pantry staples, root vegetables, frozen items
- Picks the day that minimizes waste: minimize the gap between shopping day and the latest perishable-ingredient meal, while still being before those meals

### Shelf Life Data

Static TypeScript file: `src/data/ingredientShelfLife.ts`. Maps ingredient categories to approximate fridge life in days. Unknown ingredients default to "medium."

### Category Normalization

The shelf life lookup keys off `grocery_items.category`. To ensure consistency:
- The AI generation prompt constrains categories to a known enum
- Zod validation enforces the enum on AI output
- Fallback: unmatched categories default to "medium" shelf life

### Where It Surfaces

On the week preview screen, after tier assignment: "Best day to shop: Wednesday — your afternoon is free and your salmon stays fresh for Thursday." User can dismiss or accept.

### Testing Requirements

- **Integration tests** for the pickup optimizer (given meal plan + calendar scores → correct day recommendation)
- **Instacart flow tests** — verify link generation, caching, and order creation work identically with or without `recommended_pickup_day`
- **Frontend tests** — pickup suggestion UI does not interfere with existing "Order with Instacart" button flow

### Location

`src/services/pickupOptimizer.ts`

---

## Section 5: Data Schema

### New Tables

```sql
-- Calendar OAuth connections
CREATE TABLE calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  access_token TEXT NOT NULL,  -- encrypted
  refresh_token TEXT,          -- encrypted
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_fetched_at TIMESTAMPTZ,
  UNIQUE(user_id, provider)
);

-- Weekly stress scores and pickup recommendations
CREATE TABLE week_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  week_of DATE NOT NULL,
  day_scores JSONB NOT NULL,           -- array of 7 DayScore objects
  user_adjustments JSONB,              -- tier overrides keyed by day
  provider_version TEXT NOT NULL,      -- tracks which signals were active
  recommended_pickup_day TEXT,         -- day name
  pickup_reasoning TEXT,
  meal_plan_id UUID REFERENCES meal_plans(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Extended Existing Tables

```sql
-- Link meal plans to the week score that informed them
ALTER TABLE meal_plans ADD COLUMN week_score_id UUID REFERENCES week_scores(id);

-- Track what tier each recipe was selected for
ALTER TABLE meal_plan_recipes ADD COLUMN complexity_tier TEXT
  CHECK (complexity_tier IN ('quick', 'standard', 'exploratory'));
```

### Unchanged Tables

`recipes`, `users`, `grocery_items`, `saved_recipes`, `meal_plan_feedback` — no modifications.

### Shelf Life Reference Data

Static file at `src/data/ingredientShelfLife.ts` rather than a DB table. Reference data that changes rarely and doesn't need to be user-editable.

---

## Future Extensions (Not in v1)

- Additional score signals: AI-inferred event stress from titles, user feedback calibration
- Calendar write-back: block cooking time, add pickup reminders
- Split grocery orders when perishability demands it
- Instacart delivery window cross-referencing
- Continuous complexity scale instead of 3 tiers
