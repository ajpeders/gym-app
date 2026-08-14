# Calorie and Protein Tracker Design

## Outcome

Add a lightweight nutrition layer focused on daily calories and protein. It should connect to the athlete's bodyweight, goal weight, workouts, progress photos, and the existing Sunday-through-Saturday calendar without turning the app into a full meal-planning product.

The first release should make logging fast enough to use every day. Barcode scanning, micronutrients, recipes, and a large third-party food catalog can follow after the core flow is proven.

## Product principles

- Track calories and protein first; carbs, fat, and micronutrients are later additions.
- Keep Expo native and web on the same route and component tree.
- Do not add another bottom-navigation item. Nutrition is reached from Home and the calendar.
- Treat protein as a minimum target and calories as a budget.
- Display over-target days neutrally instead of using punitive warning UI.
- Let users edit every suggested target and every parsed food entry.
- Never let AI silently invent nutrition values or write entries without review.
- Use Sunday through Saturday for all weekly summaries.

## Core experience

### Home

Add a compact **Nutrition today** card containing:

- Calories consumed, daily target, and remaining amount.
- Protein consumed, daily target, and remaining amount.
- Two clear progress bars.
- A **Quick add** action.
- A card press target that opens the full nutrition day.

Example:

```text
Nutrition today
Calories   1,420 / 2,200   780 left
Protein      118 / 170 g    52 g left
[Quick add]
```

### Nutrition day

The full nutrition screen should include:

- A Sunday-through-Saturday date strip.
- Calorie and protein progress at the top.
- Entries grouped into Breakfast, Lunch, Dinner, and Snacks.
- Add, edit, duplicate, and delete actions.
- Recent and frequently logged foods.
- Copy entries from a previous day.
- Logging for past, current, and future dates.

### Calendar integration

Selecting a date should ultimately lead to one combined daily view containing:

- Planned or completed workout.
- Calories and protein.
- Bodyweight.
- Progress photos.
- Daily notes.

This keeps workout adherence, nutrition adherence, and physical progress connected instead of spreading them across unrelated screens.

## Logging flow

The initial add sheet should prioritize speed and contain:

- Food or meal name.
- Calories.
- Protein in grams.
- Serving quantity.
- Meal group.
- Date.
- Optional notes.
- Option to save as a reusable food.

Examples:

```text
Chicken breast - 280 calories - 52 g protein
Protein shake - 220 calories - 35 g protein
Dinner - 740 calories - 48 g protein
```

Users should be able to reuse recent or saved foods with one tap and adjust the serving before saving.

## Targets and athlete profile

Nutrition setup should support:

- Manual calorie target.
- Manual protein target.
- Optional suggested targets.
- Goal direction: lose, maintain, or gain.
- Optional workout-day and rest-day targets in a later iteration.

`BodyMetric` remains the source of truth for weight history. The most recent weight may be mirrored into `AthleteProfile.current_weight` for Home and coach context. `AthleteProfile.goal_weight` remains the long-term goal.

A suggested calorie target requires additional inputs such as age, activity level, and desired rate of change. Suggested values must always be clearly labeled and editable.

## Data model

### NutritionGoal

- `id`
- `owner_id`
- `calorie_target`
- `protein_target_g`
- `workout_calorie_target` (optional, later)
- `workout_protein_target_g` (optional, later)
- `rest_calorie_target` (optional, later)
- `rest_protein_target_g` (optional, later)
- `effective_from`
- `created_at`
- `updated_at`

Keeping dated goals allows historical days to retain the target that was active at the time.

### NutritionEntry

- `id`
- `owner_id`
- `local_date`
- `meal` (`breakfast`, `lunch`, `dinner`, `snack`)
- `name`
- `calories`
- `protein_g`
- `servings`
- `notes`
- `source` (`manual`, `saved`, `copied`, `ai`, `imported`)
- `created_at`
- `updated_at`

