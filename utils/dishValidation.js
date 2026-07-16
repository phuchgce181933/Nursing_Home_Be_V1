const { apiErr, CODES } = require('./apiError');

const DISH_NAME_PATTERN = /^[\p{L}\s]+$/u;
const DISH_CALORIES_PATTERN = /^\d+$/;
const DISH_INGREDIENTS_STRING_PATTERN = /^[\p{L}\s,]*$/u;
const DISH_INGREDIENT_ITEM_PATTERN = /^[\p{L}\s]+$/u;

const validateDishName = (rawName) => {
  const name = String(rawName || '').trim();
  if (!name) {
    throw apiErr(CODES.DISH_NAME_REQUIRED, { statusCode: 400 });
  }
  if (!DISH_NAME_PATTERN.test(name)) {
    throw apiErr(CODES.DISH_NAME_INVALID, { statusCode: 400 });
  }
  return name;
};

const validateDishCalories = (value) => {
  const raw = value == null ? '' : String(value).trim();
  if (!raw || !DISH_CALORIES_PATTERN.test(raw)) {
    throw apiErr(CODES.DISH_CALORIES_INVALID, { statusCode: 400 });
  }
  const calories = Number(raw);
  if (!Number.isInteger(calories) || calories < 0) {
    throw apiErr(CODES.DISH_CALORIES_INVALID, { statusCode: 400 });
  }
  return calories;
};

const normalizeDishIngredients = (value) => {
  if (value == null || value === '') return [];

  if (Array.isArray(value)) {
    const items = value.map((v) => String(v).trim()).filter(Boolean);
    for (const item of items) {
      if (!DISH_INGREDIENT_ITEM_PATTERN.test(item)) {
        throw apiErr(CODES.DISH_INGREDIENTS_INVALID, { statusCode: 400 });
      }
    }
    return items;
  }

  const text = String(value).trim();
  if (!text) return [];
  if (!DISH_INGREDIENTS_STRING_PATTERN.test(text)) {
    throw apiErr(CODES.DISH_INGREDIENTS_INVALID, { statusCode: 400 });
  }

  const items = text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  for (const item of items) {
    if (!DISH_INGREDIENT_ITEM_PATTERN.test(item)) {
      throw apiErr(CODES.DISH_INGREDIENTS_INVALID, { statusCode: 400 });
    }
  }

  return items;
};

module.exports = {
  DISH_NAME_PATTERN,
  DISH_CALORIES_PATTERN,
  DISH_INGREDIENTS_STRING_PATTERN,
  DISH_INGREDIENT_ITEM_PATTERN,
  validateDishName,
  validateDishCalories,
  normalizeDishIngredients,
};
