const AuditLog = require('../models/auditLog');

const create = (data) => AuditLog.create(data);

const findByFilterLean = async (filter, { sort, skip, limit, populate } = {}) => {
  let q = AuditLog.find(filter);
  if (populate) {
    for (const p of Array.isArray(populate) ? populate : [populate]) {
      q = q.populate(p);
    }
  }
  if (sort) q = q.sort(sort);
  if (skip != null) q = q.skip(skip);
  if (limit != null) q = q.limit(limit);
  return q.lean();
};

const countByFilter = async (filter) => AuditLog.countDocuments(filter);

const distinct = async (field, filter) => AuditLog.distinct(field, filter);

const findByIdLean = async (id) => AuditLog.findById(id).lean();

module.exports = { create, findByFilterLean, countByFilter, distinct, findByIdLean };
