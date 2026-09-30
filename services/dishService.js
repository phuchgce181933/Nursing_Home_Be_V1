const mongoose = require('mongoose');
const dishRepo = require('../repositories/dishRepository');
const mealPlanEntryRepo = require('../repositories/mealPlanEntryRepository');
const { apiErr, apiSuccess, CODES, SUCCESS } = require('../utils/apiError');
const { createAuditLog } = require('../utils/auditLog');
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
  return dishRepo.findOneLean(filter);
};

const isDishInMealPlan = async (dishId) => Boolean(await mealPlanEntryRepo.exists({ dishId }));

const assertDishNotInMealPlan = async (dishId) => {
  if (await isDishInMealPlan(dishId)) {
    throw apiErr(CODES.DISH_IN_USE, { statusCode: 409 });
  }
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
  const data = await dishRepo.findByFilterLean(filter, { sort: { name: 1 } });
  return data.map(formatDish);
};

const getDish = async (id, user = {}) => {
  assertValidObjectId(id, 'dishId');
  const dish = await dishRepo.findByIdLean(id);
  if (!dish) throw apiErr(CODES.DISH_NOT_FOUND, { statusCode: 404 });
  if (user.role === 'nurse' && !dish.isActive) {
    throw apiErr(CODES.DISH_INACTIVE, { statusCode: 404 });
  }
  return formatDish(dish);
};

const createDish = async (body = {}, actor, req) => {
  const name = validateDishName(body.name);
  const calories = validateDishCalories(body.calories);
  const ingredients = normalizeDishIngredients(body.ingredients);

  const duplicate = await findByNameInsensitive(name);
  if (duplicate) {
    const inUse = await isDishInMealPlan(duplicate._id);
    if (!duplicate.isActive && !inUse) {
      const revived = await dishRepo.findByIdAndUpdate(
        duplicate._id,
        {
          name,
          calories,
          ingredients,
          isActive: body.isActive !== false,
          updatedBy: actor?._id,
        },
        { new: true }
      );
      await createAuditLog({
        actorUserId: actor?._id,
        actorRole: actor?.role,
        action: 'CREATE_DISH',
        displayAction: 'Tạo món ăn (khôi phục)',
        module: 'dish',
        businessModule: 'dish',
        targetEntityType: 'Dish',
        targetEntityId: revived._id,
        targetName: revived.name,
        description: `Tạo món ăn "${revived.name}" (khôi phục từ bản ghi trùng lặp)`,
        afterData: { name: revived.name, calories: revived.calories, isActive: revived.isActive },
        req,
      });
      return { ...apiSuccess(SUCCESS.DISH_CREATED), dish: formatDish(revived.toObject()) };
    }
    throw apiErr(CODES.DISH_NAME_DUPLICATE, { statusCode: 409, params: { name: duplicate.name } });
  }

  const dish = await dishRepo.create({
    name,
    calories,
    ingredients,
    isActive: body.isActive !== false,
    createdBy: actor?._id,
    updatedBy: actor?._id,
  });

  await createAuditLog({
    actorUserId: actor?._id,
    actorRole: actor?.role,
    action: 'CREATE_DISH',
    displayAction: 'Tạo món ăn',
    module: 'dish',
    businessModule: 'dish',
    targetEntityType: 'Dish',
    targetEntityId: dish._id,
    targetName: dish.name,
    description: `Tạo món ăn "${dish.name}" (${dish.calories} kcal)`,
    afterData: { name: dish.name, calories: dish.calories, ingredients: dish.ingredients, isActive: dish.isActive },
    req,
  });

  return { ...apiSuccess(SUCCESS.DISH_CREATED), dish: formatDish(dish.toObject()) };
};

const updateDish = async (id, body = {}, actor, req) => {
  assertValidObjectId(id, 'dishId');
  const dish = await dishRepo.findById(id);
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
    const willDeactivate = body.isActive === false && dish.isActive !== false;
    if (willDeactivate) {
      await assertDishNotInMealPlan(dish._id);
    }
    dish.isActive = Boolean(body.isActive);
  }
  dish.updatedBy = actor?._id;
  await dish.save();

  await createAuditLog({
    actorUserId: actor?._id,
    actorRole: actor?.role,
    action: 'UPDATE_DISH',
    displayAction: 'Cập nhật món ăn',
    module: 'dish',
    businessModule: 'dish',
    targetEntityType: 'Dish',
    targetEntityId: dish._id,
    targetName: dish.name,
    description: `Cập nhật món ăn "${dish.name}"`,
    afterData: formatDish(dish.toObject()),
    req,
  });

  return { ...apiSuccess(SUCCESS.DISH_UPDATED), dish: formatDish(dish.toObject()) };
};

const deleteDish = async (id, actor, req) => {
  assertValidObjectId(id, 'dishId');
  const dish = await dishRepo.findById(id);
  if (!dish) throw apiErr(CODES.DISH_NOT_FOUND, { statusCode: 404 });

  await assertDishNotInMealPlan(dish._id);

  await dishRepo.findByIdAndDelete(id);

  await createAuditLog({
    actorUserId: actor?._id,
    actorRole: actor?.role,
    action: 'DELETE_DISH',
    displayAction: 'Xóa món ăn',
    module: 'dish',
    businessModule: 'dish',
    targetEntityType: 'Dish',
    targetEntityId: dish._id,
    targetName: dish.name,
    description: `Xóa món ăn "${dish.name}"`,
    beforeData: { name: dish.name, calories: dish.calories, isActive: dish.isActive },
    req,
  });

  return { ...apiSuccess(SUCCESS.DISH_DELETED), deleted: true, id: String(id) };
};

const getActiveDishMap = async (dishIds = []) => {
  const ids = [...new Set(dishIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return {};
  const dishes = await dishRepo.findByFilterLean({ _id: { $in: ids } });
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
