import { z } from 'zod';
import { confidenceSchema, dataSourceSchema, uuidSchema } from './common';

export const mealTypeSchema = z.enum([
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'other',
]);
export type MealType = z.infer<typeof mealTypeSchema>;

export const mealItemInputSchema = z.object({
  itemName: z.string().min(1).max(200),
  estimatedCarbsG: z.number().min(0).max(1000).optional(),
  estimatedProteinG: z.number().min(0).max(1000).optional(),
  estimatedFatG: z.number().min(0).max(1000).optional(),
  estimatedFiberG: z.number().min(0).max(1000).optional(),
  portionText: z.string().max(200).optional(),
  // Hand-estimated macros are guesses. The default says so.
  confidence: confidenceSchema.default(0.5),
});
export type MealItemInput = z.infer<typeof mealItemInputSchema>;

export const createMealSchema = z.object({
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  mealType: mealTypeSchema.optional(),
  description: z.string().max(2000).optional(),
  photoObjectKey: z.string().max(500).optional(),
  source: dataSourceSchema.default('manual'),
  confidence: confidenceSchema.default(1.0),
  items: z.array(mealItemInputSchema).max(50).default([]),
});
export type CreateMealInput = z.infer<typeof createMealSchema>;

export const mealItemSchema = mealItemInputSchema.extend({
  id: uuidSchema,
  mealId: uuidSchema,
});
export type MealItem = z.infer<typeof mealItemSchema>;

export const mealSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  mealType: mealTypeSchema.nullable(),
  description: z.string().nullable(),
  photoObjectKey: z.string().nullable(),
  /** Short-lived signed URL, present only when a photo exists. */
  photoUrl: z.string().url().nullable().optional(),
  source: dataSourceSchema,
  confidence: confidenceSchema,
  createdAt: z.coerce.date(),
  items: z.array(mealItemSchema).default([]),
});
export type Meal = z.infer<typeof mealSchema>;
