import { describe, it, expect } from 'vitest'
import type { GroceryItem } from '@/types/database'
import type { LineItem } from '@/types/instacart'

describe('Instacart flow compatibility', () => {
  it('grocery items with category field convert to valid Instacart line items', () => {
    const groceryItem: GroceryItem = {
      id: 'gi-1',
      meal_plan_id: 'mp-1',
      item_name: 'Salmon fillet',
      quantity: 1,
      unit: 'lb',
      category: 'Seafood',
      estimated_price: 12.99,
      purchased: false,
    }

    const lineItem: LineItem = {
      name: groceryItem.item_name,
      quantity: groceryItem.quantity ?? 1,
      unit: groceryItem.unit ?? 'each',
      display_text: `${groceryItem.quantity ?? 1} ${groceryItem.unit ?? 'each'} ${groceryItem.item_name}`,
      line_item_measurements: [
        { quantity: groceryItem.quantity ?? 1, unit: groceryItem.unit ?? 'each' },
      ],
      filters: { brand_filters: [], health_filters: [] },
    }

    expect(lineItem.name).toBe('Salmon fillet')
    expect(lineItem.quantity).toBe(1)
    expect(lineItem.unit).toBe('lb')
  })

  it('grocery items without category still work', () => {
    const groceryItem: GroceryItem = {
      id: 'gi-2',
      meal_plan_id: 'mp-1',
      item_name: 'Rice',
      quantity: 2,
      unit: 'cups',
      purchased: false,
    }

    const lineItem: LineItem = {
      name: groceryItem.item_name,
      quantity: groceryItem.quantity ?? 1,
      unit: groceryItem.unit ?? 'each',
      display_text: `${groceryItem.quantity ?? 1} ${groceryItem.unit ?? 'each'} ${groceryItem.item_name}`,
      line_item_measurements: [
        { quantity: groceryItem.quantity ?? 1, unit: groceryItem.unit ?? 'each' },
      ],
      filters: { brand_filters: [], health_filters: [] },
    }

    expect(lineItem.name).toBe('Rice')
  })
})
