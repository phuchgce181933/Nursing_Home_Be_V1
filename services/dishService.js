const mongoose = require('mongoose');
const Dish = require('../models/dish');
const MealPlanEntry = require('../models/mealPlanEntry');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const {
  validateDishName,
  validateDishCalories,
  normalizeDishIngredients,
} = require('../utils/dishValidation');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const assertValidObjectId = (value, label) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw apiErr(CODES.MEAL_OBJECT_ID_INVALID, { statusCode: 400, params: { label } });
  }
};

const formatDish = (dish) => ({
  _id: dish._id,
  name: dish.name,
  calories: dish.calories,
  ingredients: dish.ingredients || [],
  isActive: dish.isActive,
  createdBy: dish.createdBy,
  updatedBy: dish.updatedBy,
  createdAt: dish.createdAt,
  updatedAt: dish.updatedAt,
});

const findByNameInsensitive = async (name, excludeId) => {
  const filter = { name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } };
  if (excludeId) filter._id = { $ne: excludeId };
  return Dish.findOne(filter).lean();
};

const listDishes = async (query = {}, user = {}) => {
  const filter = {};
  const activeOnly = query.activeOnly !== 'false' && query.activeOnly !== false;
  if (activeOnly || user.role === 'nurse') {
    filter.isActive = true;
  }
  if (query.search) {
    filter.name = { $regex: String(query.search).trim(), $options: 'i' };
  }
  const data = await Dish.find(filter).sort({ name: 1 }).lean();
  return data.map(formatDish);
};

const getDish = async (id, user = {}) => {
  assertValidObjectId(id, 'dishId');
  const dish = await Dish.findById(id).lean();
  if (!dish) throw apiErr(CODES.DISH_NOT_FOUND, { statusCode: 404 });
  if (user.role === 'nurse' && !dish.isActive) {
    throw apiErr(CODES.DISH_INACTIVE, { statusCode: 404 });
  }
  return formatDish(dish);
};

const createDish = async (body = {}, actor) => {
  const name = validateDishName(body.name);
  const calories = validateDishCalories(body.calories);
  const ingredients = normalizeDishIngredients(body.ingredients);

  const duplicate = await findByNameInsensitive(name);
  if (duplicate) throw apiErr(CODES.DISH_NAME_DUPLICATE, { statusCode: 409, params: { name: duplicate.name } });

  const dish = await Dish.create({
    name,
    calories,
    ingredients,
    isActive: body.isActive !== false,
    createdBy: actor?._id,
    updatedBy: actor?._id,
  });
  return { ...apiSuccess(SUCCESS.DISH_CREATED), dish: formatDish(dish.toObject()) };
};

const updateDish = async (id, body = {}, actor) => {
  assertValidObjectId(id, 'dishId');
  const dish = await Dish.findById(id);
  if (!dish) throw apiErr(CODES.DISH_NOT_FOUND, { statusCode: 404 });

  if (body.name !== undefined) {
    const name = validateDishName(body.name);
    const duplicate = await findByNameInsensitive(name, dish._id);
    if (duplicate) throw apiErr(CODES.DISH_NAME_DUPLICATE, { statusCode: 409, params: { name: duplicate.name } });
    dish.name = name;
  }
  if (body.calories !== undefined) {
    dish.calories = validateDishCalories(body.calories);
  }
  if (body.ingredients !== undefined) {
    dish.ingredients = normalizeDishIngredients(body.ingredients);
  }
  if (body.isActive !== undefined) {
    dish.isActive = Boolean(body.isActive);
  }
  dish.updatedBy = actor?._id;
  await dish.save();
  return { ...apiSuccess(SUCCESS.DISH_UPDATED), dish: formatDish(dish.toObject()) };
};

const deleteDish = async (id, actor) => {
  assertValidObjectId(id, 'dishId');
  const dish = await Dish.findById(id);
  if (!dish) throw apiErr(CODES.DISH_NOT_FOUND, { statusCode: 404 });

  const inUse = await MealPlanEntry.exists({ dishId: dish._id });
  if (inUse) {
    dish.isActive = false;
    dish.updatedBy = actor?._id;
    await dish.save();
    return { ...apiSuccess(SUCCESS.DISH_DEACTIVATED), dish: formatDish(dish.toObject()), deactivated: true };
  }

  await Dish.findByIdAndDelete(id);
  return { ...apiSuccess(SUCCESS.DISH_DELETED), deleted: true, id: String(id) };
};

const getActiveDishMap = async (dishIds = []) => {
  const ids = [...new Set(dishIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return {};
  const dishes = await Dish.find({ _id: { $in: ids } }).lean();
  return Object.fromEntries(dishes.map((d) => [String(d._id), d]));
};

module.exports = {
  listDishes,
  getDish,
  createDish,
  updateDish,
  deleteDish,
  getActiveDishMap,
  formatDish,
};
