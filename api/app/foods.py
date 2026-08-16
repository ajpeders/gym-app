"""Common foods with their calories and protein.

Nutrition logging dies at the point where you have to know that 200g of chicken
breast is 330 kcal. This is the shelf that answers that: pick the food, say how
much, and the entry fills itself in.

Deliberately small and curated rather than a scraped 500k-row database. The
long tail of packaged products is a lookup problem (barcodes, a real food API);
the staples are 90% of what a lifter logs, and shipping them costs one file
with no runtime dependency.

Figures are round numbers from standard references, per 100g unless the food is
naturally counted in items. They are a starting point you can edit, not a claim
of precision — a chicken breast is not a controlled quantity, and neither is a
"cup" of anything.
"""
from __future__ import annotations

from typing import Any

# (slug, name, category, unit, kcal, protein g) — per 100g / 100ml / item.
_ROWS: list[tuple[str, str, str, str, int, float]] = [
    # Meat & fish
    ("chicken-breast", "Chicken breast", "meat", "100g", 165, 31.0),
    ("chicken-thigh", "Chicken thigh", "meat", "100g", 209, 26.0),
    ("beef-mince-5", "Beef mince (5% fat)", "meat", "100g", 137, 21.0),
    ("beef-steak", "Beef steak", "meat", "100g", 271, 25.0),
    ("pork-loin", "Pork loin", "meat", "100g", 242, 27.0),
    ("turkey-breast", "Turkey breast", "meat", "100g", 135, 30.0),
    ("bacon", "Bacon", "meat", "100g", 541, 37.0),
    ("salmon", "Salmon", "fish", "100g", 208, 20.0),
    ("tuna-canned", "Tuna (canned in water)", "fish", "100g", 116, 26.0),
    ("cod", "Cod", "fish", "100g", 82, 18.0),
    ("prawns", "Prawns", "fish", "100g", 99, 24.0),
    # Eggs & dairy
    ("egg", "Egg", "dairy", "item", 78, 6.5),
    ("egg-white", "Egg white", "dairy", "item", 17, 3.6),
    ("milk-semi", "Milk (semi-skimmed)", "dairy", "100ml", 50, 3.5),
    ("greek-yogurt", "Greek yogurt (0%)", "dairy", "100g", 59, 10.0),
    ("cottage-cheese", "Cottage cheese", "dairy", "100g", 98, 11.0),
    ("cheddar", "Cheddar", "dairy", "100g", 402, 25.0),
    ("mozzarella", "Mozzarella", "dairy", "100g", 280, 28.0),
    ("butter", "Butter", "dairy", "100g", 717, 0.9),
    # Grains & starch
    ("white-rice", "White rice (cooked)", "grains", "100g", 130, 2.7),
    ("brown-rice", "Brown rice (cooked)", "grains", "100g", 123, 2.6),
    ("pasta", "Pasta (cooked)", "grains", "100g", 158, 5.8),
    ("oats", "Oats (dry)", "grains", "100g", 379, 13.0),
    ("bread-white", "White bread", "grains", "item", 79, 2.7),
    ("bread-wholemeal", "Wholemeal bread", "grains", "item", 82, 4.0),
    ("bagel", "Bagel", "grains", "item", 245, 10.0),
    ("tortilla-wrap", "Tortilla wrap", "grains", "item", 218, 6.0),
    ("potato", "Potato (boiled)", "grains", "100g", 87, 2.0),
    ("sweet-potato", "Sweet potato", "grains", "100g", 86, 1.6),
    ("couscous", "Couscous (cooked)", "grains", "100g", 112, 3.8),
    ("quinoa", "Quinoa (cooked)", "grains", "100g", 120, 4.4),
    # Legumes & meat alternatives
    ("black-beans", "Black beans (cooked)", "legumes", "100g", 132, 8.9),
    ("chickpeas", "Chickpeas (cooked)", "legumes", "100g", 164, 8.9),
    ("lentils", "Lentils (cooked)", "legumes", "100g", 116, 9.0),
    ("baked-beans", "Baked beans", "legumes", "100g", 94, 4.8),
    ("tofu", "Tofu (firm)", "legumes", "100g", 144, 17.0),
    ("tempeh", "Tempeh", "legumes", "100g", 192, 20.0),
    ("edamame", "Edamame", "legumes", "100g", 121, 12.0),
    # Fruit & veg
    ("banana", "Banana", "fruit", "item", 105, 1.3),
    ("apple", "Apple", "fruit", "item", 95, 0.5),
    ("orange", "Orange", "fruit", "item", 62, 1.2),
    ("blueberries", "Blueberries", "fruit", "100g", 57, 0.7),
    ("strawberries", "Strawberries", "fruit", "100g", 32, 0.7),
    ("grapes", "Grapes", "fruit", "100g", 69, 0.7),
    ("avocado", "Avocado", "fruit", "item", 240, 3.0),
    ("broccoli", "Broccoli", "veg", "100g", 34, 2.8),
    ("spinach", "Spinach", "veg", "100g", 23, 2.9),
    ("mixed-veg", "Mixed vegetables", "veg", "100g", 65, 3.0),
    ("tomato", "Tomato", "veg", "item", 22, 1.1),
    ("onion", "Onion", "veg", "100g", 40, 1.1),
    # Nuts, fats & spreads
    ("peanut-butter", "Peanut butter", "fats", "100g", 588, 25.0),
    ("almonds", "Almonds", "fats", "100g", 579, 21.0),
    ("walnuts", "Walnuts", "fats", "100g", 654, 15.0),
    ("cashews", "Cashews", "fats", "100g", 553, 18.0),
    ("olive-oil", "Olive oil", "fats", "100ml", 884, 0.0),
    # Supplements & convenience
    ("whey-protein", "Whey protein (scoop)", "supplements", "item", 120, 24.0),
    ("protein-bar", "Protein bar", "supplements", "item", 200, 20.0),
    ("mass-gainer", "Mass gainer (scoop)", "supplements", "item", 380, 30.0),
    ("creatine", "Creatine (5g)", "supplements", "item", 0, 0.0),
    # The rest of life
    ("pizza-slice", "Pizza (slice)", "other", "item", 285, 12.0),
    ("burger", "Burger", "other", "item", 354, 20.0),
    ("chocolate", "Chocolate", "other", "100g", 546, 4.9),
    ("crisps", "Crisps", "other", "100g", 536, 7.0),
    ("beer", "Beer", "other", "100ml", 43, 0.5),
    ("wine-red", "Red wine", "other", "100ml", 85, 0.1),
    ("cola", "Cola", "other", "100ml", 42, 0.0),
    ("orange-juice", "Orange juice", "other", "100ml", 45, 0.7),
    ("coffee-black", "Black coffee", "other", "100ml", 2, 0.1),
]

