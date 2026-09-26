const Otp = require('../models/otp');

const findByFilter = async (filter, { sort } = {}) =>
  (sort ? Otp.find(filter).sort(sort) : Otp.find(filter));
const create = async (data) => Otp.create(data);
const deleteById = async (id) => Otp.deleteOne({ _id: id });
const findById = async (id) => Otp.findById(id);
/** Dùng khi gửi lại mã: vô hiệu hoá hàng loạt các mã cũ còn hiệu lực. */
const updateMany = async (filter, update) => Otp.updateMany(filter, update);
/**
 * Tiêu thụ mã theo kiểu nguyên tử (compare-and-set trên `used`).
 * Trả về null nếu mã đã bị một request khác tiêu thụ trước — đây là chốt chặn
 * chống double-submit/đua request cho luồng thanh toán.
 */
const consumeById = async (id, reason) =>
  Otp.findOneAndUpdate(
    { _id: id, used: false },
    { $set: { used: true, consumedReason: reason, consumedAt: new Date() } },
    { new: true },
  );
/** Tăng số lần nhập sai mà không đụng tới các trường khác. */
const incrementAttempts = async (id) =>
  Otp.findOneAndUpdate({ _id: id }, { $inc: { attempts: 1 } }, { new: true });

module.exports = { findByFilter, create, deleteById, findById, updateMany, consumeById, incrementAttempts };
