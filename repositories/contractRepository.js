const Contract = require('../models/contract');

const create = async (data) => Contract.create(data);

const findById = async (id) => 
  Contract.findById(id)
    .populate('admissionId residentId servicePackageId familyAccountId createdBy cancelledBy');

const findByIdLean = async (id) => Contract.findById(id).lean();

const findByContractNumber = async (contractNumber) => 
  Contract.findOne({ contractNumber: contractNumber.trim() });

const findByAdmissionId = async (admissionId) => 
  Contract.find({ admissionId }).sort({ createdAt: -1 });

const findActiveByAdmissionId = async (admissionId) => 
  Contract.findOne({ admissionId, status: 'active' });

const findByResidentId = async (residentId, options = {}) => {
  const { sort = { createdAt: -1 }, skip = 0, limit = 50, status } = options;
  const filter = { residentId };
  if (status) filter.status = status;
  return Contract.find(filter).sort(sort).skip(skip).limit(limit);
};

const findAll = async (filter, options = {}) => {
  const { sort = { createdAt: -1 }, skip = 0, limit = 50, populate, lean = false } = options;
  // Sử dụng .lean() để trả về plain object thay vì Mongoose Document.
  // Khi spread Mongoose Document bằng `...doc`, kết quả chỉ chứa internal properties
  // ($__, populated, isNew, errors, ...) thay vì các field thực tế của document.
  // Dùng lean() đảm bảo response trả về đầy đủ contractNumber, residentId populated, ...
  let query = Contract.find(filter).sort(sort).skip(skip).limit(limit);
  if (populate) {
    if (Array.isArray(populate)) {
      populate.forEach((p) => { query = query.populate(p); });
    } else {
      query = query.populate(populate);
    }
  }
  return lean ? query.lean() : query;
};

const findAllLean = async (filter, options = {}) => {
  const { sort = { createdAt: -1 }, skip = 0, limit = 50, populate } = options;
  let query = Contract.find(filter).sort(sort).skip(skip).limit(limit).lean();
  if (populate) {
    query = query.populate(populate);
  }
  return query;
};

const countAll = async (filter) => Contract.countDocuments(filter);

const updateById = async (id, update, options = {}) => 
  Contract.findByIdAndUpdate(id, update, { new: true, ...options });

const updateByIdLean = async (id, update) => 
  Contract.findByIdAndUpdate(id, update, { new: true }).lean();

const saveDoc = async (doc, opts) => doc.save(opts);

const findByFamilyAccountId = async (familyAccountId, options = {}) => {
  const { sort = { createdAt: -1 }, skip = 0, limit = 50 } = options;
  return Contract.find({ familyAccountId }).sort(sort).skip(skip).limit(limit);
};

module.exports = {
  create,
  findById,
  findByIdLean,
  findByContractNumber,
  findByAdmissionId,
  findActiveByAdmissionId,
  findByResidentId,
  findAll,
  findAllLean,
  countAll,
  updateById,
  updateByIdLean,
  saveDoc,
  findByFamilyAccountId,
};