FOODS: list[dict[str, Any]] = [
    {
        "slug": slug,
        "name": name,
        "category": category,
        "unit": unit,
        "calories": calories,
        "protein": protein,
    }
    for slug, name, category, unit, calories, protein in _ROWS
]

_BY_SLUG = {f["slug"]: f for f in FOODS}


def get(slug: str) -> dict[str, Any] | None:
    return _BY_SLUG.get(slug)


def search(q: str, limit: int = 50) -> list[dict[str, Any]]:
    """Substring match on the name, which is how people type into a search box.

    No fuzzy matching on purpose: this list is short enough to scroll, and a
    fuzzy hit on a food is a wrong number rather than a wrong-ish guess.
    """
    needle = (q or "").strip().lower()
    if not needle:
        return FOODS[:limit]
    return [f for f in FOODS if needle in f["name"].lower() or needle in f["slug"]][:limit]


def portion(food: dict[str, Any], amount: float) -> tuple[int, float, str]:
    """Calories, protein and a readable label for `amount` of `food`.

    `amount` is grams/millilitres for measured foods and a count for the ones
    people count. Rounded on the way out: nobody logs 62.00000001g of protein,
    and a fake decimal implies a precision this data doesn't have.
    """
    multiplier = amount if food["unit"] == "item" else amount / 100
    calories = round(food["calories"] * multiplier)
    protein = round(food["protein"] * multiplier, 1)
    if food["unit"] == "item":
        # "3 x Egg" reads better than "3 item Egg", and 1 needs no count at all.
        label = food["name"] if amount == 1 else f"{_trim(amount)} x {food['name']}"
    else:
        label = f"{food['name']} {_trim(amount)}{food['unit'].replace('100', '')}"
    return calories, protein, label


def _trim(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)
