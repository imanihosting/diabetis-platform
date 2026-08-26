import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateMealInput, Meal } from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class MealsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, input: CreateMealInput): Promise<Meal> {
    // A photo key is supplied by the client after upload; make sure it is one
    // of *this* user's keys before we persist it against their record.
    if (input.photoObjectKey && !this.storage.assertOwnedBy(input.photoObjectKey, userId)) {
      throw new ForbiddenException('Photo key does not belong to this user');
    }

    return this.db.transaction(async (client) => {
      const { rows } = await client.query<MealRow>(
        `insert into nutrition.meals
           (user_id, started_at, ended_at, meal_type, description,
            photo_object_key, source, confidence)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning *`,
        [
          userId,
          input.startedAt,
          input.endedAt ?? null,
          input.mealType ?? null,
          input.description ?? null,
          input.photoObjectKey ?? null,
          input.source,
          input.confidence,
        ],
      );
      const meal = rows[0];

      const items: MealItemRow[] = [];
      for (const item of input.items) {
        const inserted = await client.query<MealItemRow>(
          `insert into nutrition.meal_items
             (meal_id, item_name, estimated_carbs_g, estimated_protein_g,
              estimated_fat_g, estimated_fiber_g, portion_text, confidence)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning *`,
          [
            meal.id,
            item.itemName,
            item.estimatedCarbsG ?? null,
            item.estimatedProteinG ?? null,
            item.estimatedFatG ?? null,
            item.estimatedFiberG ?? null,
            item.portionText ?? null,
            item.confidence,
          ],
        );
        items.push(inserted.rows[0]);
      }

      // A meal is also a timeline event — the timeline is the product primitive,
      // so writing to it is part of the same transaction, not a later sync.
      await client.query(
        `insert into metabolic.events
           (user_id, occurred_at, event_type, source, confidence, payload)
         values ($1, $2, 'meal_started', $3, $4, $5)`,
        [
          userId,
          input.startedAt,
          input.source,
          input.confidence,
          JSON.stringify({
            mealId: meal.id,
            mealType: input.mealType ?? null,
            description: input.description ?? null,
            itemCount: items.length,
          }),
        ],
      );

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'meal.create',
          resourceType: 'meal',
          resourceId: meal.id,
        },
        client,
      );

      return toMeal(meal, items);
    });
  }

  async list(userId: string, from: Date, to: Date, limit = 200): Promise<Meal[]> {
    const meals = await this.db.query<MealRow>(
      `select * from nutrition.meals
        where user_id = $1 and started_at between $2 and $3
        order by started_at desc
        limit $4`,
      [userId, from, to, limit],
    );
    if (meals.length === 0) return [];

    const items = await this.db.query<MealItemRow>(
      `select * from nutrition.meal_items where meal_id = any($1::uuid[])`,
      [meals.map((m) => m.id)],
    );

    const byMeal = new Map<string, MealItemRow[]>();
    for (const item of items) {
      const list = byMeal.get(item.meal_id) ?? [];
      list.push(item);
      byMeal.set(item.meal_id, list);
    }

    return meals.map((m) => toMeal(m, byMeal.get(m.id) ?? []));
  }

  async findOne(userId: string, mealId: string): Promise<Meal> {
    const meal = await this.db.queryOne<MealRow>(
      'select * from nutrition.meals where id = $1 and user_id = $2',
      [mealId, userId],
    );
    if (!meal) throw new NotFoundException('Meal not found');

    const items = await this.db.query<MealItemRow>(
      'select * from nutrition.meal_items where meal_id = $1',
      [mealId],
    );

    const result = toMeal(meal, items);
    if (meal.photo_object_key) {
      result.photoUrl = await this.storage.signedDownloadUrl(meal.photo_object_key);
    }
    return result;
  }
}

interface MealRow {
  id: string;
  user_id: string;
  started_at: Date;
  ended_at: Date | null;
  meal_type: Meal['mealType'];
  description: string | null;
  photo_object_key: string | null;
  source: Meal['source'];
  confidence: string;
  created_at: Date;
}

interface MealItemRow {
  id: string;
  meal_id: string;
  item_name: string;
  estimated_carbs_g: string | null;
  estimated_protein_g: string | null;
  estimated_fat_g: string | null;
  estimated_fiber_g: string | null;
  portion_text: string | null;
  confidence: string;
}

function toMeal(row: MealRow, items: MealItemRow[]): Meal {
  return {
    id: row.id,
    userId: row.user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    mealType: row.meal_type,
    description: row.description,
    photoObjectKey: row.photo_object_key,
    photoUrl: null,
    source: row.source,
    confidence: Number(row.confidence),
    createdAt: row.created_at,
    items: items.map((i) => ({
      id: i.id,
      mealId: i.meal_id,
      itemName: i.item_name,
      estimatedCarbsG: numeric(i.estimated_carbs_g),
      estimatedProteinG: numeric(i.estimated_protein_g),
      estimatedFatG: numeric(i.estimated_fat_g),
      estimatedFiberG: numeric(i.estimated_fiber_g),
      portionText: i.portion_text ?? undefined,
      confidence: Number(i.confidence),
    })),
  };
}

/** Postgres `numeric` arrives as a string to preserve precision. */
function numeric(value: string | null): number | undefined {
  return value === null ? undefined : Number(value);
}
