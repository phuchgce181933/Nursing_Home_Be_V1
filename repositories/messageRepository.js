const Message = require('../models/message');

const create = (data) => Message.create(data);

const findByConversation = (conversationId, { sort, skip, limit, populate } = {}) => {
  let query = Message.find({ conversationId });
  if (sort) query = query.sort(sort);
  if (skip) query = query.skip(skip);
  if (limit) query = query.limit(limit);
  if (populate) {
    for (const p of Array.isArray(populate) ? populate : [populate]) {
      query = query.populate(p);
    }
  }
  return query.lean();
};

const findByFilter = (filter, { sort, limit, populate } = {}) => {
  let query = Message.find(filter);
  if (sort) query = query.sort(sort);
  if (limit) query = query.limit(limit);
  if (populate) {
    for (const p of Array.isArray(populate) ? populate : [populate]) {
      query = query.populate(p);
    }
  }
  return query;
};

const findByFilterLean = (filter, selectFields) => {
  let query = Message.find(filter);
  if (selectFields) query = query.select(selectFields);
  return query.lean();
};

const updateMany = (filter, update) => Message.updateMany(filter, update);

const deleteByConversation = (conversationId) =>
  Message.deleteMany({ conversationId });

const aggregate = (pipeline) => Message.aggregate(pipeline);

module.exports = {
  create,
  findByConversation,
  findByFilter,
  findByFilterLean,
  updateMany,
  deleteByConversation,
  aggregate,
};