Use an explicit `local_date` rather than deriving the nutrition day from a UTC timestamp. This prevents entries from moving to another day because of timezone conversions.

### SavedFood

- `id`
- `owner_id`
- `name`
- `default_calories`
- `default_protein_g`
- `default_serving`
- `default_meal` (optional)
- `last_used_at`
- `use_count`
- `created_at`
- `updated_at`

Saved foods are user-owned and should never alter a shared nutrition catalog.

## API surface

Initial endpoints:

```text
GET    /nutrition/day?date=YYYY-MM-DD
GET    /nutrition/summary?start=YYYY-MM-DD&end=YYYY-MM-DD
POST   /nutrition/entries
PATCH  /nutrition/entries/{id}
DELETE /nutrition/entries/{id}
POST   /nutrition/entries/copy-day
GET    /nutrition/goals
PUT    /nutrition/goals
GET    /nutrition/saved-foods
POST   /nutrition/saved-foods
PATCH  /nutrition/saved-foods/{id}
DELETE /nutrition/saved-foods/{id}
```

Every endpoint must enforce per-owner scoping.

## Weekly progress

Weekly summaries should show:

- Average daily calories.
- Average daily protein.
- Number of days the protein target was reached.
- Weight trend.
- Workout completion.

Weekly averages matter more than requiring every individual day to be perfect.

## AI-assisted logging

After manual logging and saved foods are stable, add a natural-language input such as:

```text
2 eggs, toast, and a protein shake
```

The AI produces an editable preview containing food names, servings, calories, and protein. The user must confirm or correct the preview before anything is saved.

AI values should come from a known food record when possible. Uncertain estimates must be marked as estimates. The raw user text can be retained on the entry for later correction.

## Offline behavior

Nutrition entries should use the same offline-first philosophy as set logging:

- Write locally first.
- Show the entry immediately.
- Queue create, edit, and delete operations.
- Sync on connectivity return and app foreground.
- Keep stable client-generated IDs to avoid duplicate entries after retries.

## Delivery phases

### Phase 1 - Foundation

- Add nutrition models and additive migrations.
- Add per-owner CRUD endpoints and date-based summaries.
- Add frontend API types and methods.
- Add target setup with manual calorie and protein goals.

### Phase 2 - Daily logging

- Build the nutrition day screen.
- Add manual entry, edit, duplicate, and delete flows.
- Group entries by meal.
- Add recent and saved foods.
- Add copy-previous-day.

### Phase 3 - App integration

- Add the Home nutrition card.
- Link nutrition into the Sunday-through-Saturday calendar.
- Connect latest `BodyMetric` weight to profile coach context.
- Add weekly calorie, protein, weight, and workout summaries.

### Phase 4 - Reliability

- Add the offline mutation queue.
- Make create and copy operations safe to retry without duplicates.
- Add backend tests for ownership, date boundaries, totals, and goal history.
- Verify Expo native and web parity.

### Phase 5 - Smart input

- Add AI natural-language parsing with a mandatory review step.
- Add meal/photo parsing only after text parsing is reliable.
- Evaluate a reputable food database and barcode source.
- Add optional carbs, fat, recipes, and micronutrients based on actual demand.

## MVP acceptance criteria

- A user can set editable daily calorie and protein targets.
- A user can log, edit, duplicate, and delete a food entry for any calendar date.
- Home shows accurate totals and remaining calories/protein for today.
- The nutrition day uses the same Sunday-through-Saturday calendar behavior as workouts.
- Recent and saved foods make repeat logging faster than retyping an entry.
- Nutrition entries are private to their owner.
- Daily and weekly totals are identical on Expo native and web.
- Offline logging cannot silently lose or duplicate entries.
- Weight history and nutrition summaries can be reviewed together.

## Explicitly outside the first release

- Barcode scanning.
- A comprehensive third-party food catalog.
- Micronutrient tracking.
- Recipe construction.
- Meal-plan generation.
- Social food sharing.
- Automatic AI writes without confirmation.
