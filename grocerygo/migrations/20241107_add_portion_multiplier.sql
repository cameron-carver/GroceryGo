-- Adds duplication metadata for meal plan recipe slots
ALTER TABLE meal_plan_recipes
  ADD COLUMN IF NOT EXISTS portion_multiplier INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS slot_label TEXT;

COMMENT ON COLUMN meal_plan_recipes.portion_multiplier IS 'Number of portions allocated from the base recipe for this scheduled slot';
COMMENT ON COLUMN meal_plan_recipes.slot_label IS 'Human-friendly label describing the scheduled meal slot (e.g., "Tuesday Lunch")';

