const Conversation = require('../models/conversation');

const create = (data) => Conversation.create(data);

const findById = (id) => Conversation.findById(id);

const findByIdPopulated = (id) =>
  Conversation.findById(id).populate('participantUserIds', 'fullName email role').lean();

const findOne = (filter) => Conversation.findOne(filter);

const findAll = (filter, { sort, populate } = {}) => {
  let query = Conversation.find(filter);
  if (sort) query = query.sort(sort);
  if (populate) {
    for (const p of Array.isArray(populate) ? populate : [populate]) {
      query = query.populate(p);
    }
  }
  return query.lean();
};

const findByFilterLean = (filter, { select } = {}) => {
  let q = Conversation.find(filter);
  if (select) q = q.select(select);
  return q.lean();
};

const findSelect = (filter, fields) => Conversation.find(filter).select(fields);

const saveDoc = (doc) => doc.save();

const deleteById = (id) => Conversation.deleteOne({ _id: id });

module.exports = {
  create,
  findById,
  findByIdPopulated,
  findOne,
  findAll,
  findByFilterLean,
  findSelect,
  saveDoc,
  deleteById,
};
