export type ShelfLifeCategory = 'short' | 'medium' | 'long'

export interface ShelfLifeEntry {
  category: ShelfLifeCategory
  minDays: number
  maxDays: number
}

const SHELF_LIFE: Record<string, ShelfLifeEntry> = {
  'Fresh Herbs': { category: 'short', minDays: 1, maxDays: 3 },
  'Berries': { category: 'short', minDays: 1, maxDays: 3 },
  'Seafood': { category: 'short', minDays: 1, maxDays: 2 },
  'Fish': { category: 'short', minDays: 1, maxDays: 2 },
  'Leafy Greens': { category: 'short', minDays: 2, maxDays: 4 },
  'Fresh Produce': { category: 'medium', minDays: 4, maxDays: 6 },
  'Produce': { category: 'medium', minDays: 4, maxDays: 6 },
  'Fruits': { category: 'medium', minDays: 3, maxDays: 5 },
  'Vegetables': { category: 'medium', minDays: 4, maxDays: 6 },
  'Dairy': { category: 'medium', minDays: 5, maxDays: 7 },
  'Eggs': { category: 'medium', minDays: 7, maxDays: 14 },
  'Poultry': { category: 'medium', minDays: 1, maxDays: 3 },
  'Meat': { category: 'medium', minDays: 2, maxDays: 4 },
  'Deli': { category: 'medium', minDays: 3, maxDays: 5 },
  'Bakery': { category: 'medium', minDays: 3, maxDays: 5 },
  'Bread': { category: 'medium', minDays: 3, maxDays: 5 },
  'Pantry': { category: 'long', minDays: 30, maxDays: 365 },
  'Canned Goods': { category: 'long', minDays: 30, maxDays: 365 },
  'Grains': { category: 'long', minDays: 30, maxDays: 180 },
  'Pasta': { category: 'long', minDays: 30, maxDays: 365 },
  'Rice': { category: 'long', minDays: 30, maxDays: 365 },
  'Spices': { category: 'long', minDays: 90, maxDays: 365 },
  'Condiments': { category: 'long', minDays: 30, maxDays: 180 },
  'Oils': { category: 'long', minDays: 30, maxDays: 180 },
  'Frozen': { category: 'long', minDays: 30, maxDays: 180 },
  'Snacks': { category: 'long', minDays: 14, maxDays: 90 },
  'Beverages': { category: 'long', minDays: 14, maxDays: 90 },
  'Nuts': { category: 'long', minDays: 14, maxDays: 60 },
  'Baking': { category: 'long', minDays: 30, maxDays: 365 },
}

const DEFAULT_SHELF_LIFE: ShelfLifeEntry = {
  category: 'medium',
  minDays: 4,
  maxDays: 6,
}

export function getShelfLife(category: string): ShelfLifeEntry {
  return SHELF_LIFE[category] ?? DEFAULT_SHELF_LIFE
}

export const GROCERY_CATEGORIES = Object.keys(SHELF_LIFE)
