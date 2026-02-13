CREATE TABLE IF NOT EXISTS week_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  day_scores JSONB NOT NULL,
  user_adjustments JSONB,
  provider_version TEXT NOT NULL DEFAULT 'v1-time-block',
  recommended_pickup_day TEXT,
  pickup_reasoning TEXT,
  meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE week_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own week scores"
  ON week_scores FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_week_scores_user_week ON week_scores(user_id, week_of);
