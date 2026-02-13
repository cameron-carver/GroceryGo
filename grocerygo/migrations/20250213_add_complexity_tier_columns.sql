ALTER TABLE meal_plans
  ADD COLUMN IF NOT EXISTS week_score_id UUID REFERENCES week_scores(id) ON DELETE SET NULL;

ALTER TABLE meal_plan_recipes
  ADD COLUMN IF NOT EXISTS complexity_tier TEXT
  CHECK (complexity_tier IS NULL OR complexity_tier IN ('quick', 'standard', 'exploratory'));
